/**
 * Extracts the catalogue data out of the design mockup into `docs/design/catalog.json`.
 *
 * The mockup is the only place this content exists: sixteen products with real names,
 * regions, blurbs, descriptions and per-weight prices, written by the designer rather than
 * generated. Phase 2 seeds from the JSON so nobody has to re-read a 227 KB prototype, and
 * re-running this after a new handoff shows exactly what the designer changed.
 *
 *   node scripts/extract-design-data.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(root, 'silkgrain-design-prompt/for adaptive/SilkGrain Premium.dc.html');
const TARGET = join(root, 'docs/design/catalog.json');

const html = readFileSync(SOURCE, 'utf8');

/** Pulls `name = [ ... ];` out of the prototype's component class. */
function extractArray(name) {
  const match = new RegExp(String.raw`\b${name}\s*=\s*(\[[\s\S]*?\n\s*\];)`).exec(html);
  if (!match) throw new Error(`Could not find the "${name}" array in ${SOURCE}`);
  // The literal is JavaScript, not JSON: unquoted keys and single quotes. Evaluating it is
  // safe here because the input is a file committed to this repository, and it beats
  // hand-writing a parser for a format we do not control.
  return JSON.parse(JSON.stringify(new Function(`return ${match[1].replace(/;$/, '')}`)()));
}

const products = extractArray('products');
const categories = extractArray('categories');
const demoCart = extractArray('cartRaw');

/** Image URLs live in a separate lookup keyed by slug. */
const imgMatch = /const IMG=\{([\s\S]*?)\};/.exec(html);
const images = {};
if (imgMatch) {
  const MD = 'https://www.themealdb.com/images/ingredients/';
  const WC = (n) => `https://commons.wikimedia.org/wiki/Special:FilePath/${n}?width=600`;
  const entries = new Function('MD', 'WC', `return {${imgMatch[1]}}`)(MD, WC);
  Object.assign(images, entries);
}

const catalog = {
  $comment:
    'Extracted from silkgrain-design-prompt/for adaptive/SilkGrain Premium.dc.html by ' +
    'scripts/extract-design-data.mjs. Do not edit by hand - re-run the script instead. ' +
    'Prices are dollars as authored; the seed converts them to integer cents.',
  categories,
  products: products.map((product) => ({
    ...product,
    imageUrl: images[product.slug] ?? null,
  })),
  demoCart,
};

mkdirSync(dirname(TARGET), { recursive: true });
writeFileSync(TARGET, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');

console.log(
  `Wrote ${String(products.length)} products, ${String(categories.length)} categories to ${TARGET}`,
);
