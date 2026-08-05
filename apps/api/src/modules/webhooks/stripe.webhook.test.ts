import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import Stripe from 'stripe';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  inventoryMovements,
  orders,
  payments,
  productVariants,
  products,
  promoCodes,
  promoRedemptions,
  webhookEvents,
} from '../../db/schema';
import { type CatalogFixture, seedCatalogFixture } from '../../test/fixtures/catalog';
import { type PendingOrder, seedPendingOrder } from '../../test/fixtures/orders';
import { buildTestApp, freshAddress, testEnv, truncateAll } from '../../test/harness';

/**
 * The payment webhook.
 *
 * Signature verification is pure HMAC over the request bytes, and Stripe's own SDK will
 * generate a valid header for any secret, so this entire file runs without a Stripe account.
 * What it cannot cover is the call that creates a PaymentIntent; that needs real test keys.
 */
describe('stripe webhook', () => {
  let app: FastifyInstance;
  let fixture: CatalogFixture;
  let databaseUrl: string;
  let webhookSecret: string;
  let stripe: Stripe;

  beforeAll(async () => {
    app = await buildTestApp();
    const env = testEnv();
    databaseUrl = env.DATABASE_URL;
    webhookSecret = env.STRIPE_WEBHOOK_SECRET;
    stripe = new Stripe(env.STRIPE_SECRET_KEY);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Every case settles an order and moves stock, so each starts from the same catalogue.
    await truncateAll(databaseUrl);
    fixture = await seedCatalogFixture(app.db);
  });

  // ---------------------------------------------------------------------- event builders

  let eventCounter = 0;
  function nextId(kind: string): string {
    eventCounter += 1;
    return `${kind}_test_${String(eventCounter)}`;
  }

  function succeeded(order: PendingOrder, overrides: Record<string, unknown> = {}) {
    return {
      id: nextId('evt'),
      object: 'event',
      type: 'payment_intent.succeeded',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: nextId('pi'),
          object: 'payment_intent',
          amount: order.totalCents,
          amount_received: order.totalCents,
          currency: 'usd',
          metadata: { order_id: String(order.id) },
          latest_charge: {
            id: nextId('ch'),
            object: 'charge',
            payment_method_details: { card: { brand: 'visa', last4: '4242' } },
          },
          ...overrides,
        },
      },
    };
  }

  async function deliver(
    event: object,
    options: { signature?: string; timestamp?: number } = {},
  ): Promise<{ status: number; body: string }> {
    const payload = JSON.stringify(event);
    const signature =
      options.signature ??
      stripe.webhooks.generateTestHeaderString({
        payload,
        secret: webhookSecret,
        ...(options.timestamp === undefined ? {} : { timestamp: options.timestamp }),
      });

    const response = await app.inject({
      method: 'POST',
      url: '/api/webhooks/stripe',
      remoteAddress: freshAddress(),
      headers: { 'content-type': 'application/json', 'stripe-signature': signature },
      payload,
    });
    return { status: response.statusCode, body: response.body };
  }

  const stockOf = async (variantId: number) =>
    (
      await app.db
        .select({ stockQty: productVariants.stockQty })
        .from(productVariants)
        .where(eq(productVariants.id, variantId))
    )[0]?.stockQty;

  const orderRow = async (id: number) =>
    (await app.db.select().from(orders).where(eq(orders.id, id)))[0];

  // -------------------------------------------------------------------------- settlement

  it('moves the order to paid and takes the stock in one go', async () => {
    const order = await seedPendingOrder(app.db, fixture);
    const before = order.lines[0];

    const { status } = await deliver(succeeded(order));
    expect(status).toBe(200);

    const row = await orderRow(order.id);
    expect(row?.status).toBe('paid');
    expect(row?.paidAt).toBeInstanceOf(Date);

    expect(await stockOf(before!.variantId)).toBe(before!.stockBefore - before!.qty);

    const movements = await app.db
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.variantId, before!.variantId));
    expect(movements).toHaveLength(1);
    expect(movements[0]?.delta).toBe(-before!.qty);
    expect(movements[0]?.reason).toBe('order');

    const [payment] = await app.db.select().from(payments).where(eq(payments.orderId, order.id));
    expect(payment?.status).toBe('succeeded');
    expect(payment?.amountCents).toBe(order.totalCents);
    expect(payment?.cardBrand).toBe('visa');
    expect(payment?.cardLast4).toBe('4242');

    const [product] = await app.db
      .select({ soldCount: products.soldCount })
      .from(products)
      .where(eq(products.id, fixture.productIds['devzira-rice']));
    expect(product?.soldCount).toBe(500 + before!.qty);
  });

  /** The acceptance criterion: a redelivery must not create a second anything. */
  it('acknowledges a redelivered event without touching the order twice', async () => {
    const order = await seedPendingOrder(app.db, fixture);
    const event = succeeded(order);
    const before = order.lines[0];

    expect((await deliver(event)).status).toBe(200);
    expect((await deliver(event)).status).toBe(200);

    expect(await stockOf(before!.variantId)).toBe(before!.stockBefore - before!.qty);
    expect(
      await app.db
        .select()
        .from(inventoryMovements)
        .where(eq(inventoryMovements.variantId, before!.variantId)),
    ).toHaveLength(1);
    expect(
      await app.db.select().from(webhookEvents).where(eq(webhookEvents.eventId, event.id)),
    ).toHaveLength(1);
  });

  /**
   * Two deliveries of the same event at once. The unique index lets one of them in, and the
   * `FOR UPDATE` on the order makes the other wait and then find the work already done.
   */
  it('survives two deliveries racing each other', async () => {
    const order = await seedPendingOrder(app.db, fixture);
    const event = succeeded(order);
    const before = order.lines[0];

    const [first, second] = await Promise.all([deliver(event), deliver(event)]);

    expect([first.status, second.status]).toEqual([200, 200]);
    expect(await stockOf(before!.variantId)).toBe(before!.stockBefore - before!.qty);
    expect(
      await app.db
        .select()
        .from(inventoryMovements)
        .where(eq(inventoryMovements.variantId, before!.variantId)),
    ).toHaveLength(1);
  });

  it('does not decrement twice for a second event about an order already paid', async () => {
    const order = await seedPendingOrder(app.db, fixture);
    const before = order.lines[0];

    expect((await deliver(succeeded(order))).status).toBe(200);
    // A different event id, so idempotency by event cannot help. The order's own status must.
    expect((await deliver(succeeded(order))).status).toBe(200);

    expect(await stockOf(before!.variantId)).toBe(before!.stockBefore - before!.qty);
  });

  it('records the promo redemption and counts it against the code', async () => {
    const order = await seedPendingOrder(app.db, fixture, {
      promoCode: 'FLAT5',
      promoDiscountCents: 500,
    });

    expect((await deliver(succeeded(order))).status).toBe(200);

    const redemptions = await app.db
      .select()
      .from(promoRedemptions)
      .where(eq(promoRedemptions.orderId, order.id));
    expect(redemptions).toHaveLength(1);
    expect(redemptions[0]?.discountCents).toBe(500);
    expect(redemptions[0]?.email).toBe(order.email);

    const [code] = await app.db
      .select({ usedCount: promoCodes.usedCount })
      .from(promoCodes)
      .where(eq(promoCodes.code, 'FLAT5'));
    expect(code?.usedCount).toBe(1);
  });

  // ------------------------------------------------------------------------- verification

  it('refuses an event it cannot verify, and writes nothing', async () => {
    const order = await seedPendingOrder(app.db, fixture);

    const forged = await deliver(succeeded(order), {
      signature: 't=1,v1=0000000000000000000000000000000000000000000000000000000000000000',
    });
    expect(forged.status).toBe(400);
    expect(forged.body).toContain('WEBHOOK_SIGNATURE_INVALID');

    expect((await orderRow(order.id))?.status).toBe('pending');
    expect(await app.db.select().from(webhookEvents)).toHaveLength(0);
  });

  it('refuses a body signed with the wrong secret', async () => {
    const order = await seedPendingOrder(app.db, fixture);
    const payload = JSON.stringify(succeeded(order));
    const signature = stripe.webhooks.generateTestHeaderString({
      payload,
      secret: 'whsec_a_different_secret',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/webhooks/stripe',
      remoteAddress: freshAddress(),
      headers: { 'content-type': 'application/json', 'stripe-signature': signature },
      payload,
    });
    expect(response.statusCode).toBe(400);
  });

  it('refuses a replay of a body signed long ago', async () => {
    const order = await seedPendingOrder(app.db, fixture);
    const anHourAgo = Math.floor(Date.now() / 1000) - 3600;

    const { status } = await deliver(succeeded(order), { timestamp: anHourAgo });
    expect(status).toBe(400);
  });

  it('refuses a request with no signature at all', async () => {
    const order = await seedPendingOrder(app.db, fixture);
    const response = await app.inject({
      method: 'POST',
      url: '/api/webhooks/stripe',
      remoteAddress: freshAddress(),
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify(succeeded(order)),
    });
    expect(response.statusCode).toBe(400);
  });

  /**
   * The signature covers the exact bytes Stripe sent. This is what the scoped raw-body parser
   * exists for, and it would break silently the moment the JSON parser reclaimed this route.
   */
  it('verifies against the raw bytes rather than a re-serialised body', async () => {
    const order = await seedPendingOrder(app.db, fixture);
    const event = succeeded(order);
    // Same object, different bytes: whitespace no `JSON.stringify` would produce.
    const spaced = JSON.stringify(event, null, 2);
    const signature = stripe.webhooks.generateTestHeaderString({
      payload: spaced,
      secret: webhookSecret,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/webhooks/stripe',
      remoteAddress: freshAddress(),
      headers: { 'content-type': 'application/json', 'stripe-signature': signature },
      payload: spaced,
    });
    expect(response.statusCode).toBe(200);
    expect((await orderRow(order.id))?.status).toBe('paid');
  });

  // ------------------------------------------------------------------------ other outcomes

  it('leaves the order pending when the payment is declined', async () => {
    const order = await seedPendingOrder(app.db, fixture);
    const before = order.lines[0];

    const { status } = await deliver({
      id: nextId('evt'),
      object: 'event',
      type: 'payment_intent.payment_failed',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: nextId('pi'),
          object: 'payment_intent',
          amount: order.totalCents,
          currency: 'usd',
          metadata: { order_id: String(order.id) },
          last_payment_error: { code: 'card_declined', message: 'Your card was declined.' },
        },
      },
    });

    expect(status).toBe(200);
    // Still pending on purpose: the customer is on the checkout page and may try another card.
    expect((await orderRow(order.id))?.status).toBe('pending');
    expect(await stockOf(before!.variantId)).toBe(before!.stockBefore);

    const [payment] = await app.db.select().from(payments).where(eq(payments.orderId, order.id));
    expect(payment?.status).toBe('failed');
    expect(payment?.failureCode).toBe('card_declined');
  });

  it('marks a fully refunded order refunded without putting the stock back', async () => {
    const order = await seedPendingOrder(app.db, fixture);
    const before = order.lines[0];
    const paid = succeeded(order);
    expect((await deliver(paid)).status).toBe(200);

    const intentId = (paid.data.object as { id: string }).id;
    const { status } = await deliver({
      id: nextId('evt'),
      object: 'event',
      type: 'charge.refunded',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: nextId('ch'),
          object: 'charge',
          payment_intent: intentId,
          amount_refunded: order.totalCents,
          metadata: { order_id: String(order.id) },
        },
      },
    });

    expect(status).toBe(200);
    const row = await orderRow(order.id);
    expect(row?.status).toBe('refunded');
    expect(row?.refundedAt).toBeInstanceOf(Date);
    // The rice is in the customer's kitchen, not back on the shelf.
    expect(await stockOf(before!.variantId)).toBe(before!.stockBefore - before!.qty);
  });

  /**
   * `latest_charge` is a bare id unless the event expanded it, and absent entirely on an
   * intent that never produced one. Dereferencing it cost a 500 and a redelivery loop before
   * this test existed.
   */
  it('settles a payment whose charge was never expanded', async () => {
    const order = await seedPendingOrder(app.db, fixture);
    const before = order.lines[0];
    const event = succeeded(order);
    // Two shapes Stripe really sends, neither of them an object.
    delete (event.data.object as { latest_charge?: unknown }).latest_charge;

    expect((await deliver(event)).status).toBe(200);
    expect((await orderRow(order.id))?.status).toBe('paid');
    expect(await stockOf(before!.variantId)).toBe(before!.stockBefore - before!.qty);

    const [payment] = await app.db.select().from(payments).where(eq(payments.orderId, order.id));
    expect(payment?.status).toBe('succeeded');
    expect(payment?.cardBrand).toBeNull();
    expect(payment?.cardLast4).toBeNull();
  });

  it('settles a payment whose charge is only an id', async () => {
    const order = await seedPendingOrder(app.db, fixture, { orderNumber: 'SG-2026-09004' });
    const event = succeeded(order, { latest_charge: 'ch_unexpanded_1' });

    expect((await deliver(event)).status).toBe(200);
    expect((await orderRow(order.id))?.status).toBe('paid');
  });

  it('acknowledges an event type it does not act on', async () => {
    const event = {
      id: nextId('evt'),
      object: 'event',
      type: 'customer.created',
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: 'cus_1', object: 'customer' } },
    };
    expect((await deliver(event)).status).toBe(200);

    const [recorded] = await app.db
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.eventId, event.id));
    expect(recorded?.processedAt).toBeInstanceOf(Date);
  });

  // --------------------------------------------------------------------------- failures

  it('refuses to settle an amount that is not what the order says', async () => {
    const order = await seedPendingOrder(app.db, fixture);
    const before = order.lines[0];
    const event = succeeded(order, { amount_received: order.totalCents - 100 });

    const { status } = await deliver(event);

    // A 500 asks Stripe to try again and puts the reason where a person will find it.
    expect(status).toBe(500);
    expect((await orderRow(order.id))?.status).toBe('pending');
    expect(await stockOf(before!.variantId)).toBe(before!.stockBefore);

    const [recorded] = await app.db
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.eventId, event.id));
    expect(recorded?.processedAt).toBeNull();
    expect(recorded?.error).toContain('cents');
  });

  /**
   * The money is already taken and there is not enough stock to honour it. Rolling back leaves
   * the order pending and the failure recorded, which is the state that gets a human involved;
   * clamping the stock at zero would hide that the shop owes somebody a delivery.
   */
  it('rolls back rather than overselling, and never writes negative stock', async () => {
    const order = await seedPendingOrder(app.db, fixture, {
      orderNumber: 'SG-2026-09002',
      // The 5 lb variant has five in stock.
      lines: [{ variantId: fixture.variants.devzira5lbLow, qty: 10, unitPriceCents: 2500 }],
    });

    const { status } = await deliver(succeeded(order));

    expect(status).toBe(500);
    expect((await orderRow(order.id))?.status).toBe('pending');
    expect(await stockOf(fixture.variants.devzira5lbLow)).toBe(5);

    const [recorded] = await app.db.select().from(webhookEvents);
    expect(recorded?.error).toContain('stock');
    expect(recorded?.processedAt).toBeNull();
  });

  it('retries an event whose first attempt failed', async () => {
    const order = await seedPendingOrder(app.db, fixture, {
      orderNumber: 'SG-2026-09003',
      lines: [{ variantId: fixture.variants.devzira5lbLow, qty: 10, unitPriceCents: 2500 }],
    });
    const event = succeeded(order);

    expect((await deliver(event)).status).toBe(500);

    // Somebody restocks, Stripe redelivers, and the event must not be treated as done.
    await app.db
      .update(productVariants)
      .set({ stockQty: 40 })
      .where(eq(productVariants.id, fixture.variants.devzira5lbLow));

    expect((await deliver(event)).status).toBe(200);
    expect((await orderRow(order.id))?.status).toBe('paid');
    expect(await stockOf(fixture.variants.devzira5lbLow)).toBe(30);

    const [recorded] = await app.db
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.eventId, event.id));
    expect(recorded?.attempts).toBe(2);
    expect(recorded?.processedAt).toBeInstanceOf(Date);
    expect(recorded?.error).toBeNull();
  });

  it('fails an event that names an order that does not exist', async () => {
    const { status } = await deliver({
      id: nextId('evt'),
      object: 'event',
      type: 'payment_intent.succeeded',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: nextId('pi'),
          object: 'payment_intent',
          amount_received: 1000,
          currency: 'usd',
          metadata: { order_id: '987654' },
        },
      },
    });
    expect(status).toBe(500);
  });
});
