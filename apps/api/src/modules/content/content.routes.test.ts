import type { FaqListResponse } from '@silkgrain/contracts';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { contactMessages, faqs } from '../../db/schema';
import { buildTestApp, freshAddress, testEnv, truncateAll } from '../../test/harness';

describe('content', () => {
  let app: FastifyInstance;
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
  });

  // --------------------------------------------------------------------------------- FAQ

  async function seedFaqs() {
    await app.db.insert(faqs).values([
      // Deliberately out of enum order, and out of position order within a category.
      {
        category: 'shipping',
        question: 'How fast do you ship?',
        answer: 'Within 48 hours.',
        position: 0,
      },
      { category: 'ordering', question: 'Second on ordering', answer: 'B.', position: 1 },
      { category: 'ordering', question: 'First on ordering', answer: 'A.', position: 0 },
      { category: 'returns', question: 'Hidden one', answer: 'Not published.', isPublished: false },
    ]);
  }

  it('groups the FAQ in the enum’s order, not the rows’', async () => {
    await seedFaqs();
    const response = await app.inject({
      method: 'GET',
      url: '/api/faqs',
      remoteAddress: freshAddress(),
    });
    const body = response.json<FaqListResponse>();

    expect(response.statusCode).toBe(200);
    // `ordering` comes before `shipping` in FAQ_CATEGORY, whatever order the rows arrived in.
    expect(body.groups.map((group) => group.category)).toEqual(['ordering', 'shipping']);
    expect(body.groups[0]?.items.map((item) => item.question)).toEqual([
      'First on ordering',
      'Second on ordering',
    ]);
  });

  it('leaves an unpublished entry out, and with it its whole category', async () => {
    await seedFaqs();
    const body = (
      await app.inject({ method: 'GET', url: '/api/faqs', remoteAddress: freshAddress() })
    ).json<FaqListResponse>();

    expect(body.groups.map((group) => group.category)).not.toContain('returns');
    expect(JSON.stringify(body)).not.toContain('Not published');
  });

  it('returns an empty list rather than failing when nothing is published', async () => {
    const body = (
      await app.inject({ method: 'GET', url: '/api/faqs', remoteAddress: freshAddress() })
    ).json<FaqListResponse>();
    expect(body.groups).toEqual([]);
  });

  // ----------------------------------------------------------------------- contact form

  const MESSAGE = {
    name: 'Nodira Yusupova',
    email: 'nodira@example.com',
    subject: 'Question about the Devzira',
    body: 'Is the 25 lb sack available for a restaurant order this month?',
    website: '',
  };

  const post = (payload: object) =>
    app.inject({
      method: 'POST',
      url: '/api/contact',
      remoteAddress: freshAddress(),
      payload,
    });

  /** Old enough to have been read. The check is three seconds. */
  const readTime = () => Date.now() - 10_000;

  it('stores a message a person could plausibly have written', async () => {
    const response = await post({ ...MESSAGE, formRenderedAt: readTime() });

    expect(response.statusCode).toBe(201);
    const rows = await app.db.select().from(contactMessages);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      email: MESSAGE.email,
      subject: MESSAGE.subject,
      status: 'new',
    });
    // Recorded for the abuse trail, and the only thing here the sender did not type.
    expect(rows[0]?.submittedIp).toBeTruthy();
  });

  it('keeps the order number when one is given', async () => {
    await post({ ...MESSAGE, orderNumber: 'SG-2026-00042', formRenderedAt: readTime() });
    const [row] = await app.db.select().from(contactMessages);
    expect(row?.orderNumber).toBe('SG-2026-00042');
  });

  /**
   * The honeypot and the timer answer 201 and store nothing. A different status would tell a
   * bot exactly which field gave it away.
   */
  it('silently drops a submission with the honeypot filled in', async () => {
    const response = await post({
      ...MESSAGE,
      website: 'https://buy-followers.example',
      formRenderedAt: readTime(),
    });

    // The same 201 a real message gets. A 422 here would name the field that caught it.
    expect(response.statusCode).toBe(201);
    expect(response.json<{ received: boolean }>().received).toBe(true);
    expect(await app.db.select().from(contactMessages)).toHaveLength(0);
  });

  it('silently drops a form submitted faster than anyone could read it', async () => {
    const response = await post({ ...MESSAGE, formRenderedAt: Date.now() });

    expect(response.statusCode).toBe(201);
    expect(response.json<{ received: boolean }>().received).toBe(true);
    expect(await app.db.select().from(contactMessages)).toHaveLength(0);
  });

  it('rejects a message too short to act on, and one that is not an email', async () => {
    expect((await post({ ...MESSAGE, body: 'help', formRenderedAt: readTime() })).statusCode).toBe(
      422,
    );
    expect(
      (await post({ ...MESSAGE, email: 'not-an-email', formRenderedAt: readTime() })).statusCode,
    ).toBe(422);
  });

  it('rejects an unknown field rather than ignoring it', async () => {
    const response = await post({
      ...MESSAGE,
      formRenderedAt: readTime(),
      status: 'answered',
    });
    expect(response.statusCode).toBe(422);
  });

  it('limits how many messages one address can send', async () => {
    const address = freshAddress();
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 7; attempt += 1) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/contact',
        remoteAddress: address,
        payload: { ...MESSAGE, formRenderedAt: readTime() },
      });
      statuses.push(response.statusCode);
    }
    expect(statuses).toContain(429);
    // The limit is five, so nothing past that reached the table.
    expect((await app.db.select().from(contactMessages)).length).toBeLessThanOrEqual(5);
  });

  it('does not let the honeypot reach the stored row', async () => {
    await post({ ...MESSAGE, formRenderedAt: readTime() });
    const [row] = await app.db.select().from(contactMessages);
    expect(Object.keys(row ?? {})).not.toContain('website');
    expect(await app.db.select().from(faqs).where(eq(faqs.isPublished, true))).toHaveLength(0);
  });
});
