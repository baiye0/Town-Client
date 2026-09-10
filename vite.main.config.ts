import { defineConfig } from 'vite';
export default defineConfig({ define: { TOWN_UPDATE_REPOSITORY: JSON.stringify(process.env.TOWN_UPDATE_REPOSITORY || 'baiye0/Town-Client') }, build: { rollupOptions: { external: ['electron'] } } });
