import type { AdminProductDetail, AdminProductInput } from '@silkgrain/contracts';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { adminUsers, productNutrition, productVariants, products } from '../../db/schema';
import { hashPassword } from '../../lib/password';
import {
  type CatalogFixture,
  FIXTURE_PASSWORD,
  seedCatalogFixture,
} from '../../test/fixtures/catalog';
import { buildTestApp, freshAddress, testEnv, truncateAll } from '../../test/harness';

/**
 * Creating and editing a product from the admin form.
 *
 * The rules being guarded: a save is all-or-nothing, a variant the payload omits is deleted, ids
 * survive an edit because other tables have written them down, and a panel that comes through this
 * form is marked `entered` rather than left looking like the seed's reference figures.
 */
describe('the admin product writer', () => {
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

  const auth = () => ({ authorization: `Bearer ${token}` });

  const post = (body: object) =>
    app.inject({
      method: 'POST',
      url: '/api/admin/products',
      remoteAddress: freshAddress(),
      headers: auth(),
      payload: body,
    });

  const put = (id: number, body: object) =>
    app.inject({
      method: 'PUT',
      url: `/api/admin/products/${String(id)}`,
      remoteAddress: freshAddress(),
      headers: auth(),
      payload: body,
    });

  const read = async (id: number) => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/admin/products/${String(id)}`,
      remoteAddress: freshAddress(),
      headers: auth(),
    });
    return { status: response.statusCode, body: response.json<AdminProductDetail>() };
  };

  const NEW_PRODUCT = (): AdminProductInput => ({
    name: 'Bukhara Mung Beans',
    slug: 'bukhara-mung-beans',
    blurb: 'Small green mung beans from the Bukhara oasis, sorted by hand.',
    description: 'Cooks down in twenty minutes and holds its shape in a mash.',
    categoryId: 0, // replaced per test
    origin: 'UZ',
    status: 'active',
    isFeatured: false,
    variants: [
      {
        sku: 'SG-900-1LB',
        weightValueMilli: 1000,
        weightUnit: 'lb',
        weightLabel: '1 lb',
        weightGrams: 454,
        priceCents: 690,
        stockQty: 40,
        lowStockThreshold: 8,
        position: 0,
        isDefault: true,
        isActive: true,
      },
      {
        sku: 'SG-900-5LB',
        weightValueMilli: 5000,
        weightUnit: 'lb',
        weightLabel: '5 lb',
        weightGrams: 2268,
        priceCents: 2990,
        compareAtPriceCents: 3400,
        stockQty: 12,
        lowStockThreshold: 4,
        position: 1,
        isDefault: false,
        isActive: true,
      },
    ],
    certifications: ['organic', 'non_gmo'],
    badges: ['new'],
    nutrition: null,
  });

  const withCategory = (input: AdminProductInput): AdminProductInput => ({
    ...input,
    categoryId: fixture.categoryIds.lentils,
  });

  it('refuses every write without an admin session', async () => {
    const unauthenticated = [
      app.inject({ method: 'GET', url: '/api/admin/products/1', remoteAddress: freshAddress() }),
      app.inject({
        method: 'POST',
        url: '/api/admin/products',
        remoteAddress: freshAddress(),
        payload: {},
      }),
      app.inject({
        method: 'PUT',
        url: '/api/admin/products/1',
        remoteAddress: freshAddress(),
        payload: {},
      }),
    ];

    for (const response of await Promise.all(unauthenticated)) {
      // 401 before validation: an unauthenticated request must not learn the body's shape either.
      expect(response.statusCode).toBe(401);
    }
  });

  it('creates a product with its variants, certifications and badges', async () => {
    const response = await post(withCategory(NEW_PRODUCT()));
    expect(response.statusCode).toBe(201);

    const created = response.json<AdminProductDetail>();
    expect(created.slug).toBe('bukhara-mung-beans');
    expect(created.variants).toHaveLength(2);
    expect(created.variants.map((variant) => variant.sku)).toEqual(['SG-900-1LB', 'SG-900-5LB']);
    expect(created.certifications.sort()).toEqual(['non_gmo', 'organic']);
    expect(created.badges).toEqual(['new']);
    // Active on creation, so it has a publish date to sort "newest" by.
    const [row] = await app.db.select().from(products).where(eq(products.id, created.id));
    expect(row?.publishedAt).not.toBeNull();
  });

  it('leaves a draft undated so it cannot lead "newest"', async () => {
    const response = await post({ ...withCategory(NEW_PRODUCT()), status: 'draft' });
    const created = response.json<AdminProductDetail>();

    const [row] = await app.db.select().from(products).where(eq(products.id, created.id));
    expect(row?.publishedAt).toBeNull();
  });

  it('keeps the first publish date when an active product is edited again', async () => {
    const created = (await post(withCategory(NEW_PRODUCT()))).json<AdminProductDetail>();
    const [before] = await app.db.select().from(products).where(eq(products.id, created.id));

    await put(created.id, { ...withCategory(NEW_PRODUCT()), name: 'Bukhara Mung Beans, sorted' });
    const [after] = await app.db.select().from(products).where(eq(products.id, created.id));

    // Re-stamping would push a product back to the top of "newest" every time a typo was fixed.
    expect(after?.publishedAt?.toISOString()).toBe(before?.publishedAt?.toISOString());
    expect(after?.name).toBe('Bukhara Mung Beans, sorted');
  });

  it('updates a variant in place rather than replacing its id', async () => {
    const created = (await post(withCategory(NEW_PRODUCT()))).json<AdminProductDetail>();
    const firstId = created.variants[0]?.id;
    expect(firstId).toBeDefined();

    const edited = withCategory(NEW_PRODUCT());
    edited.variants = created.variants.map((variant) => ({
      id: variant.id,
      sku: variant.sku,
      weightValueMilli: variant.weightValueMilli,
      weightUnit: variant.weightUnit,
      weightLabel: variant.weightLabel,
      weightGrams: variant.weightGrams,
      priceCents: variant.sku === 'SG-900-1LB' ? 750 : variant.priceCents,
      compareAtPriceCents: variant.compareAtPriceCents,
      costCents: variant.costCents,
      stockQty: variant.stockQty,
      lowStockThreshold: variant.lowStockThreshold,
      position: variant.position,
      isDefault: variant.isDefault,
      isActive: variant.isActive,
    }));

    const response = await put(created.id, edited);
    expect(response.statusCode).toBe(200);

    const after = response.json<AdminProductDetail>();
    // The id survives: `order_items` and `wishlist_items` have written it down.
    expect(after.variants[0]?.id).toBe(firstId);
    expect(after.variants[0]?.priceCents).toBe(750);
  });

  it('deletes a variant the payload leaves out, and keeps the order line that bought it', async () => {
    const created = (await post(withCategory(NEW_PRODUCT()))).json<AdminProductDetail>();
    const dropped = created.variants[1];
    expect(dropped).toBeDefined();

    const edited = withCategory(NEW_PRODUCT());
    edited.variants = [{ ...edited.variants[0]!, id: created.variants[0]?.id }];

    const response = await put(created.id, edited);
    expect(response.statusCode).toBe(200);
    expect(response.json<AdminProductDetail>().variants).toHaveLength(1);

    const remaining = await app.db
      .select({ id: productVariants.id })
      .from(productVariants)
      .where(eq(productVariants.productId, created.id));
    expect(remaining).toHaveLength(1);
  });

  it('marks a panel entered when it comes through the form, and clears it on request', async () => {
    const input = withCategory(NEW_PRODUCT());
    input.nutrition = {
      servingSize: '1/4 cup (45 g)',
      servingsPerContainer: 10,
      calories: 160,
      // Milligrams on the wire: 1.5 g of fat is 1500, exactly, with no fraction anywhere.
      fatMg: 1500,
      satFatMg: 200,
      carbsMg: 28000,
      sugarsMg: 1000,
      fiberMg: 7000,
      proteinMg: 11000,
      sodiumMg: 5,
      ingredientsText: 'Mung beans.',
      allergensText: null,
    };

    const created = (await post(input)).json<AdminProductDetail>();
    expect(created.nutrition?.fatMg).toBe(1500);
    // Decision D-20: the form is the only writer of `entered`.
    expect(created.nutritionSource).toBe('entered');

    const cleared = await put(created.id, { ...input, nutrition: null });
    expect(cleared.json<AdminProductDetail>().nutrition).toBeNull();
    expect(cleared.json<AdminProductDetail>().nutritionSource).toBeNull();
    const rows = await app.db
      .select()
      .from(productNutrition)
      .where(eq(productNutrition.productId, created.id));
    expect(rows).toHaveLength(0);
  });

  it('does not relabel a seeded panel as entered just because the product was edited', async () => {
    const devziraId = fixture.productIds['devzira-rice'];
    const before = await read(devziraId);
    expect(before.body.nutritionSource).toBe('reference');

    // Save the product back with its own panel untouched. Because the form sends the panel, it
    // becomes `entered` - which is correct: whoever pressed save is now answerable for it.
    const response = await put(devziraId, {
      name: before.body.name,
      slug: before.body.slug,
      blurb: before.body.blurb,
      description: before.body.description,
      categoryId: before.body.categoryId,
      origin: before.body.origin,
      status: before.body.status,
      isFeatured: before.body.isFeatured,
      variants: before.body.variants,
      certifications: before.body.certifications,
      badges: before.body.badges,
      nutrition: before.body.nutrition,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<AdminProductDetail>().nutritionSource).toBe('entered');
  });

  it('refuses a duplicate slug and a SKU another product already uses', async () => {
    const clashingSlug = await post({ ...withCategory(NEW_PRODUCT()), slug: 'devzira-rice' });
    expect(clashingSlug.statusCode).toBe(409);

    const input = withCategory(NEW_PRODUCT());
    input.variants[0]!.sku = 'SG-001-2LB';
    const clashingSku = await post(input);
    expect(clashingSku.statusCode).toBe(409);

    // Neither attempt left anything behind: the whole save is one transaction.
    const rows = await app.db
      .select({ id: products.id })
      .from(products)
      .where(eq(products.slug, 'bukhara-mung-beans'));
    expect(rows).toHaveLength(0);
  });

  it('lets a product keep its own slug and SKUs when saved unchanged', async () => {
    const created = (await post(withCategory(NEW_PRODUCT()))).json<AdminProductDetail>();
    const again = await put(created.id, {
      ...withCategory(NEW_PRODUCT()),
      variants: created.variants,
    });
    expect(again.statusCode).toBe(200);
  });

  it('rejects a product with no default variant, or two', async () => {
    const none = withCategory(NEW_PRODUCT());
    none.variants = none.variants.map((variant) => ({ ...variant, isDefault: false }));
    expect((await post(none)).statusCode).toBe(422);

    const both = withCategory(NEW_PRODUCT());
    both.variants = both.variants.map((variant) => ({ ...variant, isDefault: true }));
    expect((await post(both)).statusCode).toBe(422);
  });

  it('rejects a compare-at price that is not a markdown', async () => {
    const input = withCategory(NEW_PRODUCT());
    input.variants[0]!.compareAtPriceCents = input.variants[0]!.priceCents;
    expect((await post(input)).statusCode).toBe(422);
  });

  it('rejects a panel whose parts exceed their totals', async () => {
    const base = {
      servingSize: '1 cup',
      calories: 100,
      fatMg: 1000,
      satFatMg: 5000,
      carbsMg: 10000,
      sugarsMg: 1000,
      fiberMg: 1000,
      proteinMg: 1000,
      sodiumMg: 10,
      ingredientsText: 'Beans.',
    };

    // Saturated fat above total fat, and sugars above carbohydrates: both are labels nobody read.
    expect((await post({ ...withCategory(NEW_PRODUCT()), nutrition: base })).statusCode).toBe(422);
    expect(
      (
        await post({
          ...withCategory(NEW_PRODUCT()),
          nutrition: { ...base, satFatMg: 200, sugarsMg: 20000 },
        })
      ).statusCode,
    ).toBe(422);
  });

  it('rejects an unknown category with a field the form can point at', async () => {
    const response = await post({ ...withCategory(NEW_PRODUCT()), categoryId: 99_999 });
    expect(response.statusCode).toBe(422);
    expect(response.body).toContain('categoryId');
  });

  it('rejects a stored badge the storefront derives instead', async () => {
    // `sale` and `organic` are never stored (decision D-12); the enum does not offer them.
    const response = await post({ ...withCategory(NEW_PRODUCT()), badges: ['sale'] });
    expect(response.statusCode).toBe(422);
  });

  it('is a 404 for a product that does not exist', async () => {
    expect((await read(99_999)).status).toBe(404);
    expect((await put(99_999, withCategory(NEW_PRODUCT()))).statusCode).toBe(404);
  });

  it('shows a created product in the catalogue once it is active', async () => {
    const created = (await post(withCategory(NEW_PRODUCT()))).json<AdminProductDetail>();

    const storefront = await app.inject({
      method: 'GET',
      url: `/api/products/${created.slug}`,
      remoteAddress: freshAddress(),
    });
    expect(storefront.statusCode).toBe(200);

    // And a draft is not reachable at all, which is the other half of the same rule.
    await put(created.id, { ...withCategory(NEW_PRODUCT()), status: 'draft' });
    const hidden = await app.inject({
      method: 'GET',
      url: `/api/products/${created.slug}`,
      remoteAddress: freshAddress(),
    });
    expect(hidden.statusCode).toBe(404);
  });
});
