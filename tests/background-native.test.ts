import { expect, it } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BackgroundPortal, command, windowsModulePath } from '../desktop/background';
import { parseConnection } from '../desktop/connection';

it.skipIf(process.env.TOWN_NATIVE_UPGRADE_TESTS !== '1' || process.platform !== 'win32')('protects credentials and registers an interactive Windows task', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'town-windows-registration-'));
  const background = new BackgroundPortal(path.join(root, 'profile'));
  try {
    await background.enable({ endpoint: '', being: '', hasToken: true, portalName: 'fixture', portalBinary: process.execPath,
      workspace: root, autoStart: false, backgroundEnabled: true, allowExec: false, kitsEnabled: false },
    parseConnection('http://127.0.0.1:1/fixture/?token=registration-fixture'));
    expect(background.state.installed).toBe(true);
    expect(background.state.enabled).toBe(true);
    const encrypted = await readFile(path.join(background.installedService!.root, 'connection.dpapi'), 'utf8');
    expect(encrypted).not.toContain('registration-fixture');
    expect(encrypted.length).toBeGreaterThan(40);
  } catch (error) {
    console.error('Native Windows/macOS operation failed:', error);
    throw error;
  } finally {
    await background.disable();
    const script = windowsModulePath + `$task=Get-ScheduledTask | Where-Object TaskName -eq '${background.label}'; if ($task) { $task | Unregister-ScheduledTask -Confirm:$false -ErrorAction Stop }; exit 0`;
    await command('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]);
    await rm(root, { recursive: true, force: true });
  }
}, 70_000);
