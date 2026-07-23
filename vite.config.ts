import { defineConfig } from 'vite';

export default defineConfig({
  root: 'apps/modem-ui',
  server: {
    host: '127.0.0.1',
  },
  preview: {
    host: '127.0.0.1',
  },
  build: {
    outDir: '../../dist/modem-ui',
    emptyOutDir: true,
  },
});
