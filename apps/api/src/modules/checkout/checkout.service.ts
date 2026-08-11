import {
  type AddressInput,
  type CartQuote,
  type CheckoutIntentInput,
  type CheckoutTotalMismatch,
  Money,
} from '@silkgrain/contracts';

import type { Database } from '../../db/client';
import { addresses, orderItems, orders } from '../../db/schema';
import { AppError } from '../../lib/errors';
import { quoteCart } from '../cart/cart.service';
import { withOrderNumber } from '../orders/order-number';

/**
 * Writing the order a payment will be taken against.
 *
 * This is everything `POST /api/checkout/intent` does except talk to Stripe, and it is separate
 * from the route for exactly that reason: the money arithmetic, the order row and the address
 * snapshots are all testable today, while `stripe.paymentIntents.create` needs a key nobody has
 * yet (decision D-27). When the key arrives, the route is this function plus one SDK call.
 *
 * Three rules from `CLAUDE.md` meet here, and all three are load-bearing:
 *
 * - **The client never sends a price.** The body carries variant ids and quantities; every figure
 *   written below comes from `quoteCart`, the same function `POST /api/cart/validate` runs.
 * - **A stale total is a 409, never a silent charge.** `expectedTotalCents` is what the customer
 *   had on screen. If the recomputation disagrees, they see the new quote and press again.
 * - **Stock is not touched here.** It moves inside the transaction that marks the order `paid`,
 *   in the webhook, and nowhere else - so an abandoned checkout reserves nothing.
 */

export interface CheckoutContext {
  /** Set when a session was presented; a guest checkout leaves it null. */
  customerId: number | null;
  orderNumberPrefix: string;
  now?: Date;
}

export interface PendingOrder {
  id: number;
  orderNumber: string;
  quote: CartQuote;
}

/**
 * Raised when the recomputed total is not the total the customer saw.
 *
 * Carries the fresh quote, so the checkout page redraws its summary rather than asking again.
 */
export class TotalMismatchError extends AppError {
  readonly mismatch: CheckoutTotalMismatch;

  constructor(mismatch: CheckoutTotalMismatch) {
    // `CART_PRICE_MISMATCH` was reserved for this and nothing else ever used it. Its status is
    // 409 rather than 422 for the reason spelled out beside it in `errors.ts`.
    super('CART_PRICE_MISMATCH', 'The total has changed since you last saw it', {
      details: mismatch,
    });
    this.mismatch = mismatch;
  }
}

export async function createPendingOrder(
  db: Database,
  input: CheckoutIntentInput,
  context: CheckoutContext,
): Promise<PendingOrder> {
  const now = context.now ?? new Date();

  /**
   * `strictPromo: false`, deliberately.
   *
   * A code that expired between the cart and this button should not fail the checkout with a
   * promo error - it should change the total, which the mismatch below turns into a 409 carrying
   * the new figures. The customer sees why the number moved and decides. Decision D-23 draws the
   * same line for `/cart/validate`.
   */
  const quote = await quoteCart(
    db,
    {
      lines: input.lines,
      shippingMethod: input.shippingMethod,
      ...(input.promoCode === undefined ? {} : { promoCode: input.promoCode }),
    },
    {
      strictPromo: false,
      // `PromoIdentity` omits what it does not know rather than carrying nulls: a guest has no
      // customer id, and `exactOptionalPropertyTypes` makes the difference a type error.
      identity: {
        email: input.email,
        ...(context.customerId === null ? {} : { customerId: context.customerId }),
      },
    },
  );

  if (quote.lines.length === 0) {
    // Everything in the cart went away while it sat in `localStorage`. There is no order to
    // write, and a zero-total PaymentIntent would be a stranger failure later.
    throw new AppError('CART_ITEM_UNAVAILABLE', 'Nothing in this cart can be ordered', {
      details: { adjustments: quote.adjustments },
    });
  }

  /**
   * Any adjustment means the cart the customer pressed the button on is not the cart being
   * priced: a line was dropped or a quantity cut. The total will almost always differ too, but
   * "almost always" is not a guarantee - two changes can cancel out - so the adjustment itself is
   * grounds for the 409 rather than only the number.
   */
  if (quote.adjustments.length > 0 || quote.totalCents !== input.expectedTotalCents) {
    throw new TotalMismatchError({
      expectedTotalCents: input.expectedTotalCents,
      actualTotalCents: quote.totalCents,
      quote,
    });
  }

  const shipping = input.shippingAddress;
  // Absent means "same as shipping", which is what the checkbox in the design does.
  const billing = input.billingAddress ?? shipping;

  const lineDiscounts = allocateDiscount(quote);

  const created = await db.transaction((tx) =>
    withOrderNumber(tx, context.orderNumberPrefix, now, async (orderNumber) => {
      const [row] = await tx
        .insert(orders)
        .values({
          orderNumber,
          email: input.email,
          customerId: context.customerId,
          // Only the webhook may move an order past this (`ORDER_STATUS_TRANSITIONS` has no
          // `pending -> paid`), so writing anything else here would be writing a lie.
          status: 'pending',
          subtotalCents: quote.subtotalCents,
          discountCents: quote.discountCents,
          shippingCents: quote.shippingCents,
          taxCents: quote.taxCents,
          totalCents: quote.totalCents,
          promoCode: quote.promo?.code ?? null,
          promoDiscountCents: quote.discountCents,
          shippingMethod: quote.shippingMethod,
          ...(input.customerNote === undefined ? {} : { customerNote: input.customerNote }),
        })
        .$returningId();
      if (!row) throw new AppError('INTERNAL', 'The order row was not inserted');

      await tx.insert(orderItems).values(
        quote.lines.map((line, index) => ({
          orderId: row.id,
          productId: line.productId,
          variantId: line.variantId,
          // Name, SKU, weight and price are snapshots. A price change next month must not
          // rewrite what this customer was charged, and the product may be deleted while the
          // receipt for it has to survive.
          productSlug: line.productSlug,
          name: line.name,
          sku: line.sku,
          weightLabel: line.weightLabel,
          imageUrl: line.image?.url ?? null,
          unitPriceCents: line.unitPriceCents,
          qty: line.qty,
          lineTotalCents: line.lineTotalCents,
          lineDiscountCents: lineDiscounts[index] ?? 0,
        })),
      );

      await tx.insert(addresses).values([
        { orderId: row.id, type: 'shipping' as const, ...addressValues(shipping) },
        { orderId: row.id, type: 'billing' as const, ...addressValues(billing) },
      ]);

      return { id: row.id, orderNumber };
    }),
  );

  return { ...created, quote };
}

/**
 * Spreads the order discount across the lines so the parts add back up to the whole.
 *
 * `Money.allocate` floors each share and hands the leftover cents out one at a time, which is
 * what makes the sum exact. Without it the missing cent surfaces later as a reconciliation
 * failure against the payment provider - the discount on the order would not equal the discount
 * on its lines, and one of the two would be wrong.
 */
function allocateDiscount(quote: CartQuote): number[] {
  if (quote.discountCents === 0) return quote.lines.map(() => 0);

  const shares = Money.fromCents(quote.discountCents).allocate(
    quote.lines.map((line) => line.lineTotalCents),
  );
  return shares.map((share) => share.cents);
}

type AddressColumns = Omit<typeof addresses.$inferInsert, 'orderId' | 'type'>;

function addressValues(address: AddressInput): AddressColumns {
  return {
    firstName: address.firstName,
    lastName: address.lastName,
    line1: address.line1,
    line2: address.line2 ?? null,
    city: address.city,
    state: address.state,
    zip: address.zip,
    country: address.country,
    phone: address.phone ?? null,
  };
}
