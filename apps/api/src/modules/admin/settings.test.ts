import type { AdminSettings, PublicSettings } from '@silkgrain/contracts';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { adminUsers, settings, shippingRates } from '../../db/schema';
import { hashPassword } from '../../lib/password';
import { FIXTURE_PASSWORD, seedCatalogFixture } from '../../test/fixtures/catalog';
import { buildTestApp, freshAddress, testEnv, truncateAll } from '../../test/harness';

/**
 * Settings and shipping rates.
 *
 * Two things are worth most of these tests. First, the read has to be total: `settings.value` is a
 * nullable JSON column and a hand-edit can leave anything in it, so a serialiser that refused a
 * malformed row would 500 on the one screen that can repair it. Second, decision D-22 - the
 * checkout charges free shipping from `shipping_rates.free_above_cents`, so that is the only
 * editable free-shipping figure and the storefront's announcement reads the same number.
 */
describe('admin settings', () => {
  let app: FastifyInstance;
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
    await seedCatalogFixture(app.db);

    const hash = await hashPassword(FIXTURE_PASSWORD);
    await app.db.insert(adminUsers).values([
      { email: 'owner@silkgrain.test', passwordHash: hash, name: 'Timur R.', role: 'owner' },
      { email: 'support@silkgrain.test', passwordHash: hash, name: 'Ben C.', role: 'support' },
    ]);
    token = await signIn('owner@silkgrain.test');

    // The catalogue fixture already seeds the three shipping rates and the tax setting, so this
    // adds only the two rows these tests need on top of them.
    await app.db.insert(settings).values([
      {
        key: 'announcement.text',
        value: 'Complimentary shipping over $75',
        group: 'content',
        label: 'Announcement',
        isPublic: true,
      },
      {
        key: 'store.contact_email',
        value: 'hello@silkgrain.example',
        group: 'general',
        label: 'Contact email',
        isPublic: true,
      },
    ]);
  });

  async function signIn(email: string): Promise<string> {
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/admin/login',
      remoteAddress: freshAddress(),
      payload: { email, password: FIXTURE_PASSWORD },
    });
    return login.json<{ accessToken: string }>().accessToken;
  }

  const auth = () => ({ authorization: `Bearer ${token}` });
  const read = async (): Promise<AdminSettings> => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/settings',
      remoteAddress: freshAddress(),
      headers: auth(),
    });
    return response.json<AdminSettings>();
  };
  const rateId = async (code: string) => {
    const [row] = await app.db
      .select({ id: shippingRates.id })
      .from(shippingRates)
      .where(eq(shippingRates.code, code as 'standard'));
    return row?.id ?? 0;
  };

  it('refuses the settings read without an admin session', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/settings',
      remoteAddress: freshAddress(),
    });
    expect(response.statusCode).toBe(401);
  });

  it('reads registered values through the registry, with their kind', async () => {
    const body = await read();
    const tax = body.values.find((row) => row.key === 'commerce.default_tax_basis_points');
    expect(tax?.value).toEqual({ kind: 'basisPoints', value: 825 });

    const announcement = body.values.find((row) => row.key === 'announcement.text');
    expect(announcement?.value).toEqual({
      kind: 'text',
      value: 'Complimentary shipping over $75',
    });
  });

  it('renders a malformed value rather than failing the whole screen', async () => {
    // What a hand-edit in Studio leaves behind. A serialiser that refused this would 500 on the
    // one screen that can put it right.
    await app.db
      .update(settings)
      .set({ value: '8.25%' })
      .where(eq(settings.key, 'commerce.default_tax_basis_points'));

    const body = await read();
    const tax = body.values.find((row) => row.key === 'commerce.default_tax_basis_points');
    expect(tax?.value).toEqual({ kind: 'malformed', expected: 'basisPoints', json: '"8.25%"' });
  });

  it('shows a key the registry has never heard of, without offering to edit it', async () => {
    await app.db.insert(settings).values({
      key: 'experiment.something',
      value: { nested: true },
      group: 'general',
      label: 'Left by an experiment',
    });

    const body = await read();
    const row = body.values.find((entry) => entry.key === 'experiment.something');
    expect(row?.value.kind).toBe('unregistered');
  });

  it('offers no editor for the free-shipping threshold setting', async () => {
    // D-22: the rate row is the authority, so the panel must contain exactly one editable
    // free-shipping figure. Sending the retired key is a 422 from the strict body schema.
    const response = await app.inject({
      method: 'PUT',
      url: '/api/admin/settings',
      remoteAddress: freshAddress(),
      headers: auth(),
      payload: { 'commerce.free_shipping_threshold_cents': 5000 },
    });
    expect(response.statusCode).toBe(422);
  });

  it('saves the keys the body carried and leaves the rest alone', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/admin/settings',
      remoteAddress: freshAddress(),
      headers: auth(),
      payload: { 'announcement.text': 'Free shipping over $60 this week' },
    });
    expect(response.statusCode).toBe(200);

    const body = response.json<AdminSettings>();
    expect(body.values.find((row) => row.key === 'announcement.text')?.value).toEqual({
      kind: 'text',
      value: 'Free shipping over $60 this week',
    });
    // Untouched.
    expect(
      body.values.find((row) => row.key === 'commerce.default_tax_basis_points')?.value,
    ).toEqual({ kind: 'basisPoints', value: 825 });
  });

  it('refuses a tax rate that is a percentage rather than basis points', async () => {
    for (const value of [8.25, -1, 20_001]) {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/admin/settings',
        remoteAddress: freshAddress(),
        headers: auth(),
        payload: { 'commerce.default_tax_basis_points': value },
      });
      expect(response.statusCode).toBe(422);
    }
  });

  it('refuses a key that does not exist rather than inserting it', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/admin/settings',
      remoteAddress: freshAddress(),
      headers: auth(),
      payload: { 'store.nmae': 'typo' },
    });
    expect(response.statusCode).toBe(422);
  });

  it('is a 404 for a registered key with no row, rather than creating one', async () => {
    // `store.address` is in the registry and this test's seed does not write it.
    const response = await app.inject({
      method: 'PUT',
      url: '/api/admin/settings',
      remoteAddress: freshAddress(),
      headers: auth(),
      payload: { 'store.address': '2200 Post Oak Blvd, Houston, TX' },
    });
    expect(response.statusCode).toBe(404);
  });

  it('refuses an empty body rather than reporting a save that saved nothing', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/admin/settings',
      remoteAddress: freshAddress(),
      headers: auth(),
      payload: {},
    });
    expect(response.statusCode).toBe(422);
  });

  it('writes the whole batch or none of it', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/admin/settings',
      remoteAddress: freshAddress(),
      headers: auth(),
      // The first key exists, the second does not: the 404 must roll the first one back.
      payload: {
        'announcement.text': 'Should not survive',
        'store.address': 'Neither should this',
      },
    });
    expect(response.statusCode).toBe(404);

    const [row] = await app.db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, 'announcement.text'));
    expect(row?.value).toBe('Complimentary shipping over $75');
  });

  it('lets a support account read the settings but not write them', async () => {
    const supportToken = await signIn('support@silkgrain.test');
    const headers = { authorization: `Bearer ${supportToken}` };

    const get = await app.inject({
      method: 'GET',
      url: '/api/admin/settings',
      remoteAddress: freshAddress(),
      headers,
    });
    expect(get.statusCode).toBe(200);

    const put = await app.inject({
      method: 'PUT',
      url: '/api/admin/settings',
      remoteAddress: freshAddress(),
      headers,
      payload: { 'announcement.text': 'Nope' },
    });
    expect(put.statusCode).toBe(403);
  });

  // -------------------------------------------------------------------------- shipping rates

  it('edits a rate, including the figure the checkout charges from', async () => {
    const id = await rateId('standard');
    const response = await app.inject({
      method: 'PUT',
      url: `/api/admin/shipping-rates/${String(id)}`,
      remoteAddress: freshAddress(),
      headers: auth(),
      payload: {
        name: 'Standard',
        description: 'Ground, 3 to 5 business days',
        priceCents: 899,
        freeAboveCents: 6000,
        estimatedDaysMin: 3,
        estimatedDaysMax: 5,
        isActive: true,
        position: 0,
      },
    });
    expect(response.statusCode).toBe(200);

    const rate = response
      .json<AdminSettings>()
      .shippingRates.find((entry) => entry.code === 'standard');
    expect(rate?.priceCents).toBe(899);
    expect(rate?.freeAboveCents).toBe(6000);
  });

  const validRate = (over: Record<string, unknown> = {}) => ({
    name: 'Standard',
    description: null,
    priceCents: 799,
    freeAboveCents: 7500,
    estimatedDaysMin: 3,
    estimatedDaysMax: 5,
    isActive: true,
    position: 0,
    ...over,
  });

  it('refuses a delivery window that ends before it starts, before MySQL does', async () => {
    const id = await rateId('standard');
    const response = await app.inject({
      method: 'PUT',
      url: `/api/admin/shipping-rates/${String(id)}`,
      remoteAddress: freshAddress(),
      headers: auth(),
      payload: validRate({ estimatedDaysMin: 5, estimatedDaysMax: 3 }),
    });
    // The table has a CHECK for this. Reaching it would be a 500 with no field named.
    expect(response.statusCode).toBe(422);
  });

  it('refuses a zero threshold, which would make the method free for everybody', async () => {
    const id = await rateId('standard');
    const response = await app.inject({
      method: 'PUT',
      url: `/api/admin/shipping-rates/${String(id)}`,
      remoteAddress: freshAddress(),
      headers: auth(),
      payload: validRate({ freeAboveCents: 0 }),
    });
    expect(response.statusCode).toBe(422);
  });

  it('will not rename the method code, whatever the body hopefully carries', async () => {
    const id = await rateId('standard');
    const response = await app.inject({
      method: 'PUT',
      url: `/api/admin/shipping-rates/${String(id)}`,
      remoteAddress: freshAddress(),
      headers: auth(),
      payload: validRate({ code: 'express' }),
    });
    // `orders.shipping_method` is a snapshot, not a foreign key: renaming relabels history.
    expect(response.statusCode).toBe(422);
  });

  it('refuses to retire the last active method', async () => {
    for (const code of ['express', 'overnight']) {
      const id = await rateId(code);

      await app.inject({
        method: 'PUT',
        url: `/api/admin/shipping-rates/${String(id)}`,
        remoteAddress: freshAddress(),
        headers: auth(),
        payload: validRate({ name: code, freeAboveCents: null, isActive: false }),
      });
    }

    const standard = await rateId('standard');
    const response = await app.inject({
      method: 'PUT',
      url: `/api/admin/shipping-rates/${String(standard)}`,
      remoteAddress: freshAddress(),
      headers: auth(),
      payload: validRate({ isActive: false }),
    });
    // A checkout with nothing to select cannot take an order.
    expect(response.statusCode).toBe(409);
  });

  it('is a 404 for a rate that does not exist', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/admin/shipping-rates/9999',
      remoteAddress: freshAddress(),
      headers: auth(),
      payload: validRate(),
    });
    expect(response.statusCode).toBe(404);
  });

  // -------------------------------------------------------------------------- what the shop sees

  it('tells the storefront the threshold the checkout actually charges from', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/settings',
      remoteAddress: freshAddress(),
    });
    expect(response.statusCode).toBe(200);

    const body = response.json<PublicSettings>();
    expect(body.freeShippingFromCents).toBe(7500);
    expect(body.announcementText).toBe('Complimentary shipping over $75');
    expect(body.contactEmail).toBe('hello@silkgrain.example');
  });

  it('moves the storefront’s figure when the rate moves, with no second place to edit', async () => {
    const id = await rateId('standard');
    await app.inject({
      method: 'PUT',
      url: `/api/admin/shipping-rates/${String(id)}`,
      remoteAddress: freshAddress(),
      headers: auth(),
      payload: validRate({ freeAboveCents: 5000 }),
    });

    const body = (
      await app.inject({ method: 'GET', url: '/api/settings', remoteAddress: freshAddress() })
    ).json<PublicSettings>();
    expect(body.freeShippingFromCents).toBe(5000);
  });

  it('takes the lowest live threshold, the one a customer can actually reach', async () => {
    const express = await rateId('express');
    await app.inject({
      method: 'PUT',
      url: `/api/admin/shipping-rates/${String(express)}`,
      remoteAddress: freshAddress(),
      headers: auth(),
      payload: validRate({ name: 'Express', priceCents: 1299, freeAboveCents: 4000, position: 1 }),
    });

    const body = (
      await app.inject({ method: 'GET', url: '/api/settings', remoteAddress: freshAddress() })
    ).json<PublicSettings>();
    expect(body.freeShippingFromCents).toBe(4000);
  });

  it('ignores a retired rate’s threshold', async () => {
    const standard = await rateId('standard');
    await app.inject({
      method: 'PUT',
      url: `/api/admin/shipping-rates/${String(standard)}`,
      remoteAddress: freshAddress(),
      headers: auth(),
      payload: validRate({ isActive: false }),
    });

    const body = (
      await app.inject({ method: 'GET', url: '/api/settings', remoteAddress: freshAddress() })
    ).json<PublicSettings>();
    // Express has no threshold, and the retired Standard's must not be promised.
    expect(body.freeShippingFromCents).toBeNull();
  });

  it('renders nothing rather than failing when a public row is malformed', async () => {
    await app.db
      .update(settings)
      .set({ value: { unexpected: 'shape' } })
      .where(eq(settings.key, 'announcement.text'));

    const response = await app.inject({
      method: 'GET',
      url: '/api/settings',
      remoteAddress: freshAddress(),
    });
    // On the critical path of every page load: a bad string must not take the shop down.
    expect(response.statusCode).toBe(200);
    expect(response.json<PublicSettings>().announcementText).toBeNull();
  });

  it('never serves a setting that is not public', async () => {
    await app.db.insert(settings).values({
      key: 'ops.notification_email',
      value: 'ops@silkgrain.internal',
      group: 'operations',
      label: 'Ops address',
      isPublic: false,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/settings',
      remoteAddress: freshAddress(),
    });
    expect(response.body).not.toContain('ops@silkgrain.internal');
  });
});
