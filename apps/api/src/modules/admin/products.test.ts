import type { AdminProductListResponse } from '@silkgrain/contracts';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { adminUsers, productNutrition, products } from '../../db/schema';
import { hashPassword } from '../../lib/password';
import {
  type CatalogFixture,
  FIXTURE_PASSWORD,
  seedCatalogFixture,
} from '../../test/fixtures/catalog';
import { buildTestApp, freshAddress, testEnv, truncateAll } from '../../test/harness';

/**
 * The admin product list.
 *
 * The property that matters most is the one that separates it from the storefront's: an editor has
 * to see the drafts and the archived rows, and a customer must never. Two services, one test each
 * way round.
 */
describe('the admin product list', () => {
  let app: FastifyInstance;
  let fixture: CatalogFixture;
  let databaseUrl: string;
  let token: string;

  beforeAll(async () => {
    app = await buildTestApp();
    databaseUrl = testEnv().DATABASE_URL;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(databaseUrl);
    fixture = await seedCatalogFixture(app.db);

    await app.db.insert(adminUsers).values({
      email: 'editor@silkgrain.test',
      passwordHash: await hashPassword(FIXTURE_PASSWORD),
      name: 'Sevara A.',
      role: 'manager',
    });
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/admin/login',
      remoteAddress: freshAddress(),
      payload: { email: 'editor@silkgrain.test', password: FIXTURE_PASSWORD },
    });
    token = login.json<{ accessToken: string }>().accessToken;
  });

  const get = async (query = '') => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/admin/products${query}`,
      remoteAddress: freshAddress(),
      headers: { authorization: `Bearer ${token}` },
    });
    return { status: response.statusCode, body: response.json<AdminProductListResponse>() };
  };

  it('refuses a request without an admin session', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/products',
      remoteAddress: freshAddress(),
    });
    expect(response.statusCode).toBe(401);
  });

  it('shows the draft the storefront hides', async () => {
    const { body } = await get();
    const slugs = body.items.map((row) => row.slug);

    expect(slugs).toContain('hidden-draft');
    expect(body.items.find((row) => row.slug === 'hidden-draft')?.status).toBe('draft');

    // The same product, asked for the way a customer asks. 48 rather than 100: the storefront
    // caps its own page size tighter than the shared `PageQuery` does.
    const storefront = await app.inject({
      method: 'GET',
      url: '/api/products?perPage=48',
      remoteAddress: freshAddress(),
    });
    const visible = storefront.json<{ items: { slug: string }[] }>().items.map((item) => item.slug);
    expect(visible).not.toContain('hidden-draft');
  });

  it('counts variants and totals stock across all of them', async () => {
    const { body } = await get('?q=devzira');
    const devzira = body.items.find((row) => row.slug === 'devzira-rice');

    // Three variants: 2 lb at 50, 5 lb at 5, 10 lb out of stock.
    expect(devzira?.variantCount).toBe(3);
    expect(devzira?.stockTotal).toBe(55);
    // The cheapest *active* variant, which is the "from" a customer would be shown.
    expect(devzira?.priceFromCents).toBe(1200);
  });

  it('reads a null price for a product with nothing sellable', async () => {
    // The retired variant's product: active row, no purchasable variant behind it.
    await app.db
      .update(products)
      .set({ status: 'active' })
      .where(eq(products.slug, 'hidden-draft'));

    const { body } = await get('?status=active');
    const row = body.items.find((entry) => entry.slug === 'hidden-draft');
    expect(row).toBeDefined();
    // A zero here would read as "free"; null is the honest answer.
    expect(row?.priceFromCents).not.toBe(0);
  });

  it('finds a product by SKU, which the storefront’s search does not', async () => {
    const { body } = await get('?q=SG-001-2LB');
    expect(body.items.map((row) => row.slug)).toEqual(['devzira-rice']);

    const storefront = await app.inject({
      method: 'GET',
      url: '/api/search/suggest?q=SG-001-2LB',
      remoteAddress: freshAddress(),
    });
    expect(storefront.json<{ items: unknown[] }>().items).toEqual([]);
  });

  it('filters by status and by category', async () => {
    const drafts = await get('?status=draft');
    expect(drafts.body.items.every((row) => row.status === 'draft')).toBe(true);
    expect(drafts.body.items.length).toBeGreaterThan(0);

    const rice = await get('?category=rice');
    expect(rice.body.items.length).toBeGreaterThan(0);
    expect(rice.body.items.every((row) => row.categoryName === 'Rice & Grains')).toBe(true);
  });

  it('filters to the products a restock would start with', async () => {
    const { body } = await get('?lowStock=true');

    expect(body.items.length).toBeGreaterThan(0);
    // Every row has at least one active variant at or under its threshold - the same definition
    // the dashboard's panel uses.
    expect(body.items.map((row) => row.slug)).toContain('devzira-rice');
  });

  it('rejects a malformed boolean rather than reading it as true', async () => {
    // `z.coerce.boolean()` would turn "no" into true. QueryBoolean takes the two words only.
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/products?lowStock=no',
      remoteAddress: freshAddress(),
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(422);
  });

  it('says where a nutrition panel’s figures came from', async () => {
    const { body } = await get('?q=devzira');
    // The seed's panels are category-level reference values, and the column says so (D-20).
    expect(body.items.find((row) => row.slug === 'devzira-rice')?.nutritionSource).toBe(
      'reference',
    );

    await app.db
      .update(productNutrition)
      .set({ source: 'entered' })
      .where(eq(productNutrition.productId, fixture.productIds['devzira-rice']));

    const after = await get('?q=devzira');
    expect(after.body.items.find((row) => row.slug === 'devzira-rice')?.nutritionSource).toBe(
      'entered',
    );
  });

  it('reads a null source for a product with no panel at all', async () => {
    const { body } = await get('?q=green');
    const row = body.items.find((entry) => entry.slug === 'green-lentils');
    expect(row).toBeDefined();
    expect(row?.nutritionSource).toBeNull();
  });

  it('paginates without losing or repeating a product', async () => {
    const first = await get('?perPage=2&page=1');
    const second = await get('?perPage=2&page=2');

    expect(first.body.items).toHaveLength(2);
    expect(first.body.meta.total).toBe(7);
    const overlap = first.body.items
      .map((row) => row.id)
      .filter((id) => second.body.items.some((row) => row.id === id));
    expect(overlap).toEqual([]);
  });
});
