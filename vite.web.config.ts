import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** Browser development preview; desktop development uses electron.vite.config.ts. */
export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  plugins: [react()],
  cacheDir: resolve(__dirname, '.vite/web-preview'),
  clearScreen: false,
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
});
