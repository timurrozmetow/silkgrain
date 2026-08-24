import type { CheckoutIntentInput } from '@silkgrain/contracts';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { addresses, orderItems, orders, productVariants } from '../../db/schema';
import { type CatalogFixture, seedCatalogFixture } from '../../test/fixtures/catalog';
import { buildTestApp, testEnv, truncateAll } from '../../test/harness';
import { quoteCart } from '../cart/cart.service';

import { TotalMismatchError, createPendingOrder } from './checkout.service';

/**
 * The order writer — everything `POST /api/checkout/intent` does except call Stripe.
 *
 * Tested at the service rather than through a route because the route does not exist yet: it
 * needs a key nobody has (decision D-27). What it will do when the key arrives is this function
 * plus `stripe.paymentIntents.create`, so the arithmetic, the snapshots and the 409 are provable
 * now and only the SDK call is not.
 *
 * The point every test here circles is the rule in `CLAUDE.md`: the order's totals must be the
 * cart's totals. The third place that arithmetic lives is this writer, and the moment it
 * disagrees with `quoteCart`, a customer is charged something other than what the cart showed.
 */
describe('the checkout order writer', () => {
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

  const ADDRESS = {
    firstName: 'Nodira',
    lastName: 'Yusupova',
    line1: '5850 San Felipe St',
    city: 'Houston',
    state: 'TX' as const,
    zip: '77057',
    country: 'US' as const,
  };

  const CONTEXT = { customerId: null, orderNumberPrefix: 'SG' };

  /**
   * Orders this buyer placed.
   *
   * Not `select().from(orders)`: the catalogue fixture seeds one historical order for its
   * returning customer, so the table is never empty and "no order was written" has to mean no
   * order was written *here*.
   */
  const ordersFor = (email: string) => app.db.select().from(orders).where(eq(orders.email, email));

  /** Prices the cart the way the storefront does, so a test states the total it truly expects. */
  async function quoteFor(lines: { variantId: number; qty: number }[], promoCode?: string) {
    return quoteCart(
      app.db,
      { lines, shippingMethod: 'standard', ...(promoCode === undefined ? {} : { promoCode }) },
      { strictPromo: false, identity: { email: 'buyer@example.com' } },
    );
  }

  function intent(
    lines: { variantId: number; qty: number }[],
    expectedTotalCents: number,
    extra: Partial<CheckoutIntentInput> = {},
  ): CheckoutIntentInput {
    return {
      email: 'buyer@example.com',
      lines,
      shippingAddress: ADDRESS,
      shippingMethod: 'standard',
      marketingOptIn: false,
      provider: 'stripe',
      expectedTotalCents,
      ...extra,
    };
  }

  it('writes an order whose totals are the quote’s totals, to the cent', async () => {
    const lines = [{ variantId: fixture.variants.devzira2lb, qty: 2 }];
    const quote = await quoteFor(lines);

    const created = await createPendingOrder(app.db, intent(lines, quote.totalCents), CONTEXT);

    const [row] = await app.db.select().from(orders).where(eq(orders.id, created.id));
    expect(row?.subtotalCents).toBe(quote.subtotalCents);
    expect(row?.discountCents).toBe(quote.discountCents);
    expect(row?.shippingCents).toBe(quote.shippingCents);
    expect(row?.taxCents).toBe(quote.taxCents);
    expect(row?.totalCents).toBe(quote.totalCents);
    // 2 x $12.00 plus $7.99 standard shipping, taxed at 8.25% on the shipping-inclusive base.
    expect(row?.subtotalCents).toBe(2400);
    expect(row?.shippingCents).toBe(799);
    expect(row?.totalCents).toBe(2400 + 799 + row!.taxCents);
  });

  it('leaves the order pending and touches no stock', async () => {
    const lines = [{ variantId: fixture.variants.devzira2lb, qty: 3 }];
    const [before] = await app.db
      .select({ stockQty: productVariants.stockQty })
      .from(productVariants)
      .where(eq(productVariants.id, fixture.variants.devzira2lb));

    const quote = await quoteFor(lines);
    const created = await createPendingOrder(app.db, intent(lines, quote.totalCents), CONTEXT);

    const [row] = await app.db.select().from(orders).where(eq(orders.id, created.id));
    // Only the webhook may move an order past pending, and it is the only place stock moves.
    expect(row?.status).toBe('pending');
    expect(row?.paidAt).toBeNull();

    const [after] = await app.db
      .select({ stockQty: productVariants.stockQty })
      .from(productVariants)
      .where(eq(productVariants.id, fixture.variants.devzira2lb));
    expect(after?.stockQty).toBe(before?.stockQty);
  });

  it('snapshots the line rather than pointing at the product', async () => {
    const lines = [{ variantId: fixture.variants.devzira2lb, qty: 2 }];
    const quote = await quoteFor(lines);
    const created = await createPendingOrder(app.db, intent(lines, quote.totalCents), CONTEXT);

    const items = await app.db.select().from(orderItems).where(eq(orderItems.orderId, created.id));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      sku: 'SG-001-2LB',
      weightLabel: '2 lb',
      unitPriceCents: 1200,
      qty: 2,
      lineTotalCents: 2400,
    });
    // The name is copied, not joined: the product may be renamed or deleted and the receipt has
    // to survive both.
    expect(items[0]?.name).toBe('Devzira Red Rice');
    expect(items[0]?.productSlug).toBe('devzira-rice');
  });

  it('allocates the discount across lines so they sum to the order’s discount', async () => {
    // Three lines and a percentage discount: the case where flooring each share loses cents.
    const lines = [
      { variantId: fixture.variants.devzira2lb, qty: 1 },
      { variantId: fixture.variants.redLentils1lb, qty: 1 },
      { variantId: fixture.variants.saffron8oz, qty: 1 },
    ];
    const quote = await quoteFor(lines, 'WELCOME10');
    expect(quote.discountCents).toBeGreaterThan(0);

    const created = await createPendingOrder(
      app.db,
      intent(lines, quote.totalCents, { promoCode: 'WELCOME10' }),
      CONTEXT,
    );

    const items = await app.db.select().from(orderItems).where(eq(orderItems.orderId, created.id));
    const allocated = items.reduce((sum, item) => sum + item.lineDiscountCents, 0);
    expect(allocated).toBe(quote.discountCents);

    const [row] = await app.db.select().from(orders).where(eq(orders.id, created.id));
    expect(row?.promoCode).toBe('WELCOME10');
    expect(row?.promoDiscountCents).toBe(quote.discountCents);
  });

  it('writes both addresses, and copies shipping into billing when none is given', async () => {
    const lines = [{ variantId: fixture.variants.devzira2lb, qty: 1 }];
    const quote = await quoteFor(lines);
    const created = await createPendingOrder(app.db, intent(lines, quote.totalCents), CONTEXT);

    const rows = await app.db.select().from(addresses).where(eq(addresses.orderId, created.id));
    expect(rows.map((row) => row.type).sort()).toEqual(['billing', 'shipping']);
    // The checkbox in the design means "same as shipping"; absent must not mean absent.
    expect(rows.every((row) => row.city === 'Houston' && row.zip === '77057')).toBe(true);
    expect(rows.every((row) => row.line2 === null && row.phone === null)).toBe(true);
  });

  it('keeps a separate billing address when one is given', async () => {
    const lines = [{ variantId: fixture.variants.devzira2lb, qty: 1 }];
    const quote = await quoteFor(lines);
    await createPendingOrder(
      app.db,
      intent(lines, quote.totalCents, {
        billingAddress: { ...ADDRESS, line1: '1200 Smith St', zip: '77002' },
      }),
      CONTEXT,
    );

    const rows = await app.db.select().from(addresses);
    const billing = rows.find((row) => row.type === 'billing');
    const shipping = rows.find((row) => row.type === 'shipping');
    expect(billing?.line1).toBe('1200 Smith St');
    expect(shipping?.line1).toBe('5850 San Felipe St');
  });

  /**
   * The rule that matters most: a total the customer never saw is never charged.
   */
  it('refuses a total that is not the one the customer saw, and hands back the fresh quote', async () => {
    const lines = [{ variantId: fixture.variants.devzira2lb, qty: 2 }];
    const quote = await quoteFor(lines);

    const attempt = createPendingOrder(
      app.db,
      // A cent under. Any difference is the same failure.
      intent(lines, quote.totalCents - 1),
      CONTEXT,
    );

    await expect(attempt).rejects.toBeInstanceOf(TotalMismatchError);
    await attempt.catch((error: unknown) => {
      const mismatch = (error as TotalMismatchError).mismatch;
      expect(mismatch.actualTotalCents).toBe(quote.totalCents);
      expect(mismatch.expectedTotalCents).toBe(quote.totalCents - 1);
      // The page redraws its summary from this rather than asking again.
      expect(mismatch.quote.totalCents).toBe(quote.totalCents);
      expect((error as TotalMismatchError).code).toBe('CART_PRICE_MISMATCH');
      expect((error as TotalMismatchError).statusCode).toBe(409);
    });

    expect(await ordersFor('buyer@example.com')).toHaveLength(0);
  });

  it('refuses a cart the server had to adjust, even if the total happens to match', async () => {
    // The 5 lb variant has five in stock; asking for six is cut back, which is an adjustment.
    const lines = [{ variantId: fixture.variants.devzira5lbLow, qty: 6 }];
    const quote = await quoteFor(lines);
    expect(quote.adjustments).not.toHaveLength(0);

    // Handing over the *adjusted* total, so only the adjustment itself can reject this.
    const attempt = createPendingOrder(app.db, intent(lines, quote.totalCents), CONTEXT);

    await expect(attempt).rejects.toBeInstanceOf(TotalMismatchError);
    expect(await ordersFor('buyer@example.com')).toHaveLength(0);
  });

  it('refuses a cart with nothing orderable left in it', async () => {
    const lines = [{ variantId: fixture.variants.devzira10lbOut, qty: 1 }];
    const attempt = createPendingOrder(app.db, intent(lines, 1), CONTEXT);

    await expect(attempt).rejects.toThrow(/nothing in this cart/i);
    expect(await ordersFor('buyer@example.com')).toHaveLength(0);
  });

  it('attaches the order to a customer when the session names one', async () => {
    const lines = [{ variantId: fixture.variants.devzira2lb, qty: 1 }];
    const quote = await quoteFor(lines);
    const created = await createPendingOrder(app.db, intent(lines, quote.totalCents), {
      ...CONTEXT,
      customerId: fixture.returningCustomer.id,
    });

    const [row] = await app.db.select().from(orders).where(eq(orders.id, created.id));
    expect(row?.customerId).toBe(fixture.returningCustomer.id);
  });

  it('numbers consecutive orders in sequence', async () => {
    const lines = [{ variantId: fixture.variants.devzira2lb, qty: 1 }];
    const quote = await quoteFor(lines);

    const first = await createPendingOrder(app.db, intent(lines, quote.totalCents), CONTEXT);
    const second = await createPendingOrder(app.db, intent(lines, quote.totalCents), CONTEXT);

    expect(first.orderNumber).toMatch(/^SG-\d{4}-\d{5}$/);
    const sequence = (value: string) => Number(value.slice(-5));
    expect(sequence(second.orderNumber)).toBe(sequence(first.orderNumber) + 1);
  });

  it('keeps the customer’s note and drops nothing else into it', async () => {
    const lines = [{ variantId: fixture.variants.devzira2lb, qty: 1 }];
    const quote = await quoteFor(lines);
    const created = await createPendingOrder(
      app.db,
      intent(lines, quote.totalCents, { customerNote: 'Leave with the neighbour, please.' }),
      CONTEXT,
    );

    const [row] = await app.db.select().from(orders).where(eq(orders.id, created.id));
    expect(row?.customerNote).toBe('Leave with the neighbour, please.');
    // Where staff write "customer sounds difficult". Checkout must never populate it.
    expect(row?.adminNote).toBeNull();
  });
});
