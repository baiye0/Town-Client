import { it, expect } from 'vitest';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { command, windowsModulePath } from '../desktop/background';
import { windowsInstallerScript } from '../desktop/manual-installer';

it.skipIf(process.platform !== 'win32' || process.env.TOWN_NATIVE_INSTALLER_TESTS !== '1')('runs the real Windows Setup and automatically launches the installed client', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'town-setup-'));
  const make = path.resolve('out/make/squirrel.windows/x64');
  const setups = (await readdir(make)).filter(name => /setup\.exe$/i.test(name));
  expect(setups).toHaveLength(1);
  const old = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  const script = path.join(root, 'install.ps1');
  await writeFile(script, '\ufeff' + windowsInstallerScript(old.pid!, path.join(make, setups[0]), process.execPath));
  const helper = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], {
    env: { ...process.env, BEINGS_USER_DATA: path.join(root, 'profile') }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  let errors = ''; helper.stderr.on('data', chunk => { errors += chunk.toString(); });
  let pid: number | undefined;
  try {
    const completion = new Promise<number | null>((resolve, reject) => { helper.once('exit', resolve); helper.once('error', reject); });
    old.kill();
    expect(await completion, errors).toBe(0);
    const version = (await import('../package.json')).version;
    const executable = path.join(process.env.LOCALAPPDATA!, 'beings', 'app-' + version, 'beings.exe');
    const inspect = windowsModulePath + `$p=Get-CimInstance Win32_Process -Filter "Name='beings.exe'" | Where-Object { $_.ExecutablePath -eq '${executable.replaceAll("'", "''")}' -and $_.CommandLine -notmatch '--type=' }; @($p.ProcessId) | ConvertTo-Json -Compress`;
    const deadline = Date.now() + 30_000;
    while (!pid && Date.now() < deadline) {
      const output = await command('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(inspect, 'utf16le').toString('base64')]);
      const ids = output.trim() ? JSON.parse(output) : [];
      pid = Array.isArray(ids) ? ids[0] : ids;
      if (!pid) await new Promise(resolve => setTimeout(resolve, 500));
    }
    expect(pid, 'New installed client should launch automatically').toBeGreaterThan(0);
    await new Promise(resolve => setTimeout(resolve, 3000));
    expect(() => process.kill(pid!, 0)).not.toThrow();
  } finally {
    old.kill(); helper.kill();
    if (pid) await command('taskkill', ['/PID', String(pid), '/T', '/F']).catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
}, 180_000);
