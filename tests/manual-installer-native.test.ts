import { it, expect } from 'vitest';
import { mkdtemp, readdir, rm, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { _electron as electron } from 'playwright';
import { createServer } from 'node:http';
import { windowsInstallerScript } from '../desktop/manual-installer';
import { command, windowsModulePath } from '../desktop/background';

it.skipIf(process.platform !== 'win32' || process.env.PORTAL_DESKTOP_NATIVE_INSTALLER_TESTS !== '1')('NSIS installs to a custom directory, upgrades a running client, preserves its profile and opens one window', async () => {
  // NSIS replaces the same product's registered installation, even with /D.
  // Require a clean test host instead of uninstalling a user's NSIS client.
  const registered = await command('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    "$ErrorActionPreference='Stop'; @(Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -eq 'Portal Desktop' -and $_.UninstallString -like '*Uninstall portal-desktop.exe*' }).Count"]);
  expect(Number(registered.trim()), 'Use a clean Windows test host without an existing NSIS installation').toBe(0);
  const root = await mkdtemp(path.join(os.tmpdir(), 'portal-nsis-'));
  const directory = path.join(root, 'custom path', 'portal-desktop');
  const profile = path.join(root, 'profile');
  const executable = path.join(directory, 'portal-desktop.exe');
  const make = path.resolve('out/make/nsis/x64');
  const setups = (await readdir(make)).filter(name => /setup\.exe$/i.test(name));
  expect(setups).toHaveLength(1);
  const environment = { ...process.env, PORTAL_DESKTOP_USER_DATA: profile };
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ being_name: 'installer-fixture' }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const run = (file: string, args: string[]) => new Promise<number | null>((resolve, reject) => {
    const child = spawn(file, args, { env: environment, stdio: 'ignore', windowsHide: true });
    child.once('error', reject); child.once('exit', resolve);
  });
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  let launchedPid: number | undefined;
  try {
    const setup = path.join(make, setups[0]);
    // /D is last, with no quotes even for spaces (NSIS command-line contract).
    expect(await run(setup, ['/S', '/D=' + directory])).toBe(0);
    expect(await readFile(path.join(directory, 'resources/runtime-bundle.json'), 'utf8')).toContain('clientVersion');
    app = await electron.launch({ executablePath: executable, env: environment });
    const initial = await app.firstWindow();
    await initial.waitForFunction(() => Boolean((window as any).beings));
    await initial.evaluate(async input => {
      const client = (window as any).beings;
      const { settings } = await client.snapshot();
      await client.save({ ...settings, connectionLink: input.link, workspace: input.workspace, autoStart: false, backgroundEnabled: false });
      await client.startPortal();
    }, { link: `http://127.0.0.1:${port}/installer-fixture/?token=fixture`, workspace: path.join(root, 'workspace') });
    const oldPortalPid = await initial.evaluate(async () => (await (window as any).beings.snapshot()).portal.pid);
    expect(oldPortalPid).toBeGreaterThan(0);
    await writeFile(path.join(profile, 'installer-test.txt'), '配置应在升级后保留');
    const oldPid = app.process().pid!;
    expect(await run(setup, ['/S', '/D=' + directory])).toBe(0);
    expect(() => process.kill(oldPid, 0)).toThrow();
    expect(() => process.kill(oldPortalPid, 0)).toThrow();
    app = undefined;
    expect(await readFile(path.join(profile, 'installer-test.txt'), 'utf8')).toBe('配置应在升级后保留');
    app = await electron.launch({ executablePath: executable, env: environment });
    const page = await app.firstWindow();
    await page.waitForFunction(() => Boolean((window as any).beings));
    const restored = await page.evaluate(async () => (window as any).beings.snapshot());
    expect(restored.portal.pid).toBeGreaterThan(0);
    expect(restored.portal.pid).not.toBe(oldPortalPid);
    expect(restored.settings.being).toBe('installer-fixture');
    expect(restored.settings.portalBinary).toBe(path.join(directory, 'resources', 'heart-portal.exe'));
    expect(await run(executable, [])).toBe(0);
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
    const helperScript = path.join(root, 'upgrade.ps1');
    await writeFile(helperScript, '\ufeff' + windowsInstallerScript(app.process().pid!, setup, executable));
    const upgrade = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helperScript]);
    await app.close(); app = undefined;
    expect(await upgrade).toBe(0);
    const inspect = windowsModulePath + `$p=@(Get-CimInstance Win32_Process -Filter "Name='portal-desktop.exe'" | Where-Object { $_.ExecutablePath -eq '${executable.replaceAll("'", "''")}' -and $_.CommandLine -notmatch '--type=' }); ConvertTo-Json -InputObject @($p.ProcessId) -Compress`;
    const deadline = Date.now() + 15000;
    while (!launchedPid && Date.now() < deadline) {
      const ids = JSON.parse(await command('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(inspect, 'utf16le').toString('base64')]));
      expect(ids.length).toBeLessThanOrEqual(1);
      launchedPid = ids[0];
      if (!launchedPid) await new Promise(resolve => setTimeout(resolve, 300));
    }
    expect(launchedPid).toBeGreaterThan(0);
    // Let startup restore the Portal and consume the journal before inspecting it.
    const recoveredDeadline = Date.now() + 15000;
    while (await readFile(path.join(profile, 'client-install.json')).then(() => true, () => false)) {
      if (Date.now() > recoveredDeadline) throw new Error('Installation recovery did not finish');
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    expect(await readFile(path.join(profile, 'client-install.json'), 'utf8').catch(() => null)).toBeNull();
  } finally {
    if (app) await app.close().catch(() => {});
    if (launchedPid) await command('taskkill.exe', ['/PID', String(launchedPid), '/T', '/F']).catch(() => {});
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    const uninstaller = (await readdir(directory).catch(() => [])).find(name => /^Uninstall.*\.exe$/i.test(name));
    if (uninstaller) await run(path.join(directory, uninstaller), ['/S']);
    await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
}, 180_000);
