import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// Simple config: no CDN, no external services.
export default defineConfig({
  base: './',
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      '/lobby-ws': {
        target: 'ws://127.0.0.1:8765',
        ws: true,
        changeOrigin: true
      }
    }
  },
  build: {
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        lobby: resolve(__dirname, 'lobby.html')
      }
    }
  }
});

