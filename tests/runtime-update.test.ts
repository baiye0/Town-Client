import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BackgroundPortal, type Command } from '../desktop/background';
import { RuntimeUpdater, digest, type RuntimeBundle } from '../desktop/runtime-update';
import { parseConnection } from '../desktop/connection';
import type { Settings } from '../desktop/shared';
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function fixture(platform: 'darwin' | 'win32' = 'darwin') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'town-upgrade-')); dirs.push(root);
  const profile = path.join(root, 'profile');
  const calls: string[] = []; let loaded = false, disabled = false;
  const run: Command = async (_file, args) => {
    const script = platform === 'win32' ? Buffer.from(args.at(-1)!, 'base64').toString('utf16le') : args.join(' ');
    calls.push(script);
    if (platform === 'win32') {
      if (script.includes('[Console]::In.ReadToEnd()')) return 'preserved-dpapi';
      if (script.includes('Disable-ScheduledTask')) { disabled = true; loaded = false; }
      if (script.includes('Enable-ScheduledTask')) { disabled = false; loaded = true; }
      if (script.includes('ConvertTo-Json')) return JSON.stringify({ enabled: !disabled, running: loaded, pid: loaded ? 1234 : undefined });
    } else {
      if (args[0] === 'print-disabled') return disabled ? `"${background.label}" => disabled` : '';
      if (args[0] === 'print') { if (!loaded) throw new Error('not loaded'); return 'state = running\npid = 1234'; }
      if (args[0] === 'disable') disabled = true;
      if (args[0] === 'enable') disabled = false;
      if (args[0] === 'bootstrap') loaded = true;
      if (args[0] === 'bootout') loaded = false;
    }
    return '';
  };
  const settings: Settings = { endpoint: '', being: '', hasToken: true, portalName: 'test', portalBinary: process.execPath, workspace: root, autoStart: false, backgroundEnabled: true, allowExec: false, kitsEnabled: false };
  const connection = parseConnection('https://example.org/test/?token=fixture-secret');
  const background = new BackgroundPortal(profile, run, platform, root);
  await background.enable(settings, connection);
  const previous = { ...background.installedService! };
  const original = 'name = "test"\nworkspace = "unchanged"\n# custom tools and settings must survive\n';
  await writeFile(previous.configPath!, original);
  const binary = path.join(root, 'new-engine'); await writeFile(binary, 'new executable');
  const bundle: RuntimeBundle = { schema: 1, id: 'a'.repeat(64), clientVersion: '0.1.1', portalVersion: '0.8.1', sha256: digest(await readFile(binary)), platform, arch: process.arch };
  const updater = (ready: (service: any) => Promise<void> = async () => {}, version = '0.8.1') => new RuntimeUpdater(profile, background, platform, ready, async () => version);
  calls.length = 0;
  return { root, profile, background, previous, original, settings, connection, binary, bundle, calls, updater };
}
for (const platform of ['darwin', 'win32'] as const) {
  it(`updates the ${platform} engine and supervisor together, preserving exact config and credentials`, async () => {
    const f = await fixture(platform); let checked = false;
    const result = await f.updater(async service => {
      checked = true;
      expect(await readFile(path.join(service.root, platform === 'darwin' ? 'heart-portal' : 'heart-portal.exe'), 'utf8')).toBe('new executable');
      expect(await readFile(service.configPath, 'utf8')).toBe(f.original);
    }).sync(f.binary, f.bundle, f.settings, f.connection);
    expect(checked).toBe(true); expect(result.phase).toBe('updated');
    expect(f.background.installedService!.root).not.toBe(f.previous.root);
    expect(await readFile(f.previous.configPath!, 'utf8')).toBe(f.original);
    const credential = platform === 'darwin' ? 'connection.url' : 'connection.dpapi';
    expect(await readFile(path.join(f.background.installedService!.root, credential))).toEqual(await readFile(path.join(f.previous.root, credential)));
    expect(f.calls.findIndex(s => s.includes(platform === 'darwin' ? 'bootout' : 'Disable-ScheduledTask'))).toBeLessThan(f.calls.findIndex(s => s.includes(platform === 'darwin' ? 'bootstrap' : 'Register-ScheduledTask')));
    f.calls.length = 0;
    expect((await f.updater().sync(f.binary, f.bundle, f.settings, f.connection)).phase).toBe('current');
    expect(f.calls).toEqual([]);
  });
  it(`rolls back ${platform} registration, running state and source on startup failure`, async () => {
    const f = await fixture(platform);
    await expect(f.updater(async () => { throw new Error('bad engine'); }).sync(f.binary, f.bundle, f.settings, f.connection)).rejects.toThrow('已恢复旧服务');
    expect(f.background.installedService).toEqual(f.previous);
    expect(f.background.state.running).toBe(true);
    expect(await readFile(f.previous.configPath!, 'utf8')).toBe(f.original);
    await expect(readFile(path.join(f.profile, 'runtime-update.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it(`does not restart a disabled ${platform} service while upgrading`, async () => {
    const f = await fixture(platform); await f.background.disable(); f.calls.length = 0;
    await f.updater(async () => { throw new Error('must not launch'); }).sync(f.binary, f.bundle, f.settings, f.connection);
    expect(f.background.state.enabled).toBe(false); expect(f.background.state.running).toBe(false);
    expect(f.calls.some(s => s.includes(platform === 'darwin' ? 'bootstrap' : 'Enable-ScheduledTask'))).toBe(false);
  });
}
it('preserves newer engines and rejects corrupt candidates before touching a service', async () => {
  const f = await fixture();
  expect((await f.updater(undefined, '0.8.2').sync(f.binary, f.bundle, f.settings, f.connection)).phase).toBe('skipped');
  expect(f.calls).toEqual([]);
  await writeFile(f.binary, 'corrupted');
  await expect(f.updater().sync(f.binary, f.bundle, f.settings, f.connection)).rejects.toThrow('校验失败');
  expect(f.calls).toEqual([]);
});
it('recovers an interrupted switch on next startup before retrying any upgrade', async () => {
  const f = await fixture();
  const candidate = { ...f.previous, root: path.join(f.profile, 'portal-service/interrupted') };
  await mkdir(candidate.root);
  await writeFile(path.join(f.profile, 'runtime-update.json'), JSON.stringify({ schema: 1, previous: f.previous, candidate, enabled: true, previousPlist: await readFile(f.previous.file, 'utf8') }));
  await f.background.unload(f.previous);
  await f.background.installRegistration(candidate);
  await f.background.setService(candidate);
  expect(await f.updater().recover()).toBe(true);
  expect(f.background.installedService).toEqual(f.previous); expect(f.background.state.running).toBe(true);
  expect(await f.updater().recover()).toBe(false);
});
