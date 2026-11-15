import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The web app lives in web/ and is built into dist/web, which the server serves.
export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: { outDir: '../dist/web', emptyOutDir: true },
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:4700', '/mcp': 'http://127.0.0.1:4700' },
  },
});
