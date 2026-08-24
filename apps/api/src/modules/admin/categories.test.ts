import type {
  AdminAuditResponse,
  AdminCategoryList,
  AdminCategoryNode,
  CategoryListResponse,
  ProductListResponse,
} from '@silkgrain/contracts';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import FormData from 'form-data';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { adminUsers, categories } from '../../db/schema';
import { hashPassword } from '../../lib/password';
import {
  type CatalogFixture,
  FIXTURE_PASSWORD,
  seedCatalogFixture,
} from '../../test/fixtures/catalog';
import { buildTestApp, freshAddress, testEnv, truncateAll } from '../../test/harness';

/**
 * Categories in the back office.
 *
 * The reads are the least of it. What this suite is really for is the one property the storefront
 * depends on and no other screen can break: a product is in the shop only while its category is,
 * and `PUBLISHED_PRODUCT` enforces that by joining the product's *own* category. So the tests that
 * matter walk the consequence rather than the column - deactivate a parent, then ask the public
 * catalogue whether the child's products are still for sale. That is the Phase 3 defect, and it is
 * the one a cascade written in the service can silently stop being true.
 *
 * The depth limit gets the same treatment. Two levels is not a comment in a schema here; a third
 * level would exist in the database and render nowhere, so every door into one is closed and each
 * has a test.
 */
describe('admin categories', () => {
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

  const list = async (): Promise<AdminCategoryList> => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/categories',
      remoteAddress: freshAddress(),
      headers: auth(),
    });
    expect(response.statusCode).toBe(200);
    return response.json<AdminCategoryList>();
  };

  const find = (tree: AdminCategoryList, slug: string): AdminCategoryNode | undefined =>
    tree.items.find((node) => node.slug === slug);

  const findAnywhere = (tree: AdminCategoryList, slug: string) =>
    tree.items.flatMap((node) => [node, ...node.children]).find((row) => row.slug === slug);

  const NEW_CATEGORY = {
    name: 'Dried Herbs',
    slug: 'dried-herbs',
    description: 'Sun-dried and hand-sorted.',
    icon: 'leaf',
    parentId: null,
    position: 9,
    metaTitle: null,
    metaDescription: null,
    isActive: true,
  };

  const create = (over: Record<string, unknown> = {}) =>
    app.inject({
      method: 'POST',
      url: '/api/admin/categories',
      remoteAddress: freshAddress(),
      headers: auth(),
      payload: { ...NEW_CATEGORY, ...over },
    });

  const update = (id: number, body: Record<string, unknown>) =>
    app.inject({
      method: 'PUT',
      url: `/api/admin/categories/${String(id)}`,
      remoteAddress: freshAddress(),
      headers: auth(),
      payload: body,
    });

  const setActive = (id: number, isActive: boolean) =>
    app.inject({
      method: 'PATCH',
      url: `/api/admin/categories/${String(id)}/active`,
      remoteAddress: freshAddress(),
      headers: auth(),
      payload: { isActive },
    });

  /** The category as the update route wants it back: every field, minus the active flag. */
  const bodyOf = (row: {
    name: string;
    slug: string;
    parentId: number | null;
    position: number;
  }) => ({
    name: row.name,
    slug: row.slug,
    description: null,
    icon: null,
    parentId: row.parentId,
    position: row.position,
    metaTitle: null,
    metaDescription: null,
  });

  // ------------------------------------------------------------------------------- reading

  it('lists deactivated categories, which the storefront’s own endpoint does not', async () => {
    await app.db
      .update(categories)
      .set({ isActive: false })
      .where(eq(categories.id, fixture.categoryIds['dried-fruit']));

    const shop = await app.inject({ method: 'GET', url: '/api/categories' });
    expect(shop.json<CategoryListResponse>().items.map((node) => node.slug)).not.toContain(
      'dried-fruit',
    );

    // This is the screen a retired category is brought back on, so it has to be visible here.
    const panel = await list();
    expect(find(panel, 'dried-fruit')?.isActive).toBe(false);
  });

  it('counts what is filed there and what the shop would show, separately', async () => {
    const tree = await list();

    // Rice holds Devzira and one draft; only Devzira would appear in the grid.
    expect(find(tree, 'rice')).toMatchObject({ productCount: 2, liveCount: 1 });
    // Spices holds saffron and the discontinued cumin, whose only variant is switched off - so it
    // is active, filed, and not purchasable, which is exactly the gap between the two numbers.
    expect(find(tree, 'spices')).toMatchObject({ productCount: 2, liveCount: 1 });
    // Nothing at all, rather than absent from the response.
    expect(find(tree, 'dried-fruit')).toMatchObject({ productCount: 0, liveCount: 0 });
  });

  it('nests one level and does not fold a child’s products into its parent’s count', async () => {
    const tree = await list();
    const rice = find(tree, 'rice');

    expect(rice?.children.map((child) => child.slug)).toEqual(['long-grain-rice']);
    // The storefront's tree folds children in, because clicking "Rice" filters the whole branch.
    // The panel must not: an editor reading "3" beside Rice would go looking for a third product
    // filed there and never find it.
    expect(rice?.productCount).toBe(2);
    expect(rice?.children[0]?.productCount).toBe(1);
    // A child is never also a root.
    expect(tree.items.map((node) => node.slug)).not.toContain('long-grain-rice');
  });

  // ------------------------------------------------------------------------------- creating

  it('creates a category and records who did it', async () => {
    const response = await create();
    expect(response.statusCode).toBe(201);

    const created = find(response.json<AdminCategoryList>(), 'dried-herbs');
    expect(created).toMatchObject({ name: 'Dried Herbs', isActive: true, productCount: 0 });

    const audit = await app.inject({
      method: 'GET',
      url: '/api/admin/audit?action=category.created',
      remoteAddress: freshAddress(),
      headers: auth(),
    });
    const [entry] = audit.json<AdminAuditResponse>().items;
    expect(entry).toMatchObject({ entityType: 'category', entityLabel: 'Dried Herbs' });
    expect(entry?.changedFields).toContain('slug');
  });

  it('refuses a slug another category already uses', async () => {
    const response = await create({ slug: 'lentils' });
    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { message: string } }>().error.message).toContain('lentils');
  });

  it('refuses a third level at creation', async () => {
    const response = await create({ parentId: fixture.categoryIds['long-grain-rice'] });
    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { message: string } }>().error.message).toContain(
      'only has two levels',
    );
  });

  it('refuses a parent that does not exist', async () => {
    const response = await create({ parentId: 999_999 });
    expect(response.statusCode).toBe(409);
  });

  it('files a new category under a parent', async () => {
    const response = await create({
      slug: 'short-grain-rice',
      name: 'Short-Grain Rice',
      parentId: fixture.categoryIds.rice,
    });
    expect(response.statusCode).toBe(201);

    const rice = find(response.json<AdminCategoryList>(), 'rice');
    expect(rice?.children.map((child) => child.slug).sort()).toEqual([
      'long-grain-rice',
      'short-grain-rice',
    ]);
  });

  // ------------------------------------------------------------------------------- updating

  it('renames the slug, which is the category’s public address', async () => {
    const id = fixture.categoryIds.spices;
    const response = await update(id, {
      ...bodyOf({
        name: 'Spices & Seasonings',
        slug: 'spices-seasonings',
        parentId: null,
        position: 2,
      }),
    });
    expect(response.statusCode).toBe(200);

    // The old address is gone - there is no redirect table in this platform, which is why the
    // panel warns rather than the API refusing.
    const shop = await app.inject({ method: 'GET', url: '/api/products?category=spices' });
    expect(shop.json<ProductListResponse>().items).toHaveLength(0);

    const renamed = await app.inject({
      method: 'GET',
      url: '/api/products?category=spices-seasonings',
    });
    expect(renamed.json<ProductListResponse>().items.length).toBeGreaterThan(0);
  });

  it('refuses a rename onto a slug in use', async () => {
    const response = await update(fixture.categoryIds.spices, {
      ...bodyOf({ name: 'Spices', slug: 'lentils', parentId: null, position: 2 }),
    });
    expect(response.statusCode).toBe(409);
  });

  it('refuses to make a category its own parent', async () => {
    const id = fixture.categoryIds.spices;
    const response = await update(id, {
      ...bodyOf({ name: 'Spices', slug: 'spices', parentId: id, position: 2 }),
    });
    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { message: string } }>().error.message).toContain('own parent');
  });

  it('refuses to file a category that has children under another one', async () => {
    const response = await update(fixture.categoryIds.rice, {
      ...bodyOf({
        name: 'Rice & Grains',
        slug: 'rice',
        parentId: fixture.categoryIds.lentils,
        position: 0,
      }),
    });
    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { message: string } }>().error.message).toContain(
      'sub-categories of its own',
    );
  });

  it('cannot switch a category on or off through the update body', async () => {
    const response = await update(fixture.categoryIds.spices, {
      ...bodyOf({ name: 'Spices', slug: 'spices', parentId: null, position: 2 }),
      isActive: false,
    });
    // `.strict()`: a stale form must not be able to revert a deactivation somebody made while it
    // sat open, so the field is not merely ignored - the request is refused.
    expect(response.statusCode).toBe(422);
  });

  // ---------------------------------------------------------------------------- deactivating

  it('takes a category’s products out of the shop when it is switched off', async () => {
    const before = await app.inject({ method: 'GET', url: '/api/products?category=lentils' });
    expect(before.json<ProductListResponse>().items).toHaveLength(2);

    expect((await setActive(fixture.categoryIds.lentils, false)).statusCode).toBe(200);

    // Out of the grid...
    const after = await app.inject({ method: 'GET', url: '/api/products?category=lentils' });
    expect(after.json<ProductListResponse>().items).toHaveLength(0);
    // ...out of search...
    const search = await app.inject({ method: 'GET', url: '/api/products?q=lentils' });
    expect(search.json<ProductListResponse>().items).toHaveLength(0);
    // ...and out of the menu.
    const menu = await app.inject({ method: 'GET', url: '/api/categories' });
    expect(menu.json<CategoryListResponse>().items.map((node) => node.slug)).not.toContain(
      'lentils',
    );
  });

  it('takes the sub-categories with it, and their products with them', async () => {
    expect((await setActive(fixture.categoryIds.rice, false)).statusCode).toBe(200);

    const tree = await list();
    expect(find(tree, 'rice')?.isActive).toBe(false);
    // Without the cascade this child stays active: `PUBLISHED_PRODUCT` joins the product's own
    // category, so Chungara would remain in the grid under a heading no menu leads to.
    expect(findAnywhere(tree, 'long-grain-rice')?.isActive).toBe(false);

    const orphaned = await app.inject({ method: 'GET', url: '/api/products?slug=chungara-rice' });
    expect(orphaned.json<ProductListResponse>().items).toHaveLength(0);
  });

  it('names the sub-categories it took with it, in one entry rather than a row each', async () => {
    await setActive(fixture.categoryIds.rice, false);

    const audit = await app.inject({
      method: 'GET',
      url: '/api/admin/audit?action=category.active_changed',
      remoteAddress: freshAddress(),
      headers: auth(),
    });
    const entries = audit.json<AdminAuditResponse>().items;

    // One action the operator took, one entry (D-36).
    expect(entries).toHaveLength(1);
    expect(entries[0]?.entityLabel).toBe('Rice & Grains');
    expect(entries[0]?.note).toContain('Long-Grain Rice');
  });

  it('refuses to bring a sub-category back while its parent is off', async () => {
    await setActive(fixture.categoryIds.rice, false);

    const response = await setActive(fixture.categoryIds['long-grain-rice'], true);
    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { message: string } }>().error.message).toContain(
      'Rice & Grains',
    );
  });

  it('does not undo a sub-category’s own deactivation when the parent comes back', async () => {
    // Switched off on its own, before the parent was touched at all.
    await setActive(fixture.categoryIds['long-grain-rice'], false);
    await setActive(fixture.categoryIds.rice, false);
    await setActive(fixture.categoryIds.rice, true);

    const tree = await list();
    expect(find(tree, 'rice')?.isActive).toBe(true);
    // Reactivating cascades to nothing: somebody switched this off for a reason, and turning the
    // parent back on is not a decision about the child.
    expect(findAnywhere(tree, 'long-grain-rice')?.isActive).toBe(false);
  });

  it('refuses to file an active category under a deactivated one', async () => {
    await setActive(fixture.categoryIds['dried-fruit'], false);

    const response = await update(fixture.categoryIds.spices, {
      ...bodyOf({
        name: 'Spices',
        slug: 'spices',
        parentId: fixture.categoryIds['dried-fruit'],
        position: 2,
      }),
    });
    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { message: string } }>().error.message).toContain('deactivated');
  });

  it('has no way to delete a category at all', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/admin/categories/${String(fixture.categoryIds['dried-fruit'])}`,
      remoteAddress: freshAddress(),
      headers: auth(),
    });
    // `products.category_id` is ON DELETE restrict and `parent_id` is ON DELETE set null, so a
    // delete would be refused for a used category and would silently promote a child for an
    // unused one. Deactivation is the terminal action.
    expect(response.statusCode).toBe(404);
  });

  // --------------------------------------------------------------------------------- images

  it('stores a hero image as webp and serves it from the shop’s own origin', async () => {
    const png = await sharp({
      create: { width: 48, height: 48, channels: 3, background: '#0E6B4A' },
    })
      .png()
      .toBuffer();

    const body = new FormData();
    body.append('file', png, { filename: 'hero.png', contentType: 'image/png' });

    const response = await app.inject({
      method: 'POST',
      url: `/api/admin/categories/${String(fixture.categoryIds.spices)}/image`,
      remoteAddress: freshAddress(),
      headers: { ...body.getHeaders(), authorization: `Bearer ${token}` },
      payload: body.getBuffer(),
    });
    expect(response.statusCode).toBe(200);

    const url = find(response.json<AdminCategoryList>(), 'spices')?.imageUrl;
    expect(url).toMatch(/\.webp$/);

    const fetched = await fetch(url!);
    expect(fetched.status).toBe(200);
    expect(fetched.headers.get('content-type')).toContain('image/webp');

    const cleared = await app.inject({
      method: 'DELETE',
      url: `/api/admin/categories/${String(fixture.categoryIds.spices)}/image`,
      remoteAddress: freshAddress(),
      headers: auth(),
    });
    expect(cleared.statusCode).toBe(200);
    expect(find(cleared.json<AdminCategoryList>(), 'spices')?.imageUrl).toBeNull();
  });
});
