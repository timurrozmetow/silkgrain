import type { RecipeDetail, RecipeListResponse } from '@silkgrain/contracts';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { recipeProducts, recipes } from '../../db/schema';
import { type CatalogFixture, seedCatalogFixture } from '../../test/fixtures/catalog';
import { buildTestApp, freshAddress, testEnv, truncateAll } from '../../test/harness';

describe('recipes', () => {
  let app: FastifyInstance;
  let fixture: CatalogFixture;
  let databaseUrl: string;

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
  });

  const DAY = 86_400_000;

  async function seedRecipes() {
    const [oldest] = await app.db
      .insert(recipes)
      .values({
        slug: 'uzbek-plov',
        title: 'Uzbek Plov',
        excerpt: 'The one everyone argues about.',
        body: '## Ingredients\n\nRice.\n\n## Method\n\nCook it.',
        prepMinutes: 25,
        cookMinutes: 65,
        servings: 6,
        difficulty: 'medium',
        isPublished: true,
        publishedAt: new Date(Date.now() - 30 * DAY),
        heroImageUrl: 'https://images.example.com/plov.jpg',
        heroImageAlt: 'A cast-iron kazan of plov',
      })
      .$returningId();

    await app.db.insert(recipes).values([
      {
        slug: 'mosh-kichiri',
        title: 'Mosh Kichiri',
        excerpt: 'Mung beans and rice, slow and savoury.',
        body: 'Cook slowly.',
        prepMinutes: 10,
        cookMinutes: 50,
        servings: 4,
        difficulty: 'easy',
        isPublished: true,
        publishedAt: new Date(Date.now() - DAY),
      },
      {
        slug: 'draft-lagman',
        title: 'Unfinished Lagman',
        excerpt: 'Not ready.',
        body: 'Draft.',
        prepMinutes: 40,
        cookMinutes: 40,
        servings: 4,
        isPublished: false,
      },
    ]);

    if (!oldest) throw new Error('no recipe inserted');
    // Two products, deliberately in the reverse of their id order, to prove `position` wins.
    await app.db.insert(recipeProducts).values([
      { recipeId: oldest.id, productId: fixture.productIds['red-lentils'], position: 0 },
      { recipeId: oldest.id, productId: fixture.productIds['devzira-rice'], position: 1 },
    ]);
  }

  /** Naming the response shape at the call site is the whole point of the parameter. */
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- see above
  const get = <Body>(url: string) =>
    app
      .inject({ method: 'GET', url, remoteAddress: freshAddress() })
      .then((response) => ({ status: response.statusCode, body: response.json<Body>() }));

  it('features the newest and does not repeat it in the list', async () => {
    await seedRecipes();
    const { status, body } = await get<RecipeListResponse>('/api/recipes');

    expect(status).toBe(200);
    expect(body.featured?.slug).toBe('mosh-kichiri');
    expect(body.items.map((item) => item.slug)).toEqual(['uzbek-plov']);
  });

  it('leaves an unpublished recipe out entirely', async () => {
    await seedRecipes();
    const list = await get<RecipeListResponse>('/api/recipes');
    const slugs = [list.body.featured?.slug, ...list.body.items.map((item) => item.slug)];

    expect(slugs).not.toContain('draft-lagman');
    expect((await get('/api/recipes/draft-lagman')).status).toBe(404);
  });

  it('adds prep and cook once, on the server', async () => {
    await seedRecipes();
    const { body } = await get<RecipeListResponse>('/api/recipes');
    const plov = body.items.find((item) => item.slug === 'uzbek-plov');

    expect(plov).toMatchObject({ prepMinutes: 25, cookMinutes: 65, totalMinutes: 90 });
    expect(body.featured).toMatchObject({ prepMinutes: 10, cookMinutes: 50, totalMinutes: 60 });
  });

  it('answers with no featured recipe rather than failing when there are none', async () => {
    const { status, body } = await get<RecipeListResponse>('/api/recipes');
    expect(status).toBe(200);
    expect(body.featured).toBeNull();
    expect(body.items).toEqual([]);
  });

  it('returns one recipe with its products in the editor’s order', async () => {
    await seedRecipes();
    const { status, body } = await get<RecipeDetail>('/api/recipes/uzbek-plov');

    expect(status).toBe(200);
    expect(body.title).toBe('Uzbek Plov');
    expect(body.body).toContain('## Method');
    expect(body.image).toEqual({
      url: 'https://images.example.com/plov.jpg',
      alt: 'A cast-iron kazan of plov',
    });
    // `position`, not id order.
    expect(body.products.map((product) => product.slug)).toEqual(['red-lentils', 'devzira-rice']);
    // The same projection a grid gets, derived badges included.
    expect(body.products[1]?.badges).toEqual(['bestseller', 'sale', 'organic']);
  });

  it('falls back to the title when a hero image has no alt text', async () => {
    await app.db.insert(recipes).values({
      slug: 'no-alt',
      title: 'Shurpa',
      excerpt: 'Long-simmered lamb soup.',
      body: 'Simmer.',
      prepMinutes: 15,
      cookMinutes: 120,
      servings: 6,
      isPublished: true,
      publishedAt: new Date(),
      heroImageUrl: 'https://images.example.com/shurpa.jpg',
      heroImageAlt: null,
    });

    const { body } = await get<RecipeDetail>('/api/recipes/no-alt');
    // An empty alt on a content image is worse than an imperfect one.
    expect(body.image).toEqual({ url: 'https://images.example.com/shurpa.jpg', alt: 'Shurpa' });
  });

  it('is a 404 for a slug nobody published, and 422 for one that is not a slug', async () => {
    expect((await get('/api/recipes/no-such-recipe')).status).toBe(404);
    expect((await get('/api/recipes/Not_A_Slug')).status).toBe(422);
  });

  it('returns an empty product list rather than null when a recipe links nothing', async () => {
    await seedRecipes();
    const { body } = await get<RecipeDetail>('/api/recipes/mosh-kichiri');
    expect(body.products).toEqual([]);
  });
});
