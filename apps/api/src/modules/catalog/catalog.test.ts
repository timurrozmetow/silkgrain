import type {
  CategoryListResponse,
  ProductDetailResponse,
  ProductListResponse,
  SearchSuggestResponse,
} from '@silkgrain/contracts';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { categories } from '../../db/schema';
import { type CatalogFixture, seedCatalogFixture } from '../../test/fixtures/catalog';
import { buildTestApp, freshAddress } from '../../test/harness';

/**
 * The fixture is seeded once for the file and never mutated, so every test here reads the same
 * five visible products. `apps/api/src/test/fixtures/catalog.ts` states them in full; the
 * orderings asserted below are worked out there beside the data that produces them.
 */
describe('catalogue', () => {
  let app: FastifyInstance;
  let fixture: CatalogFixture;

  beforeAll(async () => {
    app = await buildTestApp();
    fixture = await seedCatalogFixture(app.db);
  });

  afterAll(async () => {
    await app.close();
  });

  /** Naming the response shape at the call site is the whole point of the parameter. */
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- see above
  async function get<Body>(url: string): Promise<{ status: number; body: Body }> {
    const response = await app.inject({ method: 'GET', url, remoteAddress: freshAddress() });
    return { status: response.statusCode, body: response.json<Body>() };
  }

  function slugsOf(body: ProductListResponse): string[] {
    return body.items.map((item) => item.slug);
  }

  // ------------------------------------------------------------------------ categories

  describe('GET /api/categories', () => {
    it('returns the top level in position order, with children nested', async () => {
      const { status, body } = await get<CategoryListResponse>('/api/categories');

      expect(status).toBe(200);
      expect(body.items.map((item) => item.slug)).toEqual([
        'rice',
        'lentils',
        'spices',
        'dried-fruit',
      ]);
      expect(body.items[0]?.children.map((child) => child.slug)).toEqual(['long-grain-rice']);
    });

    it('counts what the grid would show, folding children into the parent', async () => {
      const { body } = await get<CategoryListResponse>('/api/categories');
      const bySlug = new Map(body.items.map((item) => [item.slug, item]));

      // Rice holds Devzira; its child holds Chungara. The draft barley in the same category is
      // not counted, and neither is the spice whose only variant was switched off.
      expect(bySlug.get('rice')?.productCount).toBe(2);
      expect(bySlug.get('rice')?.children[0]?.productCount).toBe(1);
      expect(bySlug.get('lentils')?.productCount).toBe(2);
      expect(bySlug.get('spices')?.productCount).toBe(1);
      expect(bySlug.get('dried-fruit')?.productCount).toBe(0);
    });
  });

  // -------------------------------------------------------------------------- listing

  describe('GET /api/products', () => {
    it('lists only published products that have something to sell', async () => {
      const { status, body } = await get<ProductListResponse>('/api/products');

      expect(status).toBe(200);
      expect(body.meta.total).toBe(5);
      expect(slugsOf(body)).not.toContain('hidden-draft');
      expect(slugsOf(body)).not.toContain('retired-product');
    });

    it('builds a card with derived badges and the real price range', async () => {
      const { body } = await get<ProductListResponse>('/api/products?category=rice');
      const devzira = body.items.find((item) => item.slug === 'devzira-rice');

      expect(devzira).toBeDefined();
      // `bestseller` is stored; `sale` comes from the 10 lb mark-down and `organic` from the
      // certification. Decision D-12: neither of the last two is ever a row in product_badges.
      expect(devzira?.badges).toEqual(['bestseller', 'sale', 'organic']);
      expect(devzira?.priceFromCents).toBe(1200);
      expect(devzira?.priceToCents).toBe(4500);
      expect(devzira?.weightLabels).toEqual(['2 lb', '5 lb', '10 lb']);
      expect(devzira?.defaultVariantId).toBe(fixture.variants.devzira2lb);
      // One variant is out and one is low, but the 2 lb is comfortably stocked.
      expect(devzira?.stockState).toBe('in');
      expect(devzira?.rating).toEqual({ average: 4.7, count: 3 });
      expect(devzira?.category).toEqual({ slug: 'rice', name: 'Rice & Grains' });
    });

    it('sorts', async () => {
      const featured = await get<ProductListResponse>('/api/products?sort=featured');
      expect(slugsOf(featured.body)).toEqual([
        'devzira-rice',
        'chungara-rice',
        'red-lentils',
        'green-lentils',
        'samarkand-saffron',
      ]);

      const cheapest = await get<ProductListResponse>('/api/products?sort=price_asc');
      expect(slugsOf(cheapest.body)).toEqual([
        'red-lentils',
        'green-lentils',
        'devzira-rice',
        'chungara-rice',
        'samarkand-saffron',
      ]);

      const dearest = await get<ProductListResponse>('/api/products?sort=price_desc');
      expect(slugsOf(dearest.body)[0]).toBe('samarkand-saffron');

      const newest = await get<ProductListResponse>('/api/products?sort=newest');
      expect(slugsOf(newest.body)).toEqual([
        'samarkand-saffron',
        'green-lentils',
        'red-lentils',
        'chungara-rice',
        'devzira-rice',
      ]);

      const bestselling = await get<ProductListResponse>('/api/products?sort=bestselling');
      expect(slugsOf(bestselling.body)[0]).toBe('devzira-rice');

      // Only Devzira has published reviews, so it is the only product with an average above 0.
      const rated = await get<ProductListResponse>('/api/products?sort=rating');
      expect(slugsOf(rated.body)[0]).toBe('devzira-rice');
    });

    it('filters by category, folding a parent into its children', async () => {
      const rice = await get<ProductListResponse>('/api/products?category=rice');
      expect(slugsOf(rice.body).sort()).toEqual(['chungara-rice', 'devzira-rice']);

      const child = await get<ProductListResponse>('/api/products?category=long-grain-rice');
      expect(slugsOf(child.body)).toEqual(['chungara-rice']);

      const lentils = await get<ProductListResponse>('/api/products?category=lentils');
      expect(slugsOf(lentils.body).sort()).toEqual(['green-lentils', 'red-lentils']);
    });

    it('returns nothing for a category slug that does not exist', async () => {
      const { status, body } = await get<ProductListResponse>('/api/products?category=nonsense');
      expect(status).toBe(200);
      expect(body.meta.total).toBe(0);
      expect(body.items).toEqual([]);
    });

    it('filters by origin, certification and badge', async () => {
      const uzbek = await get<ProductListResponse>('/api/products?origin=UZ');
      expect(slugsOf(uzbek.body).sort()).toEqual(['devzira-rice', 'samarkand-saffron']);

      const organic = await get<ProductListResponse>('/api/products?cert=organic');
      expect(slugsOf(organic.body).sort()).toEqual(['devzira-rice', 'samarkand-saffron']);

      const halal = await get<ProductListResponse>('/api/products?cert=halal');
      expect(slugsOf(halal.body)).toEqual(['red-lentils']);

      // Both derived badges resolve to the fact they stand for, not to a stored row.
      const onSale = await get<ProductListResponse>('/api/products?badge=sale');
      expect(slugsOf(onSale.body)).toEqual(['devzira-rice']);

      const organicBadge = await get<ProductListResponse>('/api/products?badge=organic');
      expect(slugsOf(organicBadge.body).sort()).toEqual(['devzira-rice', 'samarkand-saffron']);

      // Several values in one facet are a union.
      const newOrSale = await get<ProductListResponse>('/api/products?badge=new,sale');
      expect(slugsOf(newOrSale.body).sort()).toEqual(['devzira-rice', 'red-lentils']);
    });

    it('combines facets with AND', async () => {
      const { body } = await get<ProductListResponse>(
        '/api/products?origin=UZ&cert=organic&badge=sale',
      );
      expect(slugsOf(body)).toEqual(['devzira-rice']);
    });

    it('filters by weight label and price range over the variants', async () => {
      const onePound = await get<ProductListResponse>('/api/products?weight=1%20lb');
      expect(slugsOf(onePound.body).sort()).toEqual(['green-lentils', 'red-lentils']);

      const cheap = await get<ProductListResponse>('/api/products?priceMaxCents=1000');
      expect(slugsOf(cheap.body).sort()).toEqual(['green-lentils', 'red-lentils']);

      const dear = await get<ProductListResponse>('/api/products?priceMinCents=4000');
      expect(slugsOf(dear.body).sort()).toEqual(['devzira-rice', 'samarkand-saffron']);
    });

    it('keeps the advertised price range when a price filter is applied', async () => {
      // Devzira matches on its 10 lb variant. The card must still say $12.00-$45.00: the range
      // describes the product, not the subset of variants that satisfied the filter.
      const { body } = await get<ProductListResponse>('/api/products?priceMinCents=4000');
      const devzira = body.items.find((item) => item.slug === 'devzira-rice');
      expect(devzira?.priceFromCents).toBe(1200);
      expect(devzira?.priceToCents).toBe(4500);
    });

    it('honours inStock=false rather than treating the string as true', async () => {
      const stocked = await get<ProductListResponse>('/api/products?inStock=true');
      expect(slugsOf(stocked.body)).not.toContain('green-lentils');
      expect(stocked.body.meta.total).toBe(4);

      const unfiltered = await get<ProductListResponse>('/api/products?inStock=false');
      expect(unfiltered.body.meta.total).toBe(5);
    });

    it('rejects a price range that runs backwards', async () => {
      const { status, body } = await get<{ error: { code: string } }>(
        '/api/products?priceMinCents=5000&priceMaxCents=1000',
      );
      expect(status).toBe(422);
      expect(body.error.code).toBe('VALIDATION_FAILED');
    });

    it('rejects an unknown query parameter', async () => {
      const { status } = await get('/api/products?limit=5');
      expect(status).toBe(422);
    });

    /** What the wishlist uses: a set of slugs, in one request, through the normal projection. */
    it('filters to specific products by slug', async () => {
      const picked = await get<ProductListResponse>(
        '/api/products?slug=samarkand-saffron,red-lentils',
      );
      expect(slugsOf(picked.body).sort()).toEqual(['red-lentils', 'samarkand-saffron']);

      // A slug that is not in the catalogue is simply absent, not an error - a wishlist can
      // easily name a product that has since been unpublished.
      const withStale = await get<ProductListResponse>(
        '/api/products?slug=red-lentils,hidden-draft,gone-forever',
      );
      expect(slugsOf(withStale.body)).toEqual(['red-lentils']);

      // Still ANDs with everything else.
      const narrowed = await get<ProductListResponse>(
        '/api/products?slug=samarkand-saffron,red-lentils&cert=halal',
      );
      expect(slugsOf(narrowed.body)).toEqual(['red-lentils']);
    });

    it('searches names, blurbs and category names', async () => {
      const rice = await get<ProductListResponse>('/api/products?q=rice');
      expect(slugsOf(rice.body).sort()).toEqual(['chungara-rice', 'devzira-rice']);

      const lentils = await get<ProductListResponse>('/api/products?q=lentils');
      expect(slugsOf(lentils.body).sort()).toEqual(['green-lentils', 'red-lentils']);
    });

    it('treats a wildcard in the search term as a literal', async () => {
      // Unescaped, `%` matches every product in the catalogue.
      const { body } = await get<ProductListResponse>('/api/products?q=%25');
      expect(body.meta.total).toBe(0);
    });

    it('paginates with a stable order', async () => {
      const first = await get<ProductListResponse>('/api/products?perPage=2&page=1');
      expect(slugsOf(first.body)).toEqual(['devzira-rice', 'chungara-rice']);
      expect(first.body.meta).toMatchObject({
        page: 1,
        perPage: 2,
        total: 5,
        totalPages: 3,
        hasPrevious: false,
        hasNext: true,
      });

      const last = await get<ProductListResponse>('/api/products?perPage=2&page=3');
      expect(slugsOf(last.body)).toEqual(['samarkand-saffron']);
      expect(last.body.meta).toMatchObject({ hasPrevious: true, hasNext: false });
    });

    it('computes each facet with its own filter removed', async () => {
      const plain = await get<ProductListResponse>('/api/products');
      expect(plain.body.facets.categories).toEqual([
        { slug: 'rice', name: 'Rice & Grains', count: 2 },
        { slug: 'lentils', name: 'Lentils & Legumes', count: 2 },
        { slug: 'spices', name: 'Spices', count: 1 },
        { slug: 'dried-fruit', name: 'Dried Fruit', count: 0 },
      ]);
      expect(plain.body.facets.price).toEqual({ minCents: 600, maxCents: 9900 });

      // Ticking a category must not collapse the others to zero, or there is no way back.
      const filtered = await get<ProductListResponse>('/api/products?category=lentils');
      expect(filtered.body.facets.categories).toEqual(plain.body.facets.categories);

      // The slider's bounds are the catalogue's, not the current selection's.
      const cheap = await get<ProductListResponse>('/api/products?priceMaxCents=1000');
      expect(cheap.body.facets.price).toEqual({ minCents: 600, maxCents: 9900 });
      expect(cheap.body.facets.categories.find((facet) => facet.slug === 'lentils')?.count).toBe(2);
      expect(cheap.body.facets.categories.find((facet) => facet.slug === 'rice')?.count).toBe(0);
    });

    it('returns the weight, origin and certification facets the sidebar is built from', async () => {
      const { body } = await get<ProductListResponse>('/api/products');

      // Lightest first, and the labels are the catalogue's rather than the mockup's
      // hard-coded 1/2/5/10/25/50 lb, which is not this catalogue's set.
      expect(body.facets.weights).toEqual([
        { label: '8 oz', count: 1 },
        { label: '1 lb', count: 2 },
        { label: '2 lb', count: 1 },
        { label: '5 lb', count: 3 },
        { label: '10 lb', count: 1 },
      ]);

      expect(body.facets.origins).toEqual([
        { value: 'UZ', count: 2 },
        { value: 'KZ', count: 1 },
        // Nothing is from Turkmenistan, and the box stays in the list at zero.
        { value: 'TM', count: 0 },
        { value: 'KG', count: 1 },
        { value: 'TJ', count: 1 },
        { value: 'MIXED', count: 0 },
      ]);

      expect(body.facets.certifications).toEqual([
        { value: 'organic', count: 2 },
        { value: 'non_gmo', count: 1 },
        { value: 'halal', count: 1 },
        { value: 'kosher', count: 0 },
        { value: 'gluten_free', count: 0 },
      ]);
    });

    it('computes the weight facet without the weight filter and the others with it', async () => {
      const { body } = await get<ProductListResponse>('/api/products?weight=8%20oz');

      // Only the saffron has an 8 oz variant.
      expect(slugsOf(body)).toEqual(['samarkand-saffron']);
      // Its own filter is removed, so every weight still shows its full count.
      expect(body.facets.weights.find((facet) => facet.label === '5 lb')?.count).toBe(3);
      // The others are counted with it applied, so they describe the current result.
      expect(body.facets.origins.find((facet) => facet.value === 'UZ')?.count).toBe(1);
      expect(body.facets.origins.find((facet) => facet.value === 'KZ')?.count).toBe(0);
      expect(body.facets.certifications.find((facet) => facet.value === 'organic')?.count).toBe(1);
    });

    it('accepts a repeated query parameter as well as a comma-separated one', async () => {
      const repeated = await get<ProductListResponse>('/api/products?origin=UZ&origin=KZ');
      const commas = await get<ProductListResponse>('/api/products?origin=UZ,KZ');

      expect(slugsOf(repeated.body).sort()).toEqual([
        'chungara-rice',
        'devzira-rice',
        'samarkand-saffron',
      ]);
      expect(slugsOf(commas.body).sort()).toEqual(slugsOf(repeated.body).sort());
    });

    it('refuses a filter carrying an absurd number of values', async () => {
      const many = Array.from({ length: 41 }, (_, index) => `slug-${String(index)}`).join(',');
      expect((await get(`/api/products?category=${many}`)).status).toBe(422);
    });

    it('searches the blurb and the subtitle, not only the name', async () => {
      // Neither word appears in any product or category name.
      const blurb = await get<ProductListResponse>('/api/products?q=heirloom');
      expect(slugsOf(blurb.body)).toEqual(['devzira-rice']);

      const subtitle = await get<ProductListResponse>('/api/products?q=terraces');
      expect(slugsOf(subtitle.body)).toEqual(['devzira-rice']);
    });

    it('reports a card as out of stock when every variant is', async () => {
      const { body } = await get<ProductListResponse>('/api/products?category=lentils');
      const green = body.items.find((item) => item.slug === 'green-lentils');
      expect(green?.stockState).toBe('out');
      expect(green?.badges).toEqual([]);
      expect(green?.rating).toBeNull();
    });

    /**
     * Deactivating a category has to take its products with it. Hidden from the menu but still
     * listed, searchable and priceable would be the worst of both.
     */
    it('hides the products of a category that has been switched off', async () => {
      await app.db
        .update(categories)
        .set({ isActive: false })
        .where(eq(categories.id, fixture.categoryIds.spices));
      try {
        const list = await get<ProductListResponse>('/api/products');
        expect(slugsOf(list.body)).not.toContain('samarkand-saffron');
        expect(list.body.meta.total).toBe(4);

        expect((await get('/api/products/samarkand-saffron')).status).toBe(404);

        const suggest = await get<SearchSuggestResponse>('/api/search/suggest?q=saffron');
        expect(suggest.body.items).toEqual([]);

        const tree = await get<CategoryListResponse>('/api/categories');
        expect(tree.body.items.map((item) => item.slug)).not.toContain('spices');
      } finally {
        await app.db
          .update(categories)
          .set({ isActive: true })
          .where(eq(categories.id, fixture.categoryIds.spices));
      }
    });
  });

  // --------------------------------------------------------------------------- detail

  describe('GET /api/products/:slug', () => {
    it('returns variants with a per-variant stock state and a capped availability', async () => {
      const { status, body } = await get<ProductDetailResponse>('/api/products/devzira-rice');

      expect(status).toBe(200);
      expect(body.product.variants.map((variant) => variant.stockState)).toEqual([
        'in',
        'low',
        'out',
      ]);
      expect(body.product.variants.map((variant) => variant.availableQty)).toEqual([50, 5, 0]);
      expect(body.product.variants[2]?.compareAtPriceCents).toBe(5500);
      expect(body.product.nutrition?.calories).toBe(160);
      expect(body.product.certifications.sort()).toEqual(['non_gmo', 'organic']);
      expect(body.product.seo.metaTitle).toBe('Devzira Red Rice | SilkGrain');
    });

    it('counts only published reviews in the histogram and the average', async () => {
      const { body } = await get<ProductDetailResponse>('/api/products/devzira-rice');

      expect(body.product.reviews.count).toBe(3);
      expect(body.product.reviews.average).toBe(4.7);
      expect(body.product.reviews.histogram).toEqual({
        '1': 0,
        '2': 0,
        '3': 0,
        '4': 1,
        '5': 2,
      });
      expect(body.product.reviews.items).toHaveLength(3);
      // The one-star row is still in moderation and must not appear anywhere.
      expect(body.product.reviews.items.map((item) => item.authorName)).not.toContain('Spam Bot');
    });

    it('tops "You May Also Like" up to four from outside the category', async () => {
      const { body } = await get<ProductDetailResponse>('/api/products/devzira-rice');

      expect(body.related).toHaveLength(4);
      expect(body.related.map((item) => item.slug)).not.toContain('devzira-rice');
      expect(body.related.map((item) => item.slug)).not.toContain('hidden-draft');
    });

    it('puts the same category first before topping up', async () => {
      // Green Lentils is the only other product in Lentils, so it has to lead regardless of
      // selling a fraction of what the fillers behind it sell.
      const { body } = await get<ProductDetailResponse>('/api/products/red-lentils');

      expect(body.related.map((item) => item.slug)).toEqual([
        'green-lentils',
        'devzira-rice',
        'chungara-rice',
        'samarkand-saffron',
      ]);
    });

    it('serialises a product that has no nutrition, certifications or reviews', async () => {
      const { status, body } = await get<ProductDetailResponse>('/api/products/chungara-rice');

      expect(status).toBe(200);
      expect(body.product.nutrition).toBeNull();
      expect(body.product.certifications).toEqual([]);
      expect(body.product.badges).toEqual([]);
      expect(body.product.rating).toBeNull();
      expect(body.product.reviews).toEqual({
        average: 0,
        count: 0,
        histogram: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 },
        items: [],
      });
    });

    it('lists reviews newest first', async () => {
      const { body } = await get<ProductDetailResponse>('/api/products/devzira-rice');
      expect(body.product.reviews.items.map((item) => item.authorName)).toEqual([
        'Dilnoza R.',
        'Marcus T.',
        'Aigerim S.',
      ]);
    });

    it('is a 404 for a draft product and for one with no active variant', async () => {
      expect((await get('/api/products/hidden-draft')).status).toBe(404);
      expect((await get('/api/products/retired-product')).status).toBe(404);
      expect((await get('/api/products/no-such-product')).status).toBe(404);
    });

    it('rejects a slug that is not one', async () => {
      expect((await get('/api/products/Not_A_Slug')).status).toBe(422);
    });
  });

  // --------------------------------------------------------------------------- search

  describe('GET /api/search/suggest', () => {
    it('suggests matching products with a price and an image', async () => {
      const { status, body } = await get<SearchSuggestResponse>('/api/search/suggest?q=rice');

      expect(status).toBe(200);
      expect(body.items.map((item) => item.slug)).toEqual(['devzira-rice', 'chungara-rice']);
      expect(body.items[0]?.priceFromCents).toBe(1200);
      expect(body.items[0]?.categoryName).toBe('Rice & Grains');
      expect(body.items[0]?.image).toContain('devzira-rice');
    });

    it('honours the limit and always offers popular terms', async () => {
      const { body } = await get<SearchSuggestResponse>('/api/search/suggest?q=e&limit=2');
      expect(body.items).toHaveLength(2);
      expect(body.popular[0]).toBe('Devzira Red Rice');
    });

    /**
     * The overlay opens before anything is typed and draws only the chips in that state, so
     * the empty-field case has to be a valid request rather than a special case on the client.
     */
    it('answers with only the popular chips when nothing has been typed', async () => {
      for (const url of ['/api/search/suggest', '/api/search/suggest?q=']) {
        const { status, body } = await get<SearchSuggestResponse>(url);
        expect(status).toBe(200);
        expect(body.items).toEqual([]);
        expect(body.popular).toHaveLength(5);
      }
    });

    it('rejects a term longer than the field allows', async () => {
      expect((await get(`/api/search/suggest?q=${'a'.repeat(121)}`)).status).toBe(422);
    });
  });
});
