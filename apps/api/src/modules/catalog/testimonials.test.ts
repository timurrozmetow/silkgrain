import type { TestimonialListResponse } from '@silkgrain/contracts';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { reviews } from '../../db/schema';
import { type CatalogFixture, seedCatalogFixture } from '../../test/fixtures/catalog';
import { buildTestApp, freshAddress, testEnv, truncateAll } from '../../test/harness';

/**
 * Testimonials, which are reviews and nothing else.
 *
 * Its own file rather than a case in `catalog.test.ts`, because every test here inserts a review
 * to prove a rule and that file's fixture is seeded once and read by forty assertions that
 * would notice.
 */
describe('testimonials', () => {
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

  async function get(url = '/api/testimonials'): Promise<{
    status: number;
    body: TestimonialListResponse;
  }> {
    const response = await app.inject({ method: 'GET', url, remoteAddress: freshAddress() });
    return { status: response.statusCode, body: response.json<TestimonialListResponse>() };
  }

  it('returns the fixture’s two long five-star reviews, verified buyer first', async () => {
    const { status, body } = await get();

    expect(status).toBe(200);
    // Aigerim is verified, Dilnoza is not, and Dilnoza's review is the newer of the two - so
    // this ordering is the one that proves the verified flag outranks the date.
    expect(body.items.map((item) => item.authorName)).toEqual(['Aigerim S.', 'Dilnoza R.']);
    expect(body.items[0]?.rating).toBe(5);
    expect(body.items[0]?.isVerifiedPurchase).toBe(true);
    // The product comes back with it, because the card names what was bought.
    expect(body.items[0]?.product).toEqual({ slug: 'devzira-rice', name: 'Devzira Red Rice' });
  });

  it('leaves out the four-star review and the one still in moderation', async () => {
    const { body } = await get();
    const names = body.items.map((item) => item.authorName);

    expect(names).not.toContain('Marcus T.');
    expect(names).not.toContain('Spam Bot');
  });

  it('leaves out a five-star review too short to set as a pull quote', async () => {
    await app.db.insert(reviews).values({
      productId: fixture.productIds['devzira-rice'],
      authorName: 'Brief B.',
      rating: 5,
      title: null,
      body: 'Great rice.',
      status: 'published',
      isVerifiedPurchase: true,
      publishedAt: new Date(),
    });

    const { body } = await get();
    expect(body.items.map((item) => item.authorName)).not.toContain('Brief B.');
  });

  it('leaves out a glowing review of a product that is not in the catalogue', async () => {
    await app.db.insert(reviews).values({
      productId: fixture.productIds['hidden-draft'],
      authorName: 'Ghost G.',
      rating: 5,
      title: 'Wonderful',
      body: 'This is a long and glowing review of a product no customer can currently buy.',
      status: 'published',
      isVerifiedPurchase: true,
      publishedAt: new Date(),
    });

    const { body } = await get();
    expect(body.items.map((item) => item.authorName)).not.toContain('Ghost G.');
  });

  it('honours the limit and rejects one outside the bounds', async () => {
    expect((await get('/api/testimonials?limit=1')).body.items).toHaveLength(1);
    expect((await get('/api/testimonials?limit=0')).status).toBe(422);
    expect((await get('/api/testimonials?limit=99')).status).toBe(422);
  });

  /**
   * A shop that has not been reviewed yet still has a home page. An empty list is the answer,
   * not a 404 and not a section that throws.
   */
  it('answers with an empty list rather than failing when nothing qualifies', async () => {
    await truncateAll(databaseUrl);
    await seedCatalogFixture(app.db);
    await app.db.delete(reviews);

    const { status, body } = await get();
    expect(status).toBe(200);
    expect(body.items).toEqual([]);
  });
});
