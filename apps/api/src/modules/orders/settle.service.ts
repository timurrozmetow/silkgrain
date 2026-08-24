import type { PaymentProvider } from '@silkgrain/contracts';
import { and, eq, gte, sql } from 'drizzle-orm';

import type { Database, DbExecutor } from '../../db/client';
import {
  inventoryMovements,
  orderItems,
  orders,
  payments,
  productVariants,
  products,
  promoCodes,
  promoRedemptions,
} from '../../db/schema';
import { AppError, conflict, notFound } from '../../lib/errors';

/**
 * Moving an order to `paid`.
 *
 * This is the only place stock is decremented, and it happens in the same transaction that
 * changes the status - so an order cannot be paid without the units leaving, and units cannot
 * leave without the order being paid. It is reached from the payment webhook and from nowhere
 * else: the redirect back from the provider only displays a result, and a customer who closes
 * the tab must end up in exactly the same state as one who does not.
 *
 * The decrement is a guarded `UPDATE ... WHERE stock_qty >= qty` rather than a read followed
 * by a write, so two orders for the last bag cannot both see one in stock. The CHECK on the
 * column is the backstop for a future code path that forgets.
 */

export interface SettlementInput {
  provider: PaymentProvider;
  /** Stripe PaymentIntent id or PayPal order id, unique per provider. */
  providerPaymentId: string;
  amountCents: number;
  currency: string;
  cardBrand?: string | null;
  cardLast4?: string | null;
  rawPayload?: unknown;
}

export interface SettlementOutcome {
  orderNumber: string;
  /** False when the order was already paid, which is the normal answer to a redelivery. */
  changed: boolean;
}

export async function markOrderPaid(
  db: Database,
  orderId: number,
  input: SettlementInput,
): Promise<SettlementOutcome> {
  return db.transaction(async (tx) => {
    // `FOR UPDATE` rather than a plain read: two deliveries of the same event can arrive at
    // once, and the second must wait for the first to finish rather than read `pending` and
    // decrement the stock a second time.
    const [order] = await tx
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        status: orders.status,
        email: orders.email,
        customerId: orders.customerId,
        totalCents: orders.totalCents,
        currency: orders.currency,
        promoCode: orders.promoCode,
        promoDiscountCents: orders.promoDiscountCents,
      })
      .from(orders)
      .where(eq(orders.id, orderId))
      .for('update');

    if (!order) throw notFound('Order');

    // Redelivery. Stripe repeats an event until it is acknowledged, so this is expected
    // traffic rather than an error, and the answer is the same 200 the first delivery got.
    if (order.status !== 'pending') {
      if (order.status === 'paid' || order.status === 'processing') {
        return { orderNumber: order.orderNumber, changed: false };
      }
      // Paying a cancelled or refunded order is a real problem: the money moved and the
      // order says it should not have. It needs a person, not a retry.
      throw conflict(`Order ${order.orderNumber} is ${order.status} and cannot be paid`);
    }

    if (input.amountCents !== order.totalCents) {
      throw new AppError(
        'PAYMENT_AMOUNT_MISMATCH',
        `Order ${order.orderNumber} is ${String(order.totalCents)} cents but ` +
          `${String(input.amountCents)} was captured`,
      );
    }

    const lines = await tx
      .select({
        variantId: orderItems.variantId,
        productId: orderItems.productId,
        sku: orderItems.sku,
        qty: orderItems.qty,
      })
      .from(orderItems)
      .where(eq(orderItems.orderId, order.id));

    await decrementStock(tx, order.id, lines);
    await recordPayment(tx, order.id, input);
    await recordPromoRedemption(tx, order);

    const paidAt = new Date();
    await tx.update(orders).set({ status: 'paid', paidAt }).where(eq(orders.id, order.id));

    return { orderNumber: order.orderNumber, changed: true };
  });
}

interface SettlementLine {
  variantId: number | null;
  productId: number | null;
  sku: string;
  qty: number;
}

async function decrementStock(
  tx: DbExecutor,
  orderId: number,
  lines: readonly SettlementLine[],
): Promise<void> {
  for (const line of lines) {
    // A variant deleted between the order and the payment leaves nothing to decrement. The
    // snapshot still describes what was sold, and the movement ledger would have nowhere to
    // point, so the line is skipped rather than failing a payment that already went through.
    if (line.variantId === null) continue;

    const result = await tx
      .update(productVariants)
      .set({ stockQty: sql`${productVariants.stockQty} - ${line.qty}` })
      .where(and(eq(productVariants.id, line.variantId), gte(productVariants.stockQty, line.qty)));

    if (result[0].affectedRows === 0) {
      // Rolling the whole transaction back leaves the order `pending` and the webhook
      // recorded as failed, which is the state that gets a human involved. Clamping the stock
      // at zero instead would hide the fact that the shop owes somebody a bag of rice.
      throw new AppError(
        'INSUFFICIENT_STOCK',
        `Not enough stock to fulfil ${line.sku} on order ${String(orderId)}`,
      );
    }

    await tx.insert(inventoryMovements).values({
      variantId: line.variantId,
      delta: -line.qty,
      reason: 'order',
      referenceId: orderId,
      note: `Order ${String(orderId)}`,
    });

    if (line.productId !== null) {
      // Drives the bestselling sort in the catalogue. Maintained here because this is the
      // moment a unit is actually sold, rather than added to a cart or reserved.
      await tx
        .update(products)
        .set({ soldCount: sql`${products.soldCount} + ${line.qty}` })
        .where(eq(products.id, line.productId));
    }
  }
}

async function recordPayment(
  tx: DbExecutor,
  orderId: number,
  input: SettlementInput,
): Promise<void> {
  await tx
    .insert(payments)
    .values({
      orderId,
      provider: input.provider,
      providerPaymentId: input.providerPaymentId,
      status: 'succeeded',
      amountCents: input.amountCents,
      currency: input.currency,
      cardBrand: input.cardBrand ?? null,
      cardLast4: input.cardLast4 ?? null,
      rawPayload: input.rawPayload ?? null,
    })
    // The intent was recorded when checkout created it, so the row usually exists already and
    // this is the moment it stops being `requires_payment`.
    .onDuplicateKeyUpdate({
      set: {
        status: 'succeeded',
        amountCents: input.amountCents,
        cardBrand: input.cardBrand ?? null,
        cardLast4: input.cardLast4 ?? null,
        rawPayload: input.rawPayload ?? null,
      },
    });
}

/**
 * The promo code's accounting: it writes the redemption row and the counter every other check
 * reads from.
 *
 * **It does not enforce the limits, and the previous version of this comment said it did.**
 * `POST /api/cart/promo` compares against `usageLimit` and `usageLimitPerCustomer` when it happens
 * to know who is asking, but it cannot enforce them - nothing stops a customer repricing a cart a
 * hundred times - and this function locks the promo row, inserts and increments without comparing
 * against either. So N concurrent checkouts on a `usageLimit: 1` code would all settle.
 *
 * Unreachable today: `POST /api/checkout/intent` does not exist, for want of a Stripe key (D-27),
 * so nothing outside the tests reaches `createPendingOrder`. It stops being unreachable the moment
 * that route lands, which is why it is written down here and in `QUESTIONS.md` as Q-48 rather than
 * fixed in passing during a security pass: settle time is the wrong place for the check anyway.
 * The money has already moved by then, and refusing it would leave a paid customer with no order.
 * The comparison belongs in the transaction that writes the order, and putting it there is part of
 * building the checkout, not part of hardening what exists.
 */
async function recordPromoRedemption(
  tx: DbExecutor,
  order: {
    id: number;
    email: string;
    customerId: number | null;
    promoCode: string | null;
    promoDiscountCents: number;
  },
): Promise<void> {
  if (order.promoCode === null) return;

  const [promo] = await tx
    .select({ id: promoCodes.id })
    .from(promoCodes)
    .where(eq(promoCodes.code, order.promoCode))
    .for('update');

  // A code deleted between checkout and payment. The discount was already applied to the
  // order, and refusing the payment over a missing campaign row would be absurd.
  if (!promo) return;

  await tx.insert(promoRedemptions).values({
    promoCodeId: promo.id,
    orderId: order.id,
    customerId: order.customerId,
    email: order.email,
    discountCents: order.promoDiscountCents,
  });

  await tx
    .update(promoCodes)
    .set({ usedCount: sql`${promoCodes.usedCount} + 1` })
    .where(eq(promoCodes.id, promo.id));
}

/**
 * A refund reported by the provider.
 *
 * Stock is deliberately not returned. A refund says money went back, not that the goods did;
 * restocking a bag of rice that is sitting in a customer's kitchen would put stock on the
 * shelf that does not exist. A genuine return is a separate movement with reason `return`,
 * entered when the parcel arrives, and that is Phase 7's job.
 */
export async function markOrderRefunded(
  db: Database,
  orderId: number,
  input: { providerPaymentId: string; refundedCents: number; rawPayload?: unknown },
): Promise<SettlementOutcome> {
  return db.transaction(async (tx) => {
    const [order] = await tx
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        status: orders.status,
        totalCents: orders.totalCents,
      })
      .from(orders)
      .where(eq(orders.id, orderId))
      .for('update');

    if (!order) throw notFound('Order');
    if (order.status === 'refunded') return { orderNumber: order.orderNumber, changed: false };

    await tx
      .update(payments)
      .set({
        refundedCents: input.refundedCents,
        status: input.refundedCents >= order.totalCents ? 'refunded' : 'partially_refunded',
        ...(input.rawPayload === undefined ? {} : { rawPayload: input.rawPayload }),
      })
      .where(eq(payments.providerPaymentId, input.providerPaymentId));

    // A partial refund leaves the order where it was: it is still a real order that shipped,
    // and marking it `refunded` would take it out of every fulfilment view it belongs in.
    if (input.refundedCents >= order.totalCents) {
      await tx
        .update(orders)
        .set({ status: 'refunded', refundedAt: new Date() })
        .where(eq(orders.id, order.id));
    }

    return { orderNumber: order.orderNumber, changed: true };
  });
}

/**
 * A payment the provider refused.
 *
 * The order stays `pending` on purpose. The customer is still on the checkout page and may
 * try another card, and an order that flipped to `cancelled` on the first decline would leave
 * them with nothing to pay for.
 */
export async function markPaymentFailed(
  db: Database,
  orderId: number,
  input: SettlementInput & { failureCode?: string | null; failureMessage?: string | null },
): Promise<void> {
  await db
    .insert(payments)
    .values({
      orderId,
      provider: input.provider,
      providerPaymentId: input.providerPaymentId,
      status: 'failed',
      amountCents: input.amountCents,
      currency: input.currency,
      failureCode: input.failureCode ?? null,
      failureMessage: input.failureMessage ?? null,
      rawPayload: input.rawPayload ?? null,
    })
    .onDuplicateKeyUpdate({
      set: {
        status: 'failed',
        failureCode: input.failureCode ?? null,
        failureMessage: input.failureMessage ?? null,
        rawPayload: input.rawPayload ?? null,
      },
    });
}
