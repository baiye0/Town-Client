import { access, rename, unlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const execute = promisify(execFile);

async function compiler() {
  const windows = process.env.WINDIR || 'C:\\Windows';
  const candidates = [
    path.join(windows, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
    path.join(windows, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe'),
  ];
  for (const candidate of candidates) {
    if (await access(candidate).then(() => true, () => false)) return candidate;
  }
  throw new Error('Windows C# compiler is unavailable; cannot build the installer launcher.');
}

export async function wrapWindowsInstallers(artifacts: string[]) {
  const setups = artifacts.filter(file => /setup\.exe$/i.test(path.basename(file)));
  if (setups.length !== 1) throw new Error(`Expected one Windows Setup executable, found ${setups.length}.`);
  const setup = path.resolve(setups[0]);
  const core = setup + '.squirrel-core';
  const wrapper = setup + '.bootstrap.exe';
  await rename(setup, core);
  try {
    await execute(await compiler(), [
      '/nologo', '/target:winexe', '/optimize+', '/platform:anycpu',
      `/win32icon:${path.resolve('resources/branding/app.ico')}`,
      '/reference:System.Windows.Forms.dll',
      `/resource:${core},PortalDesktop.SetupCore.exe`,
      `/resource:${path.resolve('package.json')},PortalDesktop.PackageJson`,
      `/out:${wrapper}`,
      path.resolve('scripts/windows-installer-bootstrap.cs'),
    ], { windowsHide: true });
    await rename(wrapper, setup);
    await unlink(core);
  } catch (error) {
    await unlink(wrapper).catch(() => {});
    await rename(core, setup).catch(() => {});
    throw error;
  }
}
