import { Money } from '@silkgrain/contracts/money';

import { loadDotEnv } from '../config/dotenv';
import { loadDesignCatalog, type DesignProduct } from '../db/seed/catalog-data';
import { makeSku, originCode, parseWeightLabel } from '../db/seed/helpers';
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

/**
 * The mappings, taken from `db/seed/index.ts` rather than reinvented.
 *
 * A second copy of "which origin code is Turkmenistan" or "how a weight label becomes milligrams"
 * would be a second answer to a question that already has one, and the two would drift the first
 * time either was corrected. `parseWeightLabel`, `originCode` and `makeSku` are imported from the
 * seed's own helpers; what is written out here is only what the seed expresses inline.
 */
function categoryPayload(category: { key: string; label: string; icon: string }, position: number) {
  return {
    slug: category.key,
    name: category.label,
    description: null,
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

  say('\nDone.');
  if (!config.dryRun) {
    say(
      'Category descriptions are deliberately empty: the mockup gives categories a name and an\n' +
        'icon and no copy, and inventing some here would put words in the shop that nobody wrote.\n' +
        'They are typed on the Categories screen, where a hero image can be replaced too.',
    );
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
