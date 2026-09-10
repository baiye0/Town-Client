import { expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile, copyFile, chmod } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
import { BackgroundPortal, command } from '../desktop/background';
import { RuntimeUpdater, digest, type RuntimeBundle } from '../desktop/runtime-update';
import { parseConnection } from '../desktop/connection';
import type { Settings } from '../desktop/shared';

it.skipIf(process.env.TOWN_NATIVE_UPGRADE_TESTS !== '1' || !['darwin', 'win32'].includes(process.platform))('replaces the real OS supervisor offline, then restores the prior runtime after a bad candidate', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'town-native-upgrade-'));
  const directory = path.join(root, 'profile');
  const background = new BackgroundPortal(directory, command, process.platform, root);
  // Allocate a local closed port: readiness must not require the remote relay.
  const socket = createServer();
  await new Promise<void>(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = (socket.address() as { port: number }).port;
  await new Promise<void>(resolve => socket.close(() => resolve()));
  const binary = path.resolve('resources', process.platform === 'win32' ? 'heart-portal.exe' : 'heart-portal');
  const version = /\b(\d+\.\d+\.\d+)\b/.exec(await command(binary, ['--version']))![1];
  const settings: Settings = { endpoint: '', being: '', hasToken: true, portalName: 'upgrade-fixture', portalBinary: binary, workspace: root, autoStart: false, backgroundEnabled: true, allowExec: false, kitsEnabled: false };
  const connection = parseConnection(`http://127.0.0.1:${port}/fixture/?token=upgrade-fixture`);
  const bundle: RuntimeBundle = { schema: 1, id: 'b'.repeat(64), clientVersion: '0.1.1', portalVersion: version, sha256: digest(await readFile(binary)), platform: process.platform, arch: process.arch };
  try {
    await background.enable(settings, connection);
    const old = { ...background.installedService! };
    const config = await readFile(old.configPath!, 'utf8') + '\n# retained custom configuration\n';
    await writeFile(old.configPath!, config);
    const updater = new RuntimeUpdater(directory, background);
    expect((await updater.sync(binary, bundle, settings, connection)).phase).toBe('updated');
    const good = { ...background.installedService! };
    expect(good.root).not.toBe(old.root);
    expect(background.state.running).toBe(true);
    expect(await readFile(good.configPath!, 'utf8')).toBe(config);
    expect((await background.portalState()).phase).not.toBe('connected');
    // Same platform executable that exits without starting Portal.
    const bad = path.join(root, process.platform === 'win32' ? 'bad.exe' : 'bad');
    if (process.platform === 'win32') await copyFile(path.join(process.env.SystemRoot!, 'System32/where.exe'), bad);
    else { await writeFile(bad, '#!/bin/sh\nexit 1\n'); await chmod(bad, 0o700); }
    const badBundle = { ...bundle, id: 'c'.repeat(64), sha256: digest(await readFile(bad)) };
    await expect(updater.sync(bad, badBundle, settings, connection)).rejects.toThrow('已恢复旧服务');
    expect(background.installedService).toEqual(good);
    const deadline = Date.now() + 8000;
    while (!(await background.refresh()).running && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 200));
    expect(background.state.running).toBe(true);
    expect(await readFile(good.configPath!, 'utf8')).toBe(config);
  } catch (error) {
    console.error('Native Windows/macOS operation failed:', error);
    throw error;
  } finally {
    await background.disable();
    if (process.platform === 'win32') {
      const script = `$task=Get-ScheduledTask | Where-Object TaskName -eq '${background.label}'; if ($task) { $task | Unregister-ScheduledTask -Confirm:$false -ErrorAction Stop }; exit 0`;
      await command('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]);
    }
    await rm(root, { recursive: true, force: true });
  }
}, 70_000);
