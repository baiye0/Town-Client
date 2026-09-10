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
    executableName: 'beings',
    appBundleId: 'town.beings.desktop',
    extraResource: [binary, path.resolve('resources/HEART-PORTAL-LICENSE')],
  },
  hooks: {
    prePackage: async () => {
      if (!existsSync(binary)) throw new Error('Portal binary missing. Run npm run build:portal first.');
    },
  },
  makers: [new MakerZIP({}, ['darwin', 'linux', 'win32']), new MakerSquirrel({ name: 'beings' })],
  plugins: [new VitePlugin({
    build: [
      { entry: 'desktop/main.ts', config: 'vite.main.config.ts', target: 'main' },
      { entry: 'desktop/preload.ts', config: 'vite.preload.config.ts', target: 'preload' },
    ],
    renderer: [{ name: 'main_window', config: 'vite.renderer.config.ts' }],
  })],
};
export default config;
