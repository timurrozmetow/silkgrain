/**
 * Draws the brand mark and every raster a browser asks for, from the tokens rather than from a
 * design file nobody has.
 *
 * There is still no logo asset (decision D-9), and until there is, the mark is the mockup's own
 * lockup: the Phosphor `grains` glyph on a green tile, which `apps/web/.../Wordmark.tsx` already
 * draws in the header. This script writes that same shape as a standalone SVG and rasterises it,
 * so the tab icon, the iOS home-screen icon and the Android maskable icon are all one shape with
 * one source. D-9 said the favicon waits for a real SVG; what it was actually waiting for was a
 * decision about what to draw, and the header answered that a long time ago.
 *
 * Two deliberate departures from the header tile, both because a 16px tab icon is not a 34px
 * header lockup:
 *
 *   - the glyph is 78% of the tile rather than 59%. At the header's ratio the grains are four
 *     hairlines in a green square by the time a tab has finished shrinking it.
 *   - it is `parchment` on green, not `onDeep` on green - 5.7:1 rather than 4.6:1. Both clear AA
 *     as large text, but a favicon is rendered at 16 CSS pixels and thinned by antialiasing, and
 *     the extra stop is free: parchment is the site's own light surface, not a new colour.
 *
 * Everything here is geometry, so nothing depends on a font being installed. The wordmark and the
 * Open Graph card do, which is why they are not generated here - see STATE.md.
 *
 *   node scripts/make-icons.mjs
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** `color.green` and `color.parchment` from `packages/ui/src/tokens.ts`. */
const TILE = '#0E6B4A';
const GLYPH = '#F3F0E8';

/**
 * `radius.sm` is 4px on the header's 34px tile, which is 30/256 here.
 *
 * Scaled rather than picked, so the tab icon has the same corner as the header lockup at whatever
 * size the browser draws it.
 */
const CORNER = 30;

/** The glyph, as a share of the tile. See the header note above. */
const GLYPH_SCALE = 0.78;

/**
 * Phosphor `grains`, fill weight, verbatim from `@phosphor-icons/react`.
 *
 * Copied rather than imported because this script has no React and no bundler, and because a
 * favicon that changed shape when a dependency was upgraded would be worse than one that does
 * not. The registry (decision D-10) is where the icon is looked up at runtime; this is the one
 * place a copy of it is the right answer.
 */
const GRAINS_FILL =
  'M208,56a87.52,87.52,0,0,0-31.84,6c-14.32-29.7-43.25-44.46-44.57-45.13a8,8,0,0,0-7.16,0C123.1,17.51,' +
  '94.17,32.27,79.85,62A87.52,87.52,0,0,0,48,56a8,8,0,0,0-8,8v80a88.12,88.12,0,0,0,75.48,87.1,4,4,0,0,' +
  '0,4.52-4V176.27a8.18,8.18,0,0,1,7.47-8.25,8,8,0,0,1,8.53,8v51.14a4,4,0,0,0,4.52,4A88.12,88.12,0,0,' +
  '0,216,144V64A8,8,0,0,0,208,56Zm-88,93.46a88,88,0,0,0-64-37.09V72.44A72.1,72.1,0,0,1,120,144Zm8-42.1' +
  'A88.61,88.61,0,0,0,94.16,69.11c9.21-19.21,26.4-31.33,33.84-35.9,7.45,4.58,24.63,16.7,33.84,35.9A88.' +
  '61,88.61,0,0,0,128,107.36Zm72,5a88,88,0,0,0-64,37.09V144a72.1,72.1,0,0,1,64-71.56Z';

/**
 * The mark.
 *
 * `rounded` is false for the iOS and Android rasters: both platforms mask the icon themselves, and
 * a rounded corner inside their mask reads as a chipped one.
 */
function markSvg({ rounded = true } = {}) {
  const offset = (128 * (1 - GLYPH_SCALE)).toFixed(3);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256" role="img" aria-label="SilkGrain">
  <rect width="256" height="256"${rounded ? ` rx="${String(CORNER)}"` : ''} fill="${TILE}"/>
  <path transform="translate(${offset} ${offset}) scale(${String(GLYPH_SCALE)})" fill="${GLYPH}" d="${GRAINS_FILL}"/>
</svg>
`;
}

const png = (svg, size) =>
  sharp(Buffer.from(svg))
    .resize(size, size, { fit: 'contain' })
    .png({ compressionLevel: 9 })
    .toBuffer();

/**
 * An ICO wrapping PNGs rather than the format's original bitmaps.
 *
 * PNG-in-ICO has been read by every browser since Vista, and the alternative - a bottom-up BMP with
 * a separate one-bit AND mask - is a lot of byte-shuffling to support clients that cannot open the
 * site anyway. The header is six bytes, then one sixteen-byte directory entry per size.
 */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + images.length * 16;
  const entries = images.map(({ size, data }) => {
    const entry = Buffer.alloc(16);
    // 256 is written as 0: the field is one byte and the format says so.
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2); // palette size, 0 for truecolour
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });

  return Buffer.concat([header, ...entries, ...images.map((image) => image.data)]);
}

/**
 * The Open Graph card: what a pasted link looks like in a chat window or a feed.
 *
 * Without one, `seo.tsx` sets `twitter:card: summary` and every share of the shop is a line of
 * text. It was left undone once because the wordmark is Cormorant Garamond and rendering a webfont
 * outside a browser is its own problem - but `type.display` in the tokens declares the fallback
 * itself: `'Cormorant Garamond', Georgia, serif`. Georgia IS the sanctioned second choice, so a
 * card set in it is the design's own instruction rather than a substitution invented here.
 *
 * The card is generated once and committed as a PNG, so which serif the generating machine had is
 * settled at that moment and not at request time.
 *
 * Gold carries the second half of the wordmark and nothing else. D-7 bars gold from carrying text
 * on a light surface everywhere except the brand mark, which is exactly what this is; the tagline
 * underneath is `muted` on parchment, which clears AA.
 */
function ogCardSvg() {
  const serif = 'Cormorant Garamond, Georgia, Times New Roman, serif';
  const sans = 'Inter, Segoe UI, Helvetica, Arial, sans-serif';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#F3F0E8"/>
  <rect x="0" y="0" width="1200" height="14" fill="${TILE}"/>
  <rect x="0" y="616" width="1200" height="14" fill="#D3A73B"/>

  <g transform="translate(140 214)">
    <rect width="132" height="132" rx="15" fill="${TILE}"/>
    <path transform="translate(14.52 14.52) scale(0.4031)" fill="${GLYPH}" d="${GRAINS_FILL}"/>
  </g>

  <text x="316" y="318" font-family="${serif}" font-size="118" font-weight="600">
    <tspan fill="${TILE}">silk</tspan><tspan fill="#D3A73B">grain</tspan>
  </text>
  <text x="320" y="382" font-family="${sans}" font-size="30" letter-spacing="1.5" fill="#6B6456">Ancient Grains. Modern Table.</text>
  <text x="320" y="432" font-family="${sans}" font-size="24" fill="#6B6456">Central Asian rice, lentils, dried fruit and spices &#183; Houston, TX</text>
</svg>
`;
}

const MANIFEST = {
  name: 'SilkGrain',
  short_name: 'SilkGrain',
  description: 'Central Asian rice, lentils, dried fruit and spices, shipped fresh from Houston.',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  background_color: '#F3F0E8',
  theme_color: TILE,
  icons: [
    { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};

async function main() {
  const rounded = markSvg();
  const square = markSvg({ rounded: false });

  const webPublic = join(root, 'apps/web/public');
  const adminPublic = join(root, 'apps/admin/public');
  mkdirSync(webPublic, { recursive: true });
  mkdirSync(adminPublic, { recursive: true });

  const written = [];
  const write = (dir, name, data) => {
    writeFileSync(join(dir, name), data);
    written.push(
      `${dir.slice(root.length + 1).replace(/\\/g, '/')}/${name}  ${String(data.length)} bytes`,
    );
  };

  // The storefront gets the whole set; the panel gets a tab icon and nothing else. Nobody adds a
  // back office to their home screen, and `noindex, nofollow` already says what that page is for.
  write(webPublic, 'favicon.svg', Buffer.from(rounded));
  write(adminPublic, 'favicon.svg', Buffer.from(rounded));

  const legacy = await Promise.all(
    [16, 32, 48].map(async (size) => ({ size, data: await png(rounded, size) })),
  );
  write(webPublic, 'favicon.ico', ico(legacy));
  write(adminPublic, 'favicon.ico', ico(legacy));

  write(webPublic, 'apple-touch-icon.png', await png(square, 180));
  write(webPublic, 'icon-192.png', await png(rounded, 192));
  write(webPublic, 'icon-512.png', await png(rounded, 512));
  // Maskable icons are cropped to a platform-chosen shape, so the corner is left to the platform
  // and the glyph stays inside the 80% safe zone by being 78% of the tile.
  write(webPublic, 'icon-maskable-512.png', await png(square, 512));

  write(webPublic, 'site.webmanifest', Buffer.from(`${JSON.stringify(MANIFEST, null, 2)}\n`));

  // 1200x630 is what every platform crops from; anything smaller is upscaled in a feed.
  write(
    webPublic,
    'og-image.png',
    await sharp(Buffer.from(ogCardSvg())).png({ compressionLevel: 9 }).toBuffer(),
  );

  process.stdout.write(`${written.join('\n')}\n`);
}

await main();
