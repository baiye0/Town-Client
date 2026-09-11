import type { ForgeConfig } from '@electron-forge/shared-types';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { existsSync } from 'node:fs';
import path from 'node:path';

const binary = path.resolve('resources', process.platform === 'win32' ? 'heart-portal.exe' : 'heart-portal');
const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    // Packager also derives macOS's display name from its executable name.
    executableName: process.platform === 'darwin' ? 'Portal Desktop' : 'portal-desktop',
    appBundleId: 'town.beings.portal-desktop',
    icon: path.resolve('resources/branding/app'),
    extraResource: [binary, path.resolve('resources/HEART-PORTAL-LICENSE'), path.resolve('resources/branding'), path.resolve('resources/runtime-bundle.json')],
  },
  hooks: {
    prePackage: async () => {
      if (!existsSync(binary)) throw new Error('Portal binary missing. Run npm run build:portal first.');
    },
  },
  makers: [new MakerZIP({}, ['darwin', 'linux', 'win32']), new MakerSquirrel({ name: 'portal-desktop', setupIcon: path.resolve('resources/branding/app.ico') })],
  plugins: [new VitePlugin({
    build: [
      { entry: 'desktop/main.ts', config: 'vite.main.config.ts', target: 'main' },
      { entry: 'desktop/preload.ts', config: 'vite.preload.config.ts', target: 'preload' },
    ],
    renderer: [{ name: 'main_window', config: 'vite.renderer.config.ts' }],
  })],
};
export default config;
