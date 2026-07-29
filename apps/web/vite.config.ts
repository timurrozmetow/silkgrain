import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
  build: {
    sourcemap: true,
    // Phase 8 enforces < 250 KB gzip for the main bundle; warn well before that.
    chunkSizeWarningLimit: 600,
  },
});
