import { defineConfig } from 'vite';

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
    sourcemap: true
  }
});
