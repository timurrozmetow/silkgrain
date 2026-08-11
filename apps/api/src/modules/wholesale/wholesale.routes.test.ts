import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { wholesaleRequests } from '../../db/schema';
import { buildTestApp, freshAddress, testEnv, truncateAll } from '../../test/harness';

describe('wholesale enquiries', () => {
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

  const ENQUIRY = {
    businessName: 'Samarkand Kitchen',
    businessType: 'restaurant',
    contactName: 'Nodira Yusupova',
    email: 'buyer@samarkandkitchen.example',
    phone: '713-555-0142',
    monthlyVolumeBand: '200-500',
    categoriesOfInterest: ['rice', 'spices'],
    notes: 'We go through about eight sacks of devzira a month and would like a standing order.',
    website: '',
  };

  const post = (payload: object) =>
    app.inject({
      method: 'POST',
      url: '/api/wholesale/requests',
      remoteAddress: freshAddress(),
      payload,
    });

  /** Old enough to have been read. The check is three seconds. */
  const readTime = () => Date.now() - 10_000;

  it('stores an enquiry a business could plausibly have sent', async () => {
    const response = await post({ ...ENQUIRY, formRenderedAt: readTime() });

    expect(response.statusCode).toBe(201);
    const rows = await app.db.select().from(wholesaleRequests);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      businessName: 'Samarkand Kitchen',
      businessType: 'restaurant',
      email: 'buyer@samarkandkitchen.example',
      monthlyVolumeBand: '200-500',
      status: 'new',
    });
    // One name field by design (D-5); the surname column stays null rather than guessing a seam.
    expect(rows[0]?.contactFirstName).toBe('Nodira Yusupova');
    expect(rows[0]?.contactLastName).toBeNull();
    expect(rows[0]?.categoriesOfInterest).toEqual(['rice', 'spices']);
    // Kept for the abuse trail, and the only stored value the sender did not type.
    expect(rows[0]?.submittedIp).toBeTruthy();
  });

  it('accepts an enquiry with nothing optional filled in', async () => {
    const { phone, categoriesOfInterest, notes, ...bare } = ENQUIRY;
    const response = await post({ ...bare, formRenderedAt: readTime() });

    expect(response.statusCode).toBe(201);
    const [row] = await app.db.select().from(wholesaleRequests);
    expect(row?.phone).toBeNull();
    expect(row?.notes).toBeNull();
    // Null rather than `[]`: "chose nothing" should not be two different shapes downstream.
    expect(row?.categoriesOfInterest).toBeNull();
    expect(phone).toBeTruthy();
    expect(categoriesOfInterest).toHaveLength(2);
    expect(notes).toBeTruthy();
  });

  it('stores an empty category selection as null, not an empty array', async () => {
    await post({ ...ENQUIRY, categoriesOfInterest: [], formRenderedAt: readTime() });
    const [row] = await app.db.select().from(wholesaleRequests);
    expect(row?.categoriesOfInterest).toBeNull();
  });

  /**
   * The honeypot and the timer answer 201 and store nothing. A different status would tell a bot
   * exactly which field gave it away.
   */
  it('silently drops an enquiry with the honeypot filled in', async () => {
    const response = await post({
      ...ENQUIRY,
      website: 'https://seo-services.example',
      formRenderedAt: readTime(),
    });

    expect(response.statusCode).toBe(201);
    expect(response.json<{ received: boolean }>().received).toBe(true);
    expect(await app.db.select().from(wholesaleRequests)).toHaveLength(0);
  });

  it('silently drops a form submitted faster than anyone could read it', async () => {
    const response = await post({ ...ENQUIRY, formRenderedAt: Date.now() });

    expect(response.statusCode).toBe(201);
    expect(await app.db.select().from(wholesaleRequests)).toHaveLength(0);
  });

  it('does not let the honeypot reach the stored row', async () => {
    await post({ ...ENQUIRY, website: '', formRenderedAt: readTime() });
    const [row] = await app.db.select().from(wholesaleRequests);
    expect(JSON.stringify(row)).not.toContain('website');
  });

  it('rejects a business type or volume band it does not offer', async () => {
    expect(
      (await post({ ...ENQUIRY, businessType: 'spaceport', formRenderedAt: readTime() }))
        .statusCode,
    ).toBe(422);
    expect(
      (await post({ ...ENQUIRY, monthlyVolumeBand: '1-2', formRenderedAt: readTime() })).statusCode,
    ).toBe(422);
  });

  it('rejects an unknown field rather than ignoring it', async () => {
    const response = await post({
      ...ENQUIRY,
      formRenderedAt: readTime(),
      discountPlease: true,
    });
    expect(response.statusCode).toBe(422);
  });

  it('rejects a name too short to be one, and an address that is not an email', async () => {
    expect(
      (await post({ ...ENQUIRY, contactName: 'A', formRenderedAt: readTime() })).statusCode,
    ).toBe(422);
    expect(
      (await post({ ...ENQUIRY, email: 'not-an-address', formRenderedAt: readTime() })).statusCode,
    ).toBe(422);
  });

  it('limits how many enquiries one address can send', async () => {
    const address = freshAddress();
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/wholesale/requests',
        remoteAddress: address,
        payload: { ...ENQUIRY, formRenderedAt: readTime() },
      });
      statuses.push(response.statusCode);
    }
    // Three an hour: a business fills this in once.
    expect(statuses.filter((status) => status === 201)).toHaveLength(3);
    expect(statuses).toContain(429);
  });
});
