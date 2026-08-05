import type { ApiError, CartQuote } from '@silkgrain/contracts';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { settings } from '../../db/schema';
import {
  type CatalogFixture,
  FIXTURE_PASSWORD,
  seedCatalogFixture,
} from '../../test/fixtures/catalog';
import { buildTestApp, freshAddress } from '../../test/harness';

/**
 * Cart recalculation.
 *
 * Every expected figure below is written out rather than computed, and the arithmetic is the
 * arithmetic the seeded orders use: `taxable = subtotal - discount + shipping`, tax at 825
 * basis points on that base, total on top. Texas taxes shipping. If Phase 4 ever writes an
 * order that disagrees with a quote from this file, one of the two is wrong.
 */
describe('cart', () => {
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
  async function post<Body>(
    url: string,
    payload: object,
    accessToken?: string,
  ): Promise<{ status: number; body: Body }> {
    const response = await app.inject({
      method: 'POST',
      url,
      remoteAddress: freshAddress(),
      payload,
      ...(accessToken === undefined ? {} : { headers: { authorization: `Bearer ${accessToken}` } }),
    });
    return { status: response.statusCode, body: response.json<Body>() };
  }

  const validate = (payload: object, token?: string) =>
    post<CartQuote>('/api/cart/validate', payload, token);
  /** The apply route answers with a quote on success and an error body on rejection. */
  const applyPromo = (payload: object, token?: string) =>
    post<CartQuote & ApiError>('/api/cart/promo', payload, token);

  // ------------------------------------------------------------------- recalculation

  it('prices a cart from the database', async () => {
    const { status, body } = await validate({
      lines: [{ variantId: fixture.variants.devzira2lb, qty: 2 }],
    });

    expect(status).toBe(200);
    expect(body.itemCount).toBe(2);
    expect(body.subtotalCents).toBe(2400);
    expect(body.discountCents).toBe(0);
    // Below the $75 threshold, so standard shipping is charged.
    expect(body.shippingCents).toBe(799);
    // 3199 x 825bp = 263.9175, rounded half to even.
    expect(body.taxCents).toBe(264);
    expect(body.taxIsEstimated).toBe(true);
    expect(body.totalCents).toBe(3463);
    expect(body.lines[0]).toMatchObject({
      variantId: fixture.variants.devzira2lb,
      productSlug: 'devzira-rice',
      weightLabel: '2 lb',
      qty: 2,
      unitPriceCents: 1200,
      lineTotalCents: 2400,
      stockState: 'in',
      availableQty: 50,
    });
    expect(body.shippingOptions).toHaveLength(3);
  });

  /**
   * The acceptance criterion for this phase.
   *
   * There is no comparison between a submitted price and a stored one, because the schema has
   * nowhere to submit a price. `CartLineInput` is `.strict()` with two fields, so the extra key
   * is rejected by validation before any handler runs.
   */
  it('refuses a request that tries to state a price', async () => {
    const { status, body } = await post<ApiError>('/api/cart/validate', {
      lines: [{ variantId: fixture.variants.devzira2lb, qty: 1, unitPriceCents: 1 }],
    });

    expect(status).toBe(422);
    expect(body.error.code).toBe('VALIDATION_FAILED');
  });

  it('refuses a forged total on the quote itself', async () => {
    const { status } = await post('/api/cart/validate', {
      lines: [{ variantId: fixture.variants.devzira2lb, qty: 1 }],
      totalCents: 1,
    });
    expect(status).toBe(422);
  });

  it('reports the free-shipping progress and stops charging past the threshold', async () => {
    const under = await validate({ lines: [{ variantId: fixture.variants.devzira2lb, qty: 2 }] });
    expect(under.body.freeShipping).toEqual({
      thresholdCents: 7500,
      remainingCents: 5100,
      progressPercent: 32,
      qualified: false,
    });

    const over = await validate({ lines: [{ variantId: fixture.variants.saffron8oz, qty: 1 }] });
    expect(over.body.subtotalCents).toBe(9900);
    expect(over.body.shippingCents).toBe(0);
    expect(over.body.freeShipping).toEqual({
      thresholdCents: 7500,
      remainingCents: 0,
      progressPercent: 100,
      qualified: true,
    });
    expect(over.body.taxCents).toBe(817);
    expect(over.body.totalCents).toBe(10_717);
  });

  it('does not give express shipping away at the standard threshold', async () => {
    const { body } = await validate({
      lines: [{ variantId: fixture.variants.saffron8oz, qty: 1 }],
      shippingMethod: 'express',
    });

    expect(body.shippingMethod).toBe('express');
    expect(body.shippingCents).toBe(1299);
    expect(body.taxCents).toBe(924);
    expect(body.totalCents).toBe(12_123);
  });

  // ---------------------------------------------------------------------- adjustments

  it('drops a variant that is out of stock', async () => {
    const { body } = await validate({
      lines: [{ variantId: fixture.variants.devzira10lbOut, qty: 1 }],
    });

    expect(body.lines).toHaveLength(0);
    expect(body.adjustments[0]).toMatchObject({
      variantId: fixture.variants.devzira10lbOut,
      reason: 'removed_out_of_stock',
      requestedQty: 1,
      acceptedQty: 0,
    });
    // Nothing left to ship, so nothing is charged for shipping it.
    expect(body.subtotalCents).toBe(0);
    expect(body.shippingCents).toBe(0);
    expect(body.taxCents).toBe(0);
    expect(body.totalCents).toBe(0);
  });

  /**
   * A draft product's variant is active and in stock. Only the product's status keeps it out
   * of the catalogue, and nothing but this test proves the cart consults it.
   */
  it('will not price a variant belonging to an unpublished product', async () => {
    const { body } = await validate({
      lines: [{ variantId: fixture.variants.draftVariant, qty: 1 }],
    });

    expect(body.lines).toHaveLength(0);
    expect(body.adjustments[0]?.reason).toBe('removed_unavailable');
    expect(body.subtotalCents).toBe(0);
  });

  it('drops a variant that has been switched off, and one that never existed', async () => {
    const retired = await validate({
      lines: [{ variantId: fixture.variants.retiredVariant, qty: 1 }],
    });
    expect(retired.body.adjustments[0]?.reason).toBe('removed_unavailable');

    const unknown = await validate({ lines: [{ variantId: 987_654_321, qty: 1 }] });
    expect(unknown.body.adjustments[0]?.reason).toBe('removed_unavailable');
    expect(unknown.body.lines).toHaveLength(0);
  });

  it('clamps a quantity to what is actually in stock', async () => {
    const { body } = await validate({
      lines: [{ variantId: fixture.variants.devzira5lbLow, qty: 10 }],
    });

    expect(body.lines[0]?.qty).toBe(5);
    expect(body.lines[0]?.stockState).toBe('low');
    // Everything the cart row draws, from a marked-down variant that is actually buyable.
    expect(body.lines[0]?.compareAtPriceCents).toBe(3000);
    expect(body.lines[0]?.sku).toBe('SG-001-5LB');
    expect(body.lines[0]?.categoryName).toBe('Rice & Grains');
    expect(body.lines[0]?.image).toEqual({
      url: 'https://images.example.com/devzira-rice.jpg',
      alt: 'devzira-rice photograph',
    });
    expect(body.adjustments[0]).toMatchObject({
      reason: 'qty_reduced',
      requestedQty: 10,
      acceptedQty: 5,
    });
    expect(body.subtotalCents).toBe(12_500);
    // Past the threshold once clamped, so shipping is free and only the goods are taxed.
    expect(body.shippingCents).toBe(0);
    expect(body.taxCents).toBe(1031);
    expect(body.totalCents).toBe(13_531);
  });

  it('merges the same variant sent twice', async () => {
    const { body } = await validate({
      lines: [
        { variantId: fixture.variants.devzira2lb, qty: 1 },
        { variantId: fixture.variants.devzira2lb, qty: 2 },
      ],
    });

    expect(body.lines).toHaveLength(1);
    expect(body.lines[0]?.qty).toBe(3);
    expect(body.subtotalCents).toBe(3600);
  });

  it('keeps the customer’s line order', async () => {
    const { body } = await validate({
      lines: [
        { variantId: fixture.variants.saffron8oz, qty: 1 },
        { variantId: fixture.variants.devzira2lb, qty: 1 },
        { variantId: fixture.variants.redLentils1lb, qty: 1 },
      ],
    });

    expect(body.lines.map((line) => line.productSlug)).toEqual([
      'samarkand-saffron',
      'devzira-rice',
      'red-lentils',
    ]);
  });

  it('rejects a cart that is empty or absurd before it reaches the database', async () => {
    expect((await post('/api/cart/validate', { lines: [] })).status).toBe(422);
    expect(
      (
        await post('/api/cart/validate', {
          lines: [{ variantId: fixture.variants.devzira2lb, qty: 0 }],
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await post('/api/cart/validate', {
          lines: [{ variantId: fixture.variants.devzira2lb, qty: 100 }],
        })
      ).status,
    ).toBe(422);
  });

  it('rejects a shipping method that is not one of the three', async () => {
    const { status } = await post('/api/cart/validate', {
      lines: [{ variantId: fixture.variants.devzira2lb, qty: 1 }],
      shippingMethod: 'teleport',
    });
    expect(status).toBe(422);
  });

  // ----------------------------------------------------------------------- promo codes

  function exactlyThreeThousand() {
    // 2 x $12.00 plus 1 x $6.00. WELCOME10's minimum is exactly $30.00, so this is the boundary.
    return [
      { variantId: fixture.variants.devzira2lb, qty: 2 },
      { variantId: fixture.variants.redLentils1lb, qty: 1 },
    ];
  }

  it('applies a percentage code at the minimum-order boundary', async () => {
    const { status, body } = await applyPromo({
      lines: exactlyThreeThousand(),
      promoCode: 'welcome10',
    });

    expect(status).toBe(200);
    expect(body.subtotalCents).toBe(3000);
    expect(body.promo).toMatchObject({ code: 'WELCOME10', type: 'percent', discountCents: 300 });
    expect(body.discountCents).toBe(300);
    expect(body.shippingCents).toBe(799);
    // 3000 - 300 + 799 = 3499, x 825bp = 288.6675.
    expect(body.taxCents).toBe(289);
    expect(body.totalCents).toBe(3788);
  });

  it('rejects the same code below the minimum', async () => {
    // $24.00 against a $30.00 minimum.
    const { status, body } = await applyPromo({
      lines: [{ variantId: fixture.variants.devzira2lb, qty: 2 }],
      promoCode: 'WELCOME10',
    });
    expect(status).toBe(422);
    expect(body.error.code).toBe('PROMO_MIN_ORDER_NOT_MET');
  });

  it('caps a percentage code at its maximum discount', async () => {
    // 50 % of $24.00 is $12.00, but the code is capped at $5.00.
    const { body } = await applyPromo({
      lines: [{ variantId: fixture.variants.devzira2lb, qty: 2 }],
      promoCode: 'CAP5',
    });
    expect(body.discountCents).toBe(500);
  });

  it('clamps a fixed discount to the subtotal instead of paying the customer', async () => {
    const { body } = await applyPromo({
      lines: [{ variantId: fixture.variants.redLentils1lb, qty: 1 }],
      promoCode: 'FLAT50',
    });

    expect(body.subtotalCents).toBe(600);
    expect(body.discountCents).toBe(600);
    expect(body.shippingCents).toBe(799);
    expect(body.taxCents).toBe(66);
    expect(body.totalCents).toBe(865);
  });

  it('lets a free-shipping code cover the postage without discounting the goods', async () => {
    const { body } = await applyPromo({
      lines: [{ variantId: fixture.variants.redLentils1lb, qty: 1 }],
      promoCode: 'SHIPFREE',
    });

    expect(body.discountCents).toBe(0);
    expect(body.promo?.coversShipping).toBe(true);
    expect(body.shippingCents).toBe(0);
    expect(body.taxCents).toBe(50);
    expect(body.totalCents).toBe(650);
    // The bar must not read "you're $69 away from free shipping" beside a zero postage line.
    expect(body.freeShipping).toEqual({
      thresholdCents: 7500,
      remainingCents: 0,
      progressPercent: 100,
      qualified: true,
    });
  });

  /**
   * The one interaction that decides whether `quoteShipping` is given the subtotal or the
   * subtotal after the discount. Without it, passing the wrong one is invisible.
   */
  it('takes free shipping away when a discount drops the order below the threshold', async () => {
    const { body } = await applyPromo({
      lines: [{ variantId: fixture.variants.saffron8oz, qty: 1 }],
      promoCode: 'FLAT50',
    });

    expect(body.subtotalCents).toBe(9900);
    expect(body.discountCents).toBe(5000);
    // $49.00 left, against a $75.00 threshold.
    expect(body.shippingCents).toBe(799);
    expect(body.freeShipping?.qualified).toBe(false);
    expect(body.freeShipping?.remainingCents).toBe(2600);
    // 9900 - 5000 + 799 = 5699, x 825bp = 470.1675.
    expect(body.taxCents).toBe(470);
    expect(body.totalCents).toBe(6169);
  });

  /**
   * The fixture's rate happens to equal the constant `settings.ts` falls back to, so without
   * moving it nothing distinguishes "read from the database" from "hard-coded".
   */
  it('takes the tax rate from settings rather than the fallback constant', async () => {
    await app.db
      .update(settings)
      .set({ value: 1000 })
      .where(eq(settings.key, 'commerce.default_tax_basis_points'));
    try {
      const { body } = await validate({
        lines: [{ variantId: fixture.variants.devzira2lb, qty: 2 }],
      });
      // 2400 + 799 = 3199, now at 10 % rather than 8.25 %.
      expect(body.taxCents).toBe(320);
      expect(body.totalCents).toBe(3519);
    } finally {
      await app.db
        .update(settings)
        .set({ value: 825 })
        .where(eq(settings.key, 'commerce.default_tax_basis_points'));
    }
  });

  it.each([
    ['EXPIRED10', 'PROMO_EXPIRED'],
    ['FUTURE10', 'PROMO_EXPIRED'],
    ['USEDUP', 'PROMO_USAGE_LIMIT_REACHED'],
    ['SWITCHEDOFF', 'PROMO_INVALID'],
    ['NOSUCHTHING', 'PROMO_INVALID'],
  ])('rejects %s with %s', async (code, expected) => {
    const { status, body } = await applyPromo({
      lines: exactlyThreeThousand(),
      promoCode: code,
    });

    expect(status).toBe(422);
    expect(body.error.code).toBe(expected);
  });

  /**
   * The difference between the two routes. A cart page that failed because a code expired
   * overnight would strand the customer with no way to see their own items.
   */
  it('still prices the cart when validate is given a code it cannot use', async () => {
    const { status, body } = await validate({
      lines: exactlyThreeThousand(),
      promoCode: 'EXPIRED10',
    });

    expect(status).toBe(200);
    expect(body.promo).toBeNull();
    expect(body.promoRejected).toMatchObject({ code: 'EXPIRED10', reason: 'PROMO_EXPIRED' });
    expect(body.subtotalCents).toBe(3000);
    expect(body.discountCents).toBe(0);
  });

  it('enforces the per-customer limit once it knows who is asking', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      remoteAddress: freshAddress(),
      payload: { email: fixture.returningCustomer.email, password: FIXTURE_PASSWORD },
    });
    expect(login.statusCode).toBe(200);
    const { accessToken } = login.json<{ accessToken: string }>();

    // This customer already redeemed WELCOME10 on a past order.
    const asCustomer = await applyPromo(
      { lines: exactlyThreeThousand(), promoCode: 'WELCOME10' },
      accessToken,
    );
    expect(asCustomer.status).toBe(422);
    expect(asCustomer.body.error.code).toBe('PROMO_USAGE_LIMIT_REACHED');

    // A guest presenting the same cart is a different person as far as the code is concerned.
    const asGuest = await applyPromo({ lines: exactlyThreeThousand(), promoCode: 'WELCOME10' });
    expect(asGuest.status).toBe(200);
    expect(asGuest.body.discountCents).toBe(300);
  });

  it('ignores an expired access token instead of rejecting the cart', async () => {
    const { status, body } = await validate(
      { lines: [{ variantId: fixture.variants.devzira2lb, qty: 1 }] },
      'not-a-token',
    );

    expect(status).toBe(200);
    expect(body.subtotalCents).toBe(1200);
  });

  it('requires a promo code on the apply route', async () => {
    const { status } = await post('/api/cart/promo', { lines: exactlyThreeThousand() });
    expect(status).toBe(422);
  });
});
