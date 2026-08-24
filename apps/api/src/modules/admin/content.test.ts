import type {
  AdminAuditResponse,
  AdminFaqList,
  AdminRecipeDetail,
  AdminRecipeList,
  FaqListResponse,
  RecipeListResponse,
} from '@silkgrain/contracts';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { adminUsers } from '../../db/schema';
import { hashPassword } from '../../lib/password';
import {
  type CatalogFixture,
  FIXTURE_PASSWORD,
  seedCatalogFixture,
} from '../../test/fixtures/catalog';
import { buildTestApp, freshAddress, testEnv, truncateAll } from '../../test/harness';

/**
 * Recipes and the FAQ in the back office.
 *
 * Both tables have had a public endpoint since Phase 2 and no writer, so what these tests are
 * really for is the seam between the two shapes: the storefront returns published rows grouped and
 * sorted for reading, the panel returns everything flat and sorted for editing, and the classic
 * failure is a draft leaking into the first or an unpublished row vanishing from the second.
 *
 * The other thing worth pinning is `published_at`. It is written by exactly one route and stamped
 * once, because a recipe taken down to fix a typo and put back has not been published twice.
 */
describe('admin content', () => {
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

  const send = (
    method: 'GET' | 'POST' | 'PUT' | 'PATCH',
    url: string,
    payload?: Record<string, unknown>,
  ) =>
    app.inject({
      method,
      url,
      remoteAddress: freshAddress(),
      headers: auth(),
      // Spread rather than `payload: payload ?? undefined`: `exactOptionalPropertyTypes` makes an
      // explicit `undefined` a different thing from an absent key, and inject's own types say so.
      ...(payload === undefined ? {} : { payload }),
    });

  const RECIPE = {
    title: 'Uzbek Lamb Plov',
    slug: 'uzbek-lamb-plov',
    excerpt: 'The national dish - devzira rice, lamb, carrots and a whole head of garlic.',
    body: '## Ingredients\n\n- 2 lb rice\n\n## Method\n\n1. Cook it.',
    prepMinutes: 30,
    cookMinutes: 60,
    servings: 6,
    difficulty: 'medium',
    imageAlt: null,
    metaTitle: null,
    metaDescription: null,
    productIds: [] as number[],
    isPublished: true,
  };

  const FAQ = {
    category: 'shipping',
    question: 'Where do you ship from, and how long does it take?',
    answer: 'Every order ships from our Houston warehouse within 48 hours.',
    position: 0,
    isPublished: true,
  };

  // ------------------------------------------------------------------------------- recipes

  it('creates a recipe, links its products, and shows it in the shop', async () => {
    const created = await send('POST', '/api/admin/recipes', {
      ...RECIPE,
      productIds: [fixture.productIds['devzira-rice'], fixture.productIds['red-lentils']],
    });
    expect(created.statusCode).toBe(201);

    const detail = created.json<AdminRecipeDetail>();
    expect(detail).toMatchObject({ slug: 'uzbek-lamb-plov', isPublished: true, productCount: 2 });
    // Published on creation stamps the date rather than leaving a live recipe undated.
    expect(detail.publishedAt).not.toBeNull();
    // The order is the order the form sent, because "Shop the ingredients" reads down the list.
    expect(detail.productIds).toEqual([
      fixture.productIds['devzira-rice'],
      fixture.productIds['red-lentils'],
    ]);

    // The newest published recipe is the featured panel and is not repeated in `items`, so with
    // exactly one there is nothing in the grid - which is the storefront's shape, not a miss.
    const shop = await app.inject({ method: 'GET', url: '/api/recipes' });
    const list = shop.json<RecipeListResponse>();
    expect(list.featured?.slug).toBe('uzbek-lamb-plov');
    expect(list.items).toHaveLength(0);
  });

  it('refuses a product that does not exist rather than failing on the foreign key', async () => {
    const response = await send('POST', '/api/admin/recipes', {
      ...RECIPE,
      productIds: [999_999],
    });
    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { message: string } }>().error.message).toContain('999999');
  });

  it('refuses a slug another recipe already uses', async () => {
    await send('POST', '/api/admin/recipes', RECIPE);
    const again = await send('POST', '/api/admin/recipes', { ...RECIPE, title: 'Another' });
    expect(again.statusCode).toBe(409);
  });

  it('keeps a draft out of the shop and in the panel', async () => {
    const created = await send('POST', '/api/admin/recipes', { ...RECIPE, isPublished: false });
    expect(created.json<AdminRecipeDetail>().publishedAt).toBeNull();

    const shop = await app.inject({ method: 'GET', url: '/api/recipes' });
    const list = shop.json<RecipeListResponse>();
    // Both halves, or a draft could hide in the featured slot and the test would still pass.
    expect(list.featured).toBeNull();
    expect(list.items).toHaveLength(0);

    const panel = await send('GET', '/api/admin/recipes');
    expect(panel.json<AdminRecipeList>().items).toHaveLength(1);
  });

  it('stamps published_at once and does not move it', async () => {
    const created = await send('POST', '/api/admin/recipes', { ...RECIPE, isPublished: false });
    const id = created.json<AdminRecipeDetail>().id;

    const live = await send('PATCH', `/api/admin/recipes/${String(id)}/published`, {
      isPublished: true,
    });
    const first = live.json<AdminRecipeDetail>().publishedAt;
    expect(first).not.toBeNull();

    // Down and up again: correcting a typo is not publishing it a second time, and the recipe
    // list is sorted by this date.
    await send('PATCH', `/api/admin/recipes/${String(id)}/published`, { isPublished: false });
    const back = await send('PATCH', `/api/admin/recipes/${String(id)}/published`, {
      isPublished: true,
    });
    expect(back.json<AdminRecipeDetail>().publishedAt).toBe(first);
  });

  it('cannot publish through the update body', async () => {
    const created = await send('POST', '/api/admin/recipes', { ...RECIPE, isPublished: false });
    const id = created.json<AdminRecipeDetail>().id;

    const { isPublished: _ignored, ...fields } = RECIPE;
    const response = await send('PUT', `/api/admin/recipes/${String(id)}`, {
      ...fields,
      isPublished: true,
    });
    // `.strict()`: a stale form must not republish something taken down while it sat open.
    expect(response.statusCode).toBe(422);
  });

  it('replaces the product list rather than appending to it', async () => {
    const created = await send('POST', '/api/admin/recipes', {
      ...RECIPE,
      productIds: [fixture.productIds['devzira-rice'], fixture.productIds['red-lentils']],
    });
    const id = created.json<AdminRecipeDetail>().id;

    const { isPublished: _ignored, ...fields } = RECIPE;
    const updated = await send('PUT', `/api/admin/recipes/${String(id)}`, {
      ...fields,
      productIds: [fixture.productIds['green-lentils']],
    });
    expect(updated.json<AdminRecipeDetail>().productIds).toEqual([
      fixture.productIds['green-lentils'],
    ]);
  });

  it('has no way to delete a recipe', async () => {
    const created = await send('POST', '/api/admin/recipes', RECIPE);
    const id = created.json<AdminRecipeDetail>().id;
    const response = await send('PUT', `/api/admin/recipes/${String(id)}`, {});
    // A malformed PUT is a 422; what matters is that DELETE is not a route at all.
    expect(response.statusCode).toBe(422);

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/admin/recipes/${String(id)}`,
      remoteAddress: freshAddress(),
      headers: auth(),
    });
    expect(deleted.statusCode).toBe(404);
  });

  // ----------------------------------------------------------------------------------- FAQ

  it('adds a FAQ entry and groups it on the Help page', async () => {
    const created = await send('POST', '/api/admin/faqs', FAQ);
    expect(created.statusCode).toBe(201);
    expect(created.json<AdminFaqList>().items).toHaveLength(1);

    const shop = await app.inject({ method: 'GET', url: '/api/faqs' });
    const groups = shop.json<FaqListResponse>().groups;
    expect(groups).toHaveLength(1);
    expect(groups[0]?.category).toBe('shipping');
    expect(groups[0]?.items[0]?.question).toBe(FAQ.question);
  });

  it('hides an unpublished entry from the Help page and keeps it in the panel', async () => {
    const created = await send('POST', '/api/admin/faqs', FAQ);
    const id = created.json<AdminFaqList>().items[0]?.id ?? 0;

    await send('PATCH', `/api/admin/faqs/${String(id)}/published`, { isPublished: false });

    const shop = await app.inject({ method: 'GET', url: '/api/faqs' });
    expect(shop.json<FaqListResponse>().groups).toHaveLength(0);

    const panel = await send('GET', '/api/admin/faqs');
    expect(panel.json<AdminFaqList>().items[0]?.isPublished).toBe(false);
  });

  it('keeps both sides of a changed answer in the audit log', async () => {
    const created = await send('POST', '/api/admin/faqs', FAQ);
    const id = created.json<AdminFaqList>().items[0]?.id ?? 0;

    const { isPublished: _ignored, ...fields } = FAQ;
    await send('PUT', `/api/admin/faqs/${String(id)}`, {
      ...fields,
      answer: 'Every order ships within 24 hours.',
    });

    const audit = await send('GET', '/api/admin/audit?action=faq.updated');
    const [entry] = audit.json<AdminAuditResponse>().items;
    expect(entry?.changedFields).toContain('answer');

    const full = await send('GET', `/api/admin/audit/${String(entry?.id ?? 0)}`);
    const body = full.json<{ before: Record<string, unknown>; after: Record<string, unknown> }>();
    // "What did we used to tell customers about shipping" is the question this log gets asked.
    expect(body.before['answer']).toBe(FAQ.answer);
    expect(body.after['answer']).toBe('Every order ships within 24 hours.');
  });

  it('orders the panel list by category then position, so a collision is visible', async () => {
    await send('POST', '/api/admin/faqs', { ...FAQ, category: 'returns', position: 1 });
    await send('POST', '/api/admin/faqs', { ...FAQ, category: 'ordering', position: 5 });
    await send('POST', '/api/admin/faqs', { ...FAQ, category: 'returns', position: 0 });

    const panel = await send('GET', '/api/admin/faqs');
    const rows = panel.json<AdminFaqList>().items;
    expect(rows.map((row) => `${row.category}:${String(row.position)}`)).toEqual([
      'ordering:5',
      'returns:0',
      'returns:1',
    ]);
  });
});
