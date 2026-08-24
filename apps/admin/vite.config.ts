import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * The API proxy, shared by `vite dev` and `vite preview`.
 *
 * `127.0.0.1` rather than `localhost`: the API binds IPv4 only, while `localhost` can resolve to
 * `::1` first, and a proxy aimed at an address nothing listens on hangs rather than failing.
 */
const proxy = {
  '/api': { target: 'http://127.0.0.1:3001', changeOrigin: true },
};

export default defineConfig({
  plugins: [react()],
  // Served from /admin in production; Nginx maps the same prefix to this build.
  base: '/admin/',
  server: { port: 5174, proxy },
  // `preview` does not inherit `server.proxy`, and without it the built admin serves a shell
  // whose every request 404s. Same reason the storefront's config carries both.
  preview: { port: 4174, proxy },
  build: {
    sourcemap: true,
  },
});
