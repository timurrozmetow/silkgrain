import { Money } from '@silkgrain/contracts/money';

import { loadDotEnv } from '../config/dotenv';
import { loadDesignCatalog, type DesignProduct } from '../db/seed/catalog-data';
import { FAQ_CATEGORY_BY_INDEX, RECIPE_BODIES } from '../db/seed/data/reference';
import { makeSku, originCode, parseWeightLabel, slugify } from '../db/seed/helpers';
import { isMain } from '../lib/is-main';

/**
 * Fills a live shop with the design catalogue, through the API the panel uses.
 *
 * The six categories and sixteen products in `docs/design/catalog.json` are the only real content
 * this project has - written by the designer, with actual names, regions, copy and per-weight
 * prices. `db:seed` already puts them in a development database, and refuses production for good
 * reason: it also writes thirty-two demo products, fake orders and three administrators sharing a
 * password published in this repository.
 *
 * So this is the other half of that pair. It writes **only** the design catalogue, and it writes it
 * over HTTP as an administrator rather than into the database. Three things follow from that, and
 * they are the reason for the choice:
 *
 *   - every row goes through the same Zod schema, the same conflict checks and the same
 *     transaction the panel's own Save button uses, so nothing can be created here that the panel
 *     could not have created;
 *   - each write leaves an `audit_log` entry naming the administrator who ran it, which a direct
 *     INSERT would not;
 *   - photographs go through `processImage` into object storage, which is the only way they can be
 *     displayed at all. Production's CSP is `img-src 'self' data:` (decision D-52), so the
 *     Wikimedia address in the JSON is a place to fetch from and never a value to store: pasted
 *     into a field it would store cleanly, render as a blank rectangle, and report nothing.
 *
 * It is safe to run twice, and meant to be. Every step reads what is already there and creates only
 * what is missing, keyed by slug - so a run interrupted halfway is finished by running it again,
 * and a product somebody has since edited by hand is left exactly as they left it.
 *
 *   SILKGRAIN_API_URL=https://silkgrain.com \
 *   SILKGRAIN_ADMIN_EMAIL=... SILKGRAIN_ADMIN_PASSWORD=... \
 *   pnpm --filter @silkgrain/api catalog:fill
 *
 * The password comes from the environment and never from an argument, for the same reason
 * `db:bootstrap` takes it that way: `ps` shows one process's argv to every user on the box.
 * `--dry-run` prints the plan and writes nothing.
 */

/** `console` is banned in this package; a command-line tool still has to speak. */
const say = (line: string): void => {
  process.stdout.write(`${line}\n`);
};
const complain = (line: string): void => {
  process.stderr.write(`${line}\n`);
};

interface Config {
  baseUrl: string;
  email: string;
  password: string;
  dryRun: boolean;
}

function readConfig(argv: string[]): Config {
  const baseUrl = (process.env['SILKGRAIN_API_URL'] ?? 'http://127.0.0.1:3001').replace(/\/+$/, '');
  const email = process.env['SILKGRAIN_ADMIN_EMAIL'] ?? '';
  const password = process.env['SILKGRAIN_ADMIN_PASSWORD'] ?? '';

  const missing = [
    email === '' ? 'SILKGRAIN_ADMIN_EMAIL' : null,
    password === '' ? 'SILKGRAIN_ADMIN_PASSWORD' : null,
  ].filter((name): name is string => name !== null);

  if (missing.length > 0) {
    throw new Error(
      `Set ${missing.join(' and ')} before running this. The password is read from the ` +
        `environment rather than from an argument because ps shows argv to every user on the box.`,
    );
  }

  return { baseUrl, email, password, dryRun: argv.includes('--dry-run') };
}

// ------------------------------------------------------------------------------------ transport

interface ApiErrorBody {
  error?: { code?: string; message?: string; details?: unknown };
}

class ApiCallFailed extends Error {
  constructor(
    readonly status: number,
    readonly method: string,
    readonly path: string,
    message: string,
    readonly details: unknown,
  ) {
    super(`${method} ${path} -> ${String(status)}: ${message}`);
    this.name = 'ApiCallFailed';
  }
}

class Client {
  private token = '';

  constructor(private readonly baseUrl: string) {}

  async signIn(email: string, password: string): Promise<string> {
    const body = await this.call<{ accessToken: string; admin: { name: string; role: string } }>(
      'POST',
      '/api/auth/admin/login',
      { json: { email, password } },
    );
    this.token = body.accessToken;
    return `${body.admin.name} (${body.admin.role})`;
  }

  get<T>(path: string): Promise<T> {
    return this.call<T>('GET', path, {});
  }

  post<T>(path: string, json: unknown): Promise<T> {
    return this.call<T>('POST', path, { json });
  }

  upload<T>(path: string, form: FormData): Promise<T> {
    return this.call<T>('POST', path, { form });
  }

  private async call<T>(
    method: string,
    path: string,
    options: { json?: unknown; form?: FormData },
  ): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.token !== '') headers['Authorization'] = `Bearer ${this.token}`;
    // A FormData body must be left to set its own multipart boundary; naming the content type by
    // hand strips it and the server reads an empty file.
    if (options.json !== undefined) headers['Content-Type'] = 'application/json';

    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      ...(options.json !== undefined ? { body: JSON.stringify(options.json) } : {}),
      ...(options.form ? { body: options.form } : {}),
    });

    const text = await response.text();
    const body: unknown = text === '' ? null : safeJson(text);

    if (!response.ok) {
      const shaped = body as ApiErrorBody | null;
      throw new ApiCallFailed(
        response.status,
        method,
        path,
        shaped?.error?.message ?? text.slice(0, 200),
        shaped?.error?.details ?? null,
      );
    }
    return body as T;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// -------------------------------------------------------------------------------------- payloads

interface CategoryRow {
  id: number;
  slug: string;
  name: string;
  isActive: boolean;
  imageUrl: string | null;
}
interface CategoryNode extends CategoryRow {
  children: CategoryRow[];
}
interface ProductRow {
  id: number;
  slug: string;
  name: string;
  imageUrl: string | null;
}
interface RecipeRow {
  id: number;
  slug: string;
  title: string;
  imageUrl: string | null;
}
interface FaqRow {
  id: number;
  question: string;
}

/**
 * The mappings, taken from `db/seed/index.ts` rather than reinvented.
 *
 * A second copy of "which origin code is Turkmenistan" or "how a weight label becomes milligrams"
 * would be a second answer to a question that already has one, and the two would drift the first
 * time either was corrected. `parseWeightLabel`, `originCode` and `makeSku` are imported from the
 * seed's own helpers; what is written out here is only what the seed expresses inline.
 */
/**
 * A sentence under each category heading.
 *
 * These are the one piece of copy in this file that no designer wrote. The mockup gives a category
 * a name, an icon and a count and nothing else, and the category page has a paragraph slot under
 * its heading that renders as a blank line when the column is null. Written here so the shop reads
 * as finished, deliberately plain, and every one of them is a text box on the Categories screen -
 * this is a starting point to edit, not a decision about how the brand speaks.
 *
 * They describe what is in the category and where it comes from, and claim nothing that is not
 * already on the product pages.
 */
const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  rice: 'Heirloom rice and grains from the valleys that have grown them for centuries — aged devzira for plov, long-grain white for every day.',
  lentils:
    'Split lentils, mung beans and chickpeas, cleaned and graded by hand. The base of half the region’s cooking and most of its weeknights.',
  fruits:
    'Sun-dried apricots, raisins and plums, dried whole and untreated. Sweet enough that nothing needs to be added to them.',
  spices:
    'Zira, sumac and saffron bought in small lots and sold whole wherever whole is better. Ground the day it ships when it is not.',
  flour:
    'Stone-milled flour and seeds for flatbread, halva and everything the oven does in between.',
  mixes:
    'Everything for one dish in one box, measured for a household kazan. For the nights when the shopping list is the hard part.',
};

function categoryPayload(category: { key: string; label: string; icon: string }, position: number) {
  return {
    slug: category.key,
    name: category.label,
    description: CATEGORY_DESCRIPTIONS[category.key] ?? null,
    icon: category.icon.replace(/^ph-/, ''),
    parentId: null,
    position,
    metaTitle: `${category.label} | SilkGrain`,
    metaDescription: `Shop ${category.label.toLowerCase()} imported directly from Central Asian family farms.`,
    isActive: true,
  };
}

const variantCount = (product: DesignProduct): string =>
  product.weights.length === 1 ? '1 variant' : `${String(product.weights.length)} variants`;

/** `stock` is a word in the mockup - `in` or `low` - and this is the seed's own reading of it. */
const STOCK_QTY: Record<string, number> = { in: 140, low: 5, out: 0 };

function productPayload(product: DesignProduct, index: number, categoryId: number) {
  const badges = product.badges
    .map((badge) => badge.toLowerCase())
    .filter((badge): badge is 'bestseller' | 'new' | 'premium' =>
      ['bestseller', 'new', 'premium'].includes(badge),
    );

  return {
    name: product.name,
    slug: product.slug,
    subtitle: null,
    blurb: product.blurb,
    description: product.desc,
    story: product.region === 'Central Asia' ? null : `Sourced from ${product.region}.`,
    categoryId,
    origin: originCode(product.origin),
    originRegion: product.region,
    status: 'active' as const,
    isFeatured: product.badges.includes('Bestseller'),
    tone: product.tone,
    icon: product.icon.replace(/^ph-/, ''),
    metaTitle: `${product.name} | SilkGrain`,
    metaDescription: product.blurb,
    variants: product.weights.map((weight, weightIndex) => {
      const parsed = parseWeightLabel(weight.label);
      const priceCents = Money.fromAmount(weight.price).cents;
      return {
        sku: makeSku(index, weight.label),
        weightValueMilli: parsed.valueMilli,
        weightUnit: parsed.unit,
        weightLabel: parsed.label,
        weightGrams: parsed.grams,
        priceCents,
        compareAtPriceCents: null,
        costCents: Math.round(priceCents * 0.58),
        stockQty: STOCK_QTY[product.stock] ?? 0,
        lowStockThreshold: 10,
        position: weightIndex,
        isDefault: weight.label === product.defWeight,
        isActive: true,
      };
    }),
    certifications: product.badges.includes('Organic') ? (['organic'] as const) : [],
    badges,
    // No nutrition panel. Decision D-20: the figures are the owner's to enter in the product form,
    // and the seed's category-level averages are development scaffolding, not this shop's label.
    nutrition: null,
  };
}

// ---------------------------------------------------------------------------------- photographs

/**
 * Fetches one photograph so it can be uploaded to the shop's own storage.
 *
 * Wikimedia refuses a request with no `User-Agent`, and `Special:FilePath` answers with a redirect
 * to `upload.wikimedia.org`, which `fetch` follows on its own.
 *
 * The reason comes back rather than being printed here, because the two callers indent differently
 * and a shared logger got that wrong: a category hero that failed printed a line about a product
 * image, under no heading, and read as though the previous product had lost its photograph.
 * Failures are returned, never thrown - losing the other fifteen because one host was slow is not
 * a trade worth making, and the next run picks up exactly what this one missed.
 */
type Fetched = { ok: true; blob: Blob; name: string } | { ok: false; why: string };

async function fetchImage(url: string): Promise<Fetched> {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'SilkGrain catalogue loader (+https://silkgrain.com)' },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) return { ok: false, why: `${String(response.status)} from the source` };

    const type = response.headers.get('content-type') ?? '';
    if (!type.startsWith('image/')) {
      return { ok: false, why: `the source answered "${type}", not an image` };
    }

    const blob = await response.blob();
    // `processImage` re-encodes to webp regardless, so the extension only has to be plausible
    // enough for the multipart part to carry a filename.
    return { ok: true, blob, name: `source.${type.split('/')[1]?.split(';')[0] ?? 'jpg'}` };
  } catch (cause) {
    return { ok: false, why: cause instanceof Error ? cause.message : 'the fetch failed' };
  }
}

// ------------------------------------------------------------------------------------------ run

export async function fillCatalog(config: Config): Promise<void> {
  const design = loadDesignCatalog();
  const client = new Client(config.baseUrl);

  say(`SilkGrain catalogue fill -> ${config.baseUrl}`);
  if (config.dryRun) say('Dry run: nothing will be written.\n');

  const who = await client.signIn(config.email, config.password);
  say(`Signed in as ${who}\n`);

  // ------------------------------------------------------------------------------- categories
  let tree = await client.get<{ items: CategoryNode[] }>('/api/admin/categories');
  const idBySlug = new Map<string, number>();
  for (const node of tree.items) {
    idBySlug.set(node.slug, node.id);
    for (const child of node.children) idBySlug.set(child.slug, child.id);
  }

  const designKeys = new Set(design.categories.map((category) => category.key));

  say('Categories');
  for (const [index, category] of design.categories.entries()) {
    if (idBySlug.has(category.key)) {
      say(`  = ${category.label} (already there)`);
      continue;
    }
    if (config.dryRun) {
      say(`  + ${category.label} (would create)`);
      continue;
    }
    tree = await client.post<{ items: CategoryNode[] }>(
      '/api/admin/categories',
      categoryPayload(category, index),
    );
    const created = tree.items.find((node) => node.slug === category.key);
    if (!created) throw new Error(`The API accepted ${category.key} but did not return it`);
    idBySlug.set(category.key, created.id);
    say(`  + ${category.label}`);
  }

  // --------------------------------------------------------------------------------- products
  const existing = await client.get<{ items: ProductRow[] }>(
    '/api/admin/products?status=all&perPage=100',
  );
  const productBySlug = new Map(existing.items.map((row) => [row.slug, row]));

  say('\nProducts');
  for (const [index, product] of design.products.entries()) {
    const already = productBySlug.get(product.slug);

    if (already) {
      say(`  = ${product.name} (already there)`);
      await ensureImage(client, config, already.id, already.imageUrl, product);
      continue;
    }

    if (config.dryRun) {
      // A dry run created none of the categories above, so "does it exist" is the wrong question
      // here - the useful one is whether it will by the time the real run reaches this product.
      const willExist = idBySlug.has(product.catKey) || designKeys.has(product.catKey);
      if (!willExist) {
        say(`  ! ${product.name}: nothing creates its category "${product.catKey}"`);
        continue;
      }
      say(`  + ${product.name} (would create, ${variantCount(product)})`);
      await ensureImage(client, config, 0, null, product);
      continue;
    }

    const categoryId = idBySlug.get(product.catKey);
    if (categoryId === undefined) {
      // Unreachable: the loop above created every design category or failed loudly. A throw
      // rather than a skip, because silently leaving one product out of sixteen is the kind of
      // thing nobody notices until a customer does.
      throw new Error(`No category "${product.catKey}" for ${product.slug}`);
    }

    const created = await client.post<{ id: number }>(
      '/api/admin/products',
      productPayload(product, index, categoryId),
    );
    say(`  + ${product.name} (${variantCount(product)})`);
    await ensureImage(client, config, created.id, null, product);
  }

  // -------------------------------------------------------------------------- category heroes
  say('\nCategory heroes');
  const heroes = config.dryRun
    ? tree
    : await client.get<{ items: CategoryNode[] }>('/api/admin/categories');

  for (const category of design.categories) {
    const row = heroes.items.find((node) => node.slug === category.key);
    if (row?.imageUrl != null) {
      say(`  = ${category.label} (already has one)`);
      continue;
    }

    const source = heroFor(design.products, category.key);
    if (!source) {
      say(`  ! ${category.label}: no product in it carries a photograph`);
      continue;
    }
    if (config.dryRun || !row) {
      say(`  + ${category.label} (would use the photograph from ${source.name})`);
      continue;
    }

    const fetched = await fetchImage(source.imageUrl ?? '');
    if (!fetched.ok) {
      say(`  ! ${category.label}: ${fetched.why} - run again to retry it`);
      continue;
    }

    const form = new FormData();
    form.append('file', fetched.blob, fetched.name);
    try {
      await client.upload(`/api/admin/categories/${String(row.id)}/image`, form);
      say(`  + ${category.label} (from ${source.name})`);
    } catch (cause) {
      say(`  ! ${category.label}: ${cause instanceof Error ? cause.message : 'upload failed'}`);
    }
  }

  // -------------------------------------------------------------------------------- recipes
  //
  // The mockup gives a recipe a title, a time, a difficulty and a photograph, and no method. The
  // methods are in `db/seed/data/reference.ts`, written for the seed and reused here rather than
  // copied - the same rule the weight and origin mappings follow.
  say('\nRecipes');
  const recipeList = await client.get<{ items: RecipeRow[] }>('/api/admin/recipes');
  const recipeBySlug = new Map(recipeList.items.map((row) => [row.slug, row]));

  // Re-read, because the products created above are not in the list fetched before them, and a
  // recipe's ingredient links are ids.
  const catalogue = config.dryRun
    ? existing
    : await client.get<{ items: ProductRow[] }>('/api/admin/products?status=all&perPage=100');
  const idByProductSlug = new Map(catalogue.items.map((row) => [row.slug, row.id]));

  for (const recipe of design.recipes) {
    const slug = slugify(recipe.title);
    const content = RECIPE_BODIES[slug];
    if (!content) {
      say(`  ! ${recipe.title}: no method written for it in the seed's reference data`);
      continue;
    }

    const already = recipeBySlug.get(slug);
    if (already) {
      say(`  = ${recipe.title} (already there)`);
      await ensureRecipeImage(client, config, already, recipe.img);
      continue;
    }
    if (config.dryRun) {
      say(`  + ${recipe.title} (would create)`);
      continue;
    }

    // A recipe referring to a product this shop does not stock is dropped from the link list
    // rather than failing the recipe: the seed's methods were written against its own thirty-two
    // products, and only the design's sixteen are here.
    const wanted = content.products;
    const productIds = wanted
      .map((productSlug) => idByProductSlug.get(productSlug))
      .filter((id): id is number => id !== undefined);
    const dropped = wanted.length - productIds.length;

    const created = await client.post<RecipeRow>('/api/admin/recipes', {
      title: recipe.title,
      slug,
      excerpt: recipe.blurb,
      body: content.body,
      prepMinutes: content.prepMinutes,
      cookMinutes: content.cookMinutes,
      servings: content.servings,
      difficulty:
        recipe.level === 'Easy' ? 'easy' : recipe.level === 'Advanced' ? 'hard' : 'medium',
      imageAlt: recipe.title,
      metaTitle: `${recipe.title} | SilkGrain Recipes`,
      metaDescription: recipe.blurb,
      productIds,
      isPublished: true,
    });
    say(
      `  + ${recipe.title} (${String(productIds.length)} ingredients linked` +
        `${dropped > 0 ? `, ${String(dropped)} not stocked` : ''})`,
    );
    await ensureRecipeImage(client, config, created, recipe.img);
  }

  // ------------------------------------------------------------------------------------- FAQ
  say('\nHelp & FAQ');
  const faqList = await client.get<{ items: FaqRow[] }>('/api/admin/faqs');
  const askedAlready = new Set(faqList.items.map((row) => row.question));

  for (const [index, faq] of design.faqs.entries()) {
    if (askedAlready.has(faq.q)) {
      say(`  = ${short(faq.q)} (already there)`);
      continue;
    }
    if (config.dryRun) {
      say(`  + ${short(faq.q)} (would add)`);
      continue;
    }
    await client.post('/api/admin/faqs', {
      category: FAQ_CATEGORY_BY_INDEX[index] ?? 'ordering',
      question: faq.q,
      answer: faq.a,
      position: index,
      isPublished: true,
    });
    say(`  + ${short(faq.q)}`);
  }

  say('\nDone.');
  if (!config.dryRun) {
    say(
      'Two things are still empty, and both on purpose:\n' +
        '  - Nutrition panels. The only figures available are category reference averages, and\n' +
        '    the admin form marks anything it saves as `entered` - which would say a person had\n' +
        '    checked them against a supplier certificate. On a food label that is not a rounding\n' +
        '    error. They go in per product, from the real analysis (D-20).\n' +
        '  - Customer reviews, and so the testimonials rail on the home page. Writing those would\n' +
        '    be inventing customers. The rail draws itself the day a real one arrives.',
    );
  }
}

/** A question, shortened for one line of output. */
const short = (value: string): string =>
  value.length <= 56 ? value : `${value.slice(0, 55).trimEnd()}…`;

async function ensureRecipeImage(
  client: Client,
  config: Config,
  recipe: RecipeRow,
  source: string,
): Promise<void> {
  if (recipe.imageUrl !== null) return;
  if (config.dryRun) {
    say('      image: would fetch and upload');
    return;
  }

  const fetched = await fetchImage(source);
  if (!fetched.ok) {
    say(`      image: ${fetched.why} - run again to retry it`);
    return;
  }

  const form = new FormData();
  form.append('file', fetched.blob, fetched.name);
  try {
    await client.upload(`/api/admin/recipes/${String(recipe.id)}/image`, form);
    say('      image: uploaded');
  } catch (cause) {
    say(`      image: ${cause instanceof Error ? cause.message : 'upload failed'}`);
  }
}

/**
 * Which photograph stands in as a category's hero.
 *
 * The design gives a category a name, an icon and a product count, and no photograph - so the only
 * honest source is the category's own stock. The **last** product with one, not the first: the hero
 * band sits directly above the grid, and taking the first would put the same picture twice in the
 * first 400 pixels of the page.
 *
 * It costs nothing to store. `processImage` keys an object by the hash of its contents, so the
 * hero and the product card are the same object in the bucket, uploaded twice and stored once.
 */
function heroFor(products: DesignProduct[], categoryKey: string): DesignProduct | undefined {
  const inCategory = products.filter(
    (product) => product.catKey === categoryKey && product.imageUrl !== null,
  );
  return inCategory[inCategory.length - 1];
}

async function ensureImage(
  client: Client,
  config: Config,
  productId: number,
  currentImage: string | null,
  product: DesignProduct,
): Promise<void> {
  if (product.imageUrl === null) return;
  // Already has one: whatever it is, somebody chose it, and this command does not overwrite.
  if (currentImage !== null) return;
  if (config.dryRun) {
    say(`      image: would fetch and upload`);
    return;
  }

  const fetched = await fetchImage(product.imageUrl);
  if (!fetched.ok) {
    say(`      image: ${fetched.why} - run again to retry it`);
    return;
  }

  const form = new FormData();
  form.append('file', fetched.blob, fetched.name);
  form.append('alt', `${product.name} - ${product.blurb}`);

  try {
    await client.upload(`/api/admin/products/${String(productId)}/images`, form);
    say(`      image: uploaded`);
  } catch (cause) {
    say(`      image: ${cause instanceof Error ? cause.message : 'upload failed'}`);
  }
}

if (isMain(import.meta.url)) {
  loadDotEnv();
  fillCatalog(readConfig(process.argv.slice(2))).catch((error: unknown) => {
    complain(`\n${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof ApiCallFailed && error.details !== null) {
      complain(JSON.stringify(error.details, null, 2));
    }
    process.exitCode = 1;
  });
}
