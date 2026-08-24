import react from '@vitejs/plugin-react';
import { defineConfig, type PluginOption } from 'vite';

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

/**
 * The faces the first screen actually paints with, preloaded.
 *
 * Not a guess: Lighthouse's `layout-shifts` audit names these five as the cause of the shift on
 * `/product/uzbek-devzira-rice`, which measured CLS 0.381 - 18.3 points, the worst in the shop and
 * on the page that sells things. `@fontsource` ships every face `font-display: swap`, so the page
 * paints in a fallback and then reflows when each woff2 lands; a preload gets them into the same
 * round trip as the stylesheet, so the reflow has nothing to reflow from.
 *
 * Five and not twelve, deliberately. A preload is a promise that the file is needed immediately,
 * and twelve of them would compete with the JavaScript for the same bandwidth - the italic,
 * 700-weight and mono faces appear below the fold or not at all on most screens, and swapping
 * those in costs a shift too small to score.
 *
 * The alternative was `font-display: optional`, which removes the shift by never swapping. That
 * one is design's call and not an engineering one: on a cold mobile load it renders the whole shop
 * in a system font, and the typography is the brand (decisions D-1 and D-9).
 */
const PRELOAD_FONTS = [
  // Anchored on .woff2: @fontsource emits a .woff beside every face, and an unanchored pattern
  // matches both, which is how this list first claimed ten faces where five were asked for.
  /^inter-latin-400-normal-.*\.woff2$/,
  /^inter-latin-600-normal-.*\.woff2$/,
  /^cormorant-garamond-latin-500-normal-.*\.woff2$/,
  /^cormorant-garamond-latin-600-normal-.*\.woff2$/,
  /^dm-serif-display-latin-400-normal-.*\.woff2$/,
];

function preloadFonts(): PluginOption {
  return {
    name: 'silkgrain-preload-fonts',
    apply: 'build',
    // `enforce: post` so the bundle is written and the hashed filenames are known.
    enforce: 'post',
    transformIndexHtml(_html, context) {
      const names = Object.keys(context.bundle ?? {}).filter((name) =>
        PRELOAD_FONTS.some((pattern) => pattern.test(name.replace(/^assets\//, ''))),
      );

      // Silence would mean a renamed font quietly stops being preloaded and the shift comes back
      // with nothing to point at. The build says so instead.
      if (names.length !== PRELOAD_FONTS.length) {
        throw new Error(
          `preload-fonts: matched ${String(names.length)} of ${String(PRELOAD_FONTS.length)} faces. ` +
            `Fonts were renamed or dropped - update PRELOAD_FONTS in apps/web/vite.config.ts.`,
        );
      }

      return names.map((name) => ({
        tag: 'link',
        attrs: {
          rel: 'preload',
          as: 'font',
          type: 'font/woff2',
          href: `/${name}`,
          // Fonts are always fetched anonymously, even same-origin. Without this the preload is
          // a second, unused download rather than a warm cache entry.
          crossorigin: '',
        },
        injectTo: 'head-prepend' as const,
      }));
    },
  };
}

export default defineConfig({
  plugins: [react(), preloadFonts()],
  server: { port: 5173, proxy },
  preview: { port: 4173, proxy },
  build: {
    sourcemap: true,
    // Phase 8 enforces < 250 KB gzip for the main bundle; warn well before that.
    chunkSizeWarningLimit: 600,
  },
});
