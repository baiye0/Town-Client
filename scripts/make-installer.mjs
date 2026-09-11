import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { build, Platform, Arch } from 'electron-builder';

// Forge continues to build the application and portable ZIP on both platforms.
// Only the Windows installer is delegated to electron-builder's standard NSIS target.
if (process.platform === 'win32') {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  await build({
    targets: Platform.WINDOWS.createTarget('nsis', Arch.x64),
    prepackaged: path.resolve(`out/${pkg.productName}-win32-x64`),
    publish: 'never',
    config: {
      appId: 'town.beings.portal-desktop',
      productName: pkg.productName,
      executableName: 'portal-desktop',
      directories: { output: 'out/make/nsis/x64', buildResources: 'resources/branding' },
      win: { icon: 'resources/branding/app.ico', signAndEditExecutable: false },
      nsis: {
        oneClick: false, perMachine: false, allowElevation: false,
        allowToChangeInstallationDirectory: true,
        runAfterFinish: true, deleteAppDataOnUninstall: false,
        artifactName: 'portal-desktop-${version}-windows-x64-Setup.exe',
        include: 'scripts/installer.nsh',
        installerLanguages: ['en_US', 'zh_CN'],
      },
    },
  });
}
