import { expect, it } from 'vitest';
import path from 'node:path';
import { handleInstallerEvent, installerEvent } from '../desktop/installer-events';
it('handles installer shortcut events without normal application startup', async () => {
  const calls: [string, string[]][] = [];
  const executable = path.resolve('install/app-0.1.1/beings.exe');
  const run = async (file: string, args: string[]) => { calls.push([file, args]); return ''; };
  expect(installerEvent(['beings.exe', '--squirrel-updated'])).toBe('--squirrel-updated');
  expect(installerEvent(['beings.exe', '--anything'])).toBeUndefined();
  await handleInstallerEvent('--squirrel-updated', executable, run);
  await handleInstallerEvent('--squirrel-uninstall', executable, run);
  await handleInstallerEvent('--squirrel-obsolete', executable, run);
  expect(calls).toEqual([
    [path.resolve('install/Update.exe'), ['--createShortcut', 'beings.exe']],
    [path.resolve('install/Update.exe'), ['--removeShortcut', 'beings.exe']],
  ]);
});
