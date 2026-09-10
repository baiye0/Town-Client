import { defineConfig } from 'vite';
import path from 'node:path';
export default defineConfig({
  root: 'desktop/renderer', publicDir: '../generated', base: './',
  build: { outDir: path.resolve('.vite/renderer/main_window') },
});
