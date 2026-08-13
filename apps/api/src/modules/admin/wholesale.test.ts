import type {
  AdminUserOption,
  AdminWholesaleDetail,
  AdminWholesaleListResponse,
} from '@silkgrain/contracts';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { adminUsers, wholesaleRequests } from '../../db/schema';
import { hashPassword } from '../../lib/password';
import { FIXTURE_PASSWORD, seedCatalogFixture } from '../../test/fixtures/catalog';
import { buildTestApp, freshAddress, testEnv, truncateAll } from '../../test/harness';

/**
 * Wholesale enquiries from the desk that answers them.
 *
 * The enquiries themselves arrive through the public form, which has its own tests. What is worth
 * proving here is the handling: that triage moves status and owner together, that the note thread
 * is append-only and keeps saying who wrote what, and that the submitter's IP - stored for abuse
 * investigation - never reaches a response.
 */
describe('admin wholesale', () => {
  let app: FastifyInstance;
  let databaseUrl: string;
  let token: string;
  let opsId: number;

  beforeAll(async () => {
    app = await buildTestApp();
    databaseUrl = testEnv().DATABASE_URL;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(databaseUrl);
    await seedCatalogFixture(app.db);

    const hash = await hashPassword(FIXTURE_PASSWORD);
    await app.db.insert(adminUsers).values([
      { email: 'ops@silkgrain.test', passwordHash: hash, name: 'Dilnoza R.', role: 'manager' },
      { email: 'sales@silkgrain.test', passwordHash: hash, name: 'Sevara A.', role: 'support' },
      // Inactive: cannot be given work, and must not appear in the picker.
      {
        email: 'former@silkgrain.test',
        passwordHash: hash,
        name: 'Former Colleague',
        role: 'support',
        isActive: false,
      },
    ]);

    const [ops] = await app.db
      .select({ id: adminUsers.id })
      .from(adminUsers)
      .where(eq(adminUsers.email, 'ops@silkgrain.test'));
    opsId = ops?.id ?? 0;

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/admin/login',
      remoteAddress: freshAddress(),
      payload: { email: 'ops@silkgrain.test', password: FIXTURE_PASSWORD },
    });
    token = login.json<{ accessToken: string }>().accessToken;
  });

  const auth = () => ({ authorization: `Bearer ${token}` });

  /** An enquiry as the public form writes one, IP and all. */
  async function submitEnquiry(
    businessName = 'Samarkand Grill',
    email = 'chef@samarkandgrill.example',
  ): Promise<number> {
    await app.db.insert(wholesaleRequests).values({
      businessName,
      businessType: 'restaurant',
      contactFirstName: 'Rustam',
      contactLastName: 'Aliyev',
      email,
      phone: '713-555-0142',
      city: 'Houston',
      state: 'TX',
      categoriesOfInterest: ['rice-grains', 'spices'],
      monthlyVolumeBand: '500-2000',
      notes: 'We go through about ten sacks of devzira a month.',
      submittedIp: '198.51.100.24',
    });

    const [row] = await app.db
      .select({ id: wholesaleRequests.id })
      .from(wholesaleRequests)
      .where(eq(wholesaleRequests.businessName, businessName));
    return row?.id ?? 0;
  }

  const get = (url: string) =>
    app.inject({ method: 'GET', url, remoteAddress: freshAddress(), headers: auth() });

  it('refuses the enquiry list without an admin session', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/wholesale/requests',
      remoteAddress: freshAddress(),
    });
    expect(response.statusCode).toBe(401);
  });

  it('lists enquiries with the contact joined into one name', async () => {
    await submitEnquiry();

    const response = await get('/api/admin/wholesale/requests');
    expect(response.statusCode).toBe(200);

    const body = response.json<AdminWholesaleListResponse>();
    expect(body.items[0]?.businessName).toBe('Samarkand Grill');
    expect(body.items[0]?.contactName).toBe('Rustam Aliyev');
    expect(body.items[0]?.status).toBe('new');
    // Nobody has taken it yet.
    expect(body.items[0]?.assignedToName).toBeNull();
    expect(body.items[0]?.noteCount).toBe(0);
  });

  it('never returns the submitter’s IP, in the list or the detail', async () => {
    const id = await submitEnquiry();

    const list = await get('/api/admin/wholesale/requests');
    const detail = await get(`/api/admin/wholesale/requests/${String(id)}`);

    // It is in the row - the public form stored it - and in neither response.
    const [row] = await app.db
      .select({ ip: wholesaleRequests.submittedIp })
      .from(wholesaleRequests)
      .where(eq(wholesaleRequests.id, id));
    expect(row?.ip).toBe('198.51.100.24');
    expect(list.body).not.toContain('198.51.100.24');
    expect(detail.body).not.toContain('198.51.100.24');
  });

  it('filters to the enquiries nobody has taken', async () => {
    const mine = await submitEnquiry('Bukhara Bazaar', 'buyer@bukharabazaar.example');
    await submitEnquiry();

    await app.inject({
      method: 'PATCH',
      url: `/api/admin/wholesale/requests/${String(mine)}`,
      remoteAddress: freshAddress(),
      headers: auth(),
      payload: { assignedToId: opsId },
    });

    const response = await get('/api/admin/wholesale/requests?unassigned=true');
    const names = response.json<AdminWholesaleListResponse>().items.map((row) => row.businessName);
    expect(names).toEqual(['Samarkand Grill']);
  });

  it('takes an enquiry and marks it contacted in one call', async () => {
    const id = await submitEnquiry();

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/admin/wholesale/requests/${String(id)}`,
      remoteAddress: freshAddress(),
      headers: auth(),
      payload: { status: 'contacted', assignedToId: opsId },
    });
    expect(response.statusCode).toBe(200);

    const detail = response.json<AdminWholesaleDetail>();
    expect(detail.status).toBe('contacted');
    expect(detail.assignedToName).toBe('Dilnoza R.');
    expect(detail.categoriesOfInterest).toEqual(['rice-grains', 'spices']);
  });

  it('hands an enquiry back to the pool', async () => {
    const id = await submitEnquiry();
    const url = `/api/admin/wholesale/requests/${String(id)}`;

    await app.inject({
      method: 'PATCH',
      url,
      remoteAddress: freshAddress(),
      headers: auth(),
      payload: { assignedToId: opsId },
    });
    const released = await app.inject({
      method: 'PATCH',
      url,
      remoteAddress: freshAddress(),
      headers: auth(),
      // Explicitly null, which is why the field is nullable rather than merely absent.
      payload: { assignedToId: null },
    });

    expect(released.json<AdminWholesaleDetail>().assignedToId).toBeNull();
  });

  it('refuses an assignee who does not exist', async () => {
    const id = await submitEnquiry();

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/admin/wholesale/requests/${String(id)}`,
      remoteAddress: freshAddress(),
      headers: auth(),
      payload: { assignedToId: 99_999 },
    });
    // A stale id from a colleague's open tab must not assign work to nobody.
    expect(response.statusCode).toBe(422);
  });

  it('refuses a triage that changes nothing', async () => {
    const id = await submitEnquiry();

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/admin/wholesale/requests/${String(id)}`,
      remoteAddress: freshAddress(),
      headers: auth(),
      payload: {},
    });
    expect(response.statusCode).toBe(422);
  });

  it('appends notes in order, each stamped with its author', async () => {
    const id = await submitEnquiry();
    const url = `/api/admin/wholesale/requests/${String(id)}/notes`;

    const first = await app.inject({
      method: 'POST',
      url,
      remoteAddress: freshAddress(),
      headers: auth(),
      payload: { body: 'Left a voicemail.' },
    });
    expect(first.statusCode).toBe(201);

    await app.inject({
      method: 'POST',
      url,
      remoteAddress: freshAddress(),
      headers: auth(),
      payload: { body: 'They called back; sending a price list.' },
    });

    const detail = (
      await get(`/api/admin/wholesale/requests/${String(id)}`)
    ).json<AdminWholesaleDetail>();
    expect(detail.thread.map((note) => note.body)).toEqual([
      'Left a voicemail.',
      'They called back; sending a price list.',
    ]);
    expect(detail.thread[0]?.authorName).toBe('Dilnoza R.');
    expect(detail.noteCount).toBe(2);
  });

  it('keeps a note’s author after that account is deleted', async () => {
    const id = await submitEnquiry();
    await app.inject({
      method: 'POST',
      url: `/api/admin/wholesale/requests/${String(id)}/notes`,
      remoteAddress: freshAddress(),
      headers: auth(),
      payload: { body: 'Quoted at the 500-2000 lb band.' },
    });

    // The foreign key is ON DELETE SET NULL; the copied name is what the thread reads.
    await app.db.delete(adminUsers).where(eq(adminUsers.id, opsId));

    const [sales] = await app.db
      .select({ id: adminUsers.id })
      .from(adminUsers)
      .where(eq(adminUsers.email, 'sales@silkgrain.test'));
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/admin/login',
      remoteAddress: freshAddress(),
      payload: { email: 'sales@silkgrain.test', password: FIXTURE_PASSWORD },
    });
    token = login.json<{ accessToken: string }>().accessToken;
    expect(sales?.id).toBeGreaterThan(0);

    const detail = (
      await get(`/api/admin/wholesale/requests/${String(id)}`)
    ).json<AdminWholesaleDetail>();
    expect(detail.thread[0]?.authorName).toBe('Dilnoza R.');
  });

  it('rejects an empty note rather than storing a blank line', async () => {
    const id = await submitEnquiry();

    const response = await app.inject({
      method: 'POST',
      url: `/api/admin/wholesale/requests/${String(id)}/notes`,
      remoteAddress: freshAddress(),
      headers: auth(),
      payload: { body: '   ' },
    });
    expect(response.statusCode).toBe(422);
  });

  it('offers the active team as assignees and leaves out the departed', async () => {
    const response = await get('/api/admin/users');
    expect(response.statusCode).toBe(200);

    const names = response.json<AdminUserOption[]>().map((user) => user.name);
    expect(names).toEqual(['Dilnoza R.', 'Sevara A.']);
  });

  it('is a 404 for an enquiry that does not exist', async () => {
    const response = await get('/api/admin/wholesale/requests/99999');
    expect(response.statusCode).toBe(404);
  });
});
