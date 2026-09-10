import { expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile, copyFile, chmod, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { ExternalPortalObserver } from '../desktop/external-portal';
import { BackgroundPortal, command, windowsModulePath } from '../desktop/background';
import { RuntimeUpdater, digest, type RuntimeBundle } from '../desktop/runtime-update';
import { parseConnection } from '../desktop/connection';
import type { Settings } from '../desktop/shared';

it.skipIf(process.env.TOWN_NATIVE_UPGRADE_TESTS !== '1' || !['darwin', 'win32'].includes(process.platform))('replaces the real OS supervisor offline, then restores the prior runtime after a bad candidate', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'town-native-upgrade-'));
  const directory = path.join(root, 'profile');
  const background = new BackgroundPortal(directory);
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
      const script = windowsModulePath + `$task=Get-ScheduledTask | Where-Object TaskName -eq '${background.label}'; if ($task) { $task | Unregister-ScheduledTask -Confirm:$false -ErrorAction Stop }; exit 0`;
      await command('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]);
    }
    await rm(path.dirname(background.runtimeDirectory), { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
// Includes a deliberate 25 s startup failure plus real OS stop/start commands.
}, 120_000);

it.skipIf(process.env.TOWN_NATIVE_UPGRADE_TESTS !== '1' || !['darwin', 'win32'].includes(process.platform))('takes over an independent Portal and supervisor after a manual client upgrade', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'town-manual-upgrade-'));
  const directory = path.join(root, 'profile');
  const background = new BackgroundPortal(directory);
  const binary = path.resolve('resources', process.platform === 'win32' ? 'heart-portal.exe' : 'heart-portal');
  const oldRoot = path.join(os.homedir(), '.heart-portal', 'clients', path.basename(root), 'old runtime with spaces');
  const { mkdir } = await import('node:fs/promises'); await mkdir(oldRoot, { recursive: true, mode: 0o700 });
  const oldBinary = path.join(oldRoot, path.basename(binary)); await copyFile(process.env.TOWN_TEST_EXTERNAL_PORTAL || binary, oldBinary); await chmod(oldBinary, 0o700);
  const configPath = path.join(oldRoot, 'custom config.toml');
  const settings: Settings = { endpoint: '', being: '', hasToken: true, portalName: 'manual-upgrade', portalBinary: binary, workspace: oldRoot, autoStart: true, backgroundEnabled: true, allowExec: false, kitsEnabled: false };
  const { portalConfig } = await import('../desktop/portal');
  const original = portalConfig(settings) + '\n# exact original configuration\n'; await writeFile(configPath, original);
  const connection = parseConnection(`http://127.0.0.1:1/test-${path.basename(root)}/?token=manual-upgrade-fixture`);
  const observer = new ExternalPortalObserver();
  let child: ReturnType<typeof spawn> | undefined;
  try {
    child = spawn(oldBinary, ['--config', configPath, '--name', settings.portalName], { cwd: oldRoot, stdio: 'ignore',
      env: { ...process.env, PORTAL_CONNECT_LINK: connection.link, HEART_PORTAL_SUPERVISED: undefined,
        ...(process.platform === 'win32' ? { PSModulePath: path.join(process.env.SystemRoot!, 'System32/WindowsPowerShell/v1.0/Modules') } : {}) } });
    const deadline = Date.now() + 60_000;
    let external = [] as Awaited<ReturnType<typeof observer.forUpgrade>>;
    while (!external.length && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 500));
      external = await observer.forUpgrade(connection, background.label);
    }
    expect(external).toHaveLength(1);
    expect(external[0]).toMatchObject({ name: settings.portalName });
    expect(await realpath(external[0].configPath!)).toBe(await realpath(configPath));
    expect(await realpath(external[0].cwd!)).toBe(await realpath(oldRoot));
    // Reproduce a stale client-owned service beside the active independent one.
    await background.enable(settings, connection);
    const version = /\b(\d+\.\d+\.\d+)\b/.exec(await command(binary, ['--version']))![1];
    const bundle: RuntimeBundle = { schema: 1, id: 'd'.repeat(64), clientVersion: '0.1.4', portalVersion: version, sha256: digest(await readFile(binary)), platform: process.platform, arch: process.arch };
    const updater = new RuntimeUpdater(directory, background);
    expect((await updater.sync(binary, bundle, settings, connection)).phase).toBe('updated');
    expect(background.state.running).toBe(true);
    expect(await readFile(background.installedService!.configPath!, 'utf8')).toBe(original);
    expect(await observer.forUpgrade(connection, background.label, background.installedService!.root)).toEqual([]);
  } catch (error) {
    console.error('Independent runtime takeover failed:', error);
    throw error;
  } finally {
    await background.disable();
    const { portableCommand } = await import('../desktop/background');
    await portableCommand(oldBinary, 'stop').catch(() => {});
    child?.kill();
    await rm(path.dirname(oldRoot), { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    if (process.platform === 'darwin' && background.installedService?.file) await rm(background.installedService.file, { force: true });
    if (process.platform === 'win32') {
      const script = windowsModulePath + `$task=Get-ScheduledTask | Where-Object TaskName -eq '${background.label}'; if ($task) { $task | Unregister-ScheduledTask -Confirm:$false -ErrorAction Stop }; exit 0`;
      await command('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]);
    }
    await rm(path.dirname(background.runtimeDirectory), { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
}, 180_000);
