import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * The API proxy, shared by `vite dev` and `vite preview`.
 *
 * `preview` needs its own copy - it does not inherit `server.proxy` - and without it the
 * production build serves a storefront whose every request 404s. That matters beyond
 * convenience: Lighthouse has to be run against the built bundle, not the dev server, and a
 * preview that cannot reach the API would measure an empty page and call it fast.
 */
const proxy = {
  // `127.0.0.1` rather than `localhost`, deliberately: the API binds IPv4 only (`0.0.0.0:3001`)
  // while `localhost` can resolve to `::1` first, and a proxy aimed at an address nothing
  // listens on hangs rather than failing. Belt and braces - it has not bitten here yet.
  '/api': { target: 'http://127.0.0.1:3001', changeOrigin: true },
};

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy },
  preview: { port: 4173, proxy },
  build: {
    sourcemap: true,
    // Phase 8 enforces < 250 KB gzip for the main bundle; warn well before that.
    chunkSizeWarningLimit: 600,
  },
});
