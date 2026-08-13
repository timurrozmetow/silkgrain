import type {
  AdminOrderDetail,
  AdminOrderListResponse,
  CheckoutIntentInput,
} from '@silkgrain/contracts';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { adminUsers, inventoryMovements, orders, productVariants, products } from '../../db/schema';
import { hashPassword } from '../../lib/password';
import {
  type CatalogFixture,
  FIXTURE_PASSWORD,
  seedCatalogFixture,
} from '../../test/fixtures/catalog';
import { buildTestApp, freshAddress, testEnv, truncateAll } from '../../test/harness';
import { quoteCart } from '../cart/cart.service';
import { createPendingOrder } from '../checkout/checkout.service';
import { markOrderPaid } from '../orders/settle.service';

/**
 * The back office's orders.
 *
 * What is worth testing here is not the reads - it is that a status change does everything the
 * change implies, in one transaction, and refuses everything it should. Three rules in particular:
 * an order cannot reach a status the transition map does not allow, cancelling a paid order puts
 * its stock back and cancelling an unpaid one does not, and `refunded` is not reachable from this
 * contour at all.
 */
describe('admin orders', () => {
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
    // Order numbers are a per-year sequence, so truncating the database hands the next test the
    // same numbers - and therefore the same email job ids, which BullMQ refuses as duplicates.
    // Emptying the queue between tests is what keeps "exactly one notice" an assertion about this
    // test rather than about which tests ran before it.
    await app.emailQueue.obliterate({ force: true });
    fixture = await seedCatalogFixture(app.db);

    await app.db.insert(adminUsers).values({
      email: 'ops@silkgrain.test',
      passwordHash: await hashPassword(FIXTURE_PASSWORD),
      name: 'Dilnoza R.',
      role: 'manager',
    });
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/admin/login',
      remoteAddress: freshAddress(),
      payload: { email: 'ops@silkgrain.test', password: FIXTURE_PASSWORD },
    });
    token = login.json<{ accessToken: string }>().accessToken;
  });

  const auth = () => ({ authorization: `Bearer ${token}` });

  const ADDRESS = {
    firstName: 'Nodira',
    lastName: 'Yusupova',
    line1: '5850 San Felipe St',
    city: 'Houston',
    state: 'TX' as const,
    zip: '77057',
    country: 'US' as const,
  };

  /** A pending order for two bags, written the way checkout writes one. */
  async function placeOrder(
    email = 'buyer@example.com',
  ): Promise<{ id: number; number: string; totalCents: number }> {
    const lines = [{ variantId: fixture.variants.devzira2lb, qty: 2 }];
    const quote = await quoteCart(
      app.db,
      { lines, shippingMethod: 'standard' },
      { strictPromo: false, identity: { email } },
    );
    const intent: CheckoutIntentInput = {
      email,
      lines,
      shippingAddress: ADDRESS,
      shippingMethod: 'standard',
      marketingOptIn: false,
      provider: 'stripe',
      expectedTotalCents: quote.totalCents,
    };
    const created = await createPendingOrder(app.db, intent, {
      customerId: null,
      orderNumberPrefix: 'SG',
    });
    return { id: created.id, number: created.orderNumber, totalCents: quote.totalCents };
  }

  /** The same order, paid - which is what decrements the stock. */
  async function placePaidOrder(email = 'buyer@example.com') {
    const order = await placeOrder(email);
    await markOrderPaid(app.db, order.id, {
      provider: 'stripe',
      providerPaymentId: `pi_${order.number}`,
      amountCents: order.totalCents,
      currency: 'USD',
      cardBrand: 'visa',
      cardLast4: '4242',
    });
    return order;
  }

  const stockOf = async (variantId: number) => {
    const [row] = await app.db
      .select({ stockQty: productVariants.stockQty })
      .from(productVariants)
      .where(eq(productVariants.id, variantId));
    return row?.stockQty ?? -1;
  };

  async function patchStatus(
    number: string,
    body: Record<string, unknown>,
  ): Promise<Awaited<ReturnType<FastifyInstance['inject']>>> {
    return app.inject({
      method: 'PATCH',
      url: `/api/admin/orders/${number}/status`,
      remoteAddress: freshAddress(),
      headers: auth(),
      payload: body,
    });
  }

  it('refuses every order route without an admin session', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/orders',
      remoteAddress: freshAddress(),
    });
    expect(response.statusCode).toBe(401);
  });

  it('lists orders newest first, with the email a customer view would not carry', async () => {
    await placeOrder('first@example.com');
    await placeOrder('second@example.com');

    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/orders?perPage=5',
      remoteAddress: freshAddress(),
      headers: auth(),
    });
    expect(response.statusCode).toBe(200);

    const body = response.json<AdminOrderListResponse>();
    const emails = body.items.map((item) => item.email);
    expect(emails.slice(0, 2)).toEqual(['second@example.com', 'first@example.com']);
    // Two bags on one line: the count is quantities, not lines.
    expect(body.items[0]?.itemCount).toBe(2);
  });

  it('finds an order by its number and by an email', async () => {
    const order = await placeOrder('findme@example.com');

    for (const q of [order.number, 'findme@example.com']) {
      const response = await app.inject({
        method: 'GET',
        url: `/api/admin/orders?q=${encodeURIComponent(q)}`,
        remoteAddress: freshAddress(),
        headers: auth(),
      });
      const body = response.json<AdminOrderListResponse>();
      expect(body.items.map((item) => item.orderNumber)).toContain(order.number);
    }
  });

  it('answers the fulfilment queue with paid and processing together', async () => {
    const paid = await placePaidOrder('paid@example.com');
    await placeOrder('pending@example.com');

    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/orders?needsFulfilment=true',
      remoteAddress: freshAddress(),
      headers: auth(),
    });
    const numbers = response.json<AdminOrderListResponse>().items.map((item) => item.orderNumber);
    expect(numbers).toContain(paid.number);
    // A pending order is not somebody's work yet - it has not been paid for.
    const [pendingRow] = await app.db
      .select({ orderNumber: orders.orderNumber })
      .from(orders)
      .where(eq(orders.email, 'pending@example.com'));
    expect(numbers).not.toContain(pendingRow?.orderNumber);
  });

  it('carries the internal note and the transitions the order may make', async () => {
    const order = await placePaidOrder();

    const response = await app.inject({
      method: 'GET',
      url: `/api/admin/orders/${order.number}`,
      remoteAddress: freshAddress(),
      headers: auth(),
    });
    expect(response.statusCode).toBe(200);

    const detail = response.json<AdminOrderDetail>();
    expect(detail.status).toBe('paid');
    expect(detail.payment?.providerPaymentId).toBe(`pi_${order.number}`);
    // `refunded` is in the transition map and deliberately not offered here.
    expect(detail.allowedTransitions).toEqual(['processing', 'cancelled']);
    expect(detail).toHaveProperty('adminNote');
  });

  it('moves a paid order to processing and then shipped, stamping the dates', async () => {
    const order = await placePaidOrder();

    expect((await patchStatus(order.number, { status: 'processing' })).statusCode).toBe(200);

    const shipped = await patchStatus(order.number, {
      status: 'shipped',
      carrier: 'UPS',
      trackingNumber: '1Z999AA10123456784',
    });
    expect(shipped.statusCode).toBe(200);

    const detail = shipped.json<AdminOrderDetail>();
    expect(detail.status).toBe('shipped');
    expect(detail.shippedAt).not.toBeNull();
    // The tracking arrives with the shipment, not in a second request: a "your order shipped"
    // email with nothing to follow is worse than no email.
    expect(detail.tracking).toEqual({
      carrier: 'UPS',
      number: '1Z999AA10123456784',
      url: null,
    });
  });

  it('queues the shipping notice exactly once, keyed on the order', async () => {
    const order = await placePaidOrder();
    await patchStatus(order.number, { status: 'processing' });
    await patchStatus(order.number, { status: 'shipped', carrier: 'UPS', trackingNumber: 'X1' });

    const job = await app.emailQueue.getJob(`order_shipped.${order.number}`);
    expect(job?.data).toEqual({
      type: 'order_shipped',
      orderNumber: order.number,
      email: 'buyer@example.com',
    });
  });

  it('refuses a transition the map does not allow', async () => {
    const order = await placePaidOrder();

    // paid -> delivered skips the two states in between; the map does not allow it.
    const response = await patchStatus(order.number, { status: 'delivered' });
    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('ORDER_STATUS_INVALID');
  });

  it('will not mark an order refunded, however the request is phrased', async () => {
    const order = await placePaidOrder();

    const response = await patchStatus(order.number, { status: 'refunded' });
    // A refund is money leaving the account. It is recorded when the provider says so, and this
    // contour has no way to make that true.
    expect(response.statusCode).toBe(409);

    const [row] = await app.db.select().from(orders).where(eq(orders.id, order.id));
    expect(row?.status).toBe('paid');
  });

  it('returns stock to the shelf when a paid order is cancelled', async () => {
    const before = await stockOf(fixture.variants.devzira2lb);
    const order = await placePaidOrder();
    const afterPaid = await stockOf(fixture.variants.devzira2lb);
    expect(afterPaid).toBe(before - 2);

    const response = await patchStatus(order.number, {
      status: 'cancelled',
      note: 'Customer changed their mind',
    });
    expect(response.statusCode).toBe(200);

    expect(await stockOf(fixture.variants.devzira2lb)).toBe(before);

    // The ledger says why, with `cancellation` rather than `restock`: the goods never left.
    const movements = await app.db
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.referenceId, order.id));
    const credit = movements.find((movement) => movement.delta > 0);
    expect(credit?.reason).toBe('cancellation');
    expect(credit?.delta).toBe(2);

    // And the note survives the person who wrote it.
    expect(response.json<AdminOrderDetail>().adminNote).toContain('Customer changed their mind');
  });

  it('reverses the sold count as well, so the bestseller sort does not count it', async () => {
    const productId = fixture.productIds['devzira-rice'];
    const soldBefore = await soldCountOf(productId);

    const order = await placePaidOrder();
    expect(await soldCountOf(productId)).toBe(soldBefore + 2);

    await patchStatus(order.number, { status: 'cancelled' });
    expect(await soldCountOf(productId)).toBe(soldBefore);
  });

  it('does not restock an order that was never paid for', async () => {
    const before = await stockOf(fixture.variants.devzira2lb);
    const order = await placeOrder();
    // A pending order decremented nothing, so crediting stock here would invent inventory.
    expect(await stockOf(fixture.variants.devzira2lb)).toBe(before);

    expect((await patchStatus(order.number, { status: 'cancelled' })).statusCode).toBe(200);
    expect(await stockOf(fixture.variants.devzira2lb)).toBe(before);
  });

  it('leaves a cancelled order with nowhere left to go', async () => {
    const order = await placeOrder();
    const cancelled = await patchStatus(order.number, { status: 'cancelled' });

    expect(cancelled.json<AdminOrderDetail>().allowedTransitions).toEqual([]);
    expect((await patchStatus(order.number, { status: 'paid' })).statusCode).toBe(409);
  });

  it('corrects tracking without shipping the order a second time', async () => {
    const order = await placePaidOrder();
    await patchStatus(order.number, { status: 'processing' });
    await patchStatus(order.number, { status: 'shipped', carrier: 'UPS', trackingNumber: 'typo' });

    const response = await app.inject({
      method: 'PUT',
      url: `/api/admin/orders/${order.number}/tracking`,
      remoteAddress: freshAddress(),
      headers: auth(),
      payload: { carrier: 'FedEx', trackingNumber: '772233445566', trackingUrl: null },
    });
    expect(response.statusCode).toBe(200);

    const detail = response.json<AdminOrderDetail>();
    expect(detail.tracking?.number).toBe('772233445566');
    // Still shipped, and still exactly one notice - correcting a number must not send another.
    expect(detail.status).toBe('shipped');
    const jobs = await app.emailQueue.getJobs(['waiting', 'completed', 'failed', 'active']);
    expect(jobs.filter((job) => job.data.type === 'order_shipped')).toHaveLength(1);
  });

  it('stores the internal note where no storefront response can reach it', async () => {
    const order = await placeOrder();

    const response = await app.inject({
      method: 'PUT',
      url: `/api/admin/orders/${order.number}/note`,
      remoteAddress: freshAddress(),
      headers: auth(),
      payload: { adminNote: 'Called about the delivery window' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<AdminOrderDetail>().adminNote).toBe('Called about the delivery window');

    // The customer's own view of the same order has no field for it at all.
    const customerView = await app.inject({
      method: 'GET',
      url: `/api/orders/${order.number}?email=buyer@example.com`,
      remoteAddress: freshAddress(),
    });
    expect(customerView.statusCode).toBe(200);
    expect(customerView.json<Record<string, unknown>>()).not.toHaveProperty('adminNote');
  });

  it('is a 404 for a number that was never issued', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/orders/SG-2026-99999',
      remoteAddress: freshAddress(),
      headers: auth(),
    });
    expect(response.statusCode).toBe(404);
  });

  async function soldCountOf(productId: number): Promise<number> {
    const [row] = await app.db
      .select({ soldCount: products.soldCount })
      .from(products)
      .where(eq(products.id, productId));
    return row?.soldCount ?? -1;
  }
});
