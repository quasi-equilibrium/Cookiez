import { defineConfig } from 'vite';

// Simple config: no CDN, no external services.
export default defineConfig({
  base: './',
  server: {
    port: 5173,
    strictPort: false
  },
  build: {
    sourcemap: true
  }
});

