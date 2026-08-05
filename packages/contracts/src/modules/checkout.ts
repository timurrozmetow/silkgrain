import { z } from 'zod';

import { PaymentProvider, ShippingMethod } from '../enums';
import { Cents, Email } from '../primitives';

import { CART_MAX_LINES, CartLineInput, CartQuote, PromoCodeInput } from './cart';
import { AddressInput, OrderNumber } from './order';

/**
 * Placing an order.
 *
 * The body carries the same cart the storefront has been repricing all along - variant ids and
 * quantities - plus who and where. It states no prices, exactly as `POST /api/cart/validate`
 * states none: the server recomputes the whole quote here, from the same code, and the order
 * it writes is built from that recomputation rather than from anything the client sent.
 *
 * `expectedTotalCents` is the one number that comes back from the client, and it is not used
 * as an amount. It is what the customer had on screen when they pressed the button; if the
 * recomputed total differs, the answer is a 409 carrying the new quote, so they see the change
 * and press again. A silently different charge is the one outcome that is never acceptable.
 */
export const CheckoutIntentInput = z
  .object({
    email: Email,
    lines: z.array(CartLineInput).min(1).max(CART_MAX_LINES),
    shippingAddress: AddressInput,
    /** Absent means "same as shipping", which is what the checkbox in the design does. */
    billingAddress: AddressInput.optional(),
    shippingMethod: ShippingMethod,
    promoCode: PromoCodeInput.optional(),
    customerNote: z.string().trim().max(1000).optional(),
    marketingOptIn: z.boolean().default(false),
    provider: PaymentProvider,
    expectedTotalCents: Cents,
  })
  .strict();
export type CheckoutIntentInput = z.infer<typeof CheckoutIntentInput>;

/**
 * What the client needs to hand over to the payment provider's own SDK.
 *
 * A discriminated union rather than a bag of optional fields, so the front end cannot reach
 * for a Stripe client secret on a PayPal order and get `undefined` at the worst moment.
 */
export const PaymentHandoff = z.discriminatedUnion('provider', [
  z.object({
    provider: z.literal('stripe'),
    clientSecret: z.string(),
    publishableKey: z.string(),
  }),
  z.object({
    provider: z.literal('paypal'),
    paypalOrderId: z.string(),
  }),
]);
export type PaymentHandoff = z.infer<typeof PaymentHandoff>;

export const CheckoutIntentResult = z.object({
  orderNumber: OrderNumber,
  /** The quote the order was written from, so the confirmation screen needs no second call. */
  quote: CartQuote,
  payment: PaymentHandoff,
});
export type CheckoutIntentResult = z.infer<typeof CheckoutIntentResult>;

/**
 * The body of the 409 raised when the recomputed total is not what the customer saw.
 *
 * Carrying the fresh quote rather than only a code: the checkout page has to redraw the
 * summary with the new figures, and making it ask again would show the customer a stale total
 * for one more round trip.
 */
export const CheckoutTotalMismatch = z.object({
  expectedTotalCents: Cents,
  actualTotalCents: Cents,
  quote: CartQuote,
});
export type CheckoutTotalMismatch = z.infer<typeof CheckoutTotalMismatch>;
