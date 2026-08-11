import { z } from 'zod';

import { CART_LINE_MAX_QTY } from '../constants';
import { PromoType, ShippingMethod, StockState } from '../enums';
import { ErrorCode } from '../errors';
import { Cents, Currency, Id, Slug } from '../primitives';

/**
 * The cart lives in the browser (decision D-18); the server's job is to price it.
 *
 * Nothing in this file lets a client state an amount. `CartLineInput` carries a variant and a
 * quantity, the schema is `.strict()`, and every figure in `CartQuote` is computed from
 * `product_variants`, `shipping_rates` and `promo_codes`. That is what makes "the client never
 * sends a price" a property of the type system rather than a rule someone has to remember.
 */

/**
 * `CART_LINE_MAX_QTY` lives in `../constants` because the storefront's cart store needs it and
 * importing it from here would drag Zod into the browser bundle. `CART_MAX_LINES` stays: only
 * the server reads it.
 *
 * Guards the recalculation query - fifty lines is already an implausible retail order.
 */
export const CART_MAX_LINES = 50;

export const CartLineInput = z
  .object({
    variantId: Id,
    qty: z.number().int().min(1).max(CART_LINE_MAX_QTY),
  })
  .strict();
export type CartLineInput = z.infer<typeof CartLineInput>;

/**
 * Promo codes are typed in by hand, so the schema absorbs the usual damage: surrounding
 * spaces and lower case. Everything is stored and compared upper case.
 */
export const PromoCodeInput = z
  .string()
  .trim()
  .toUpperCase()
  .min(3)
  .max(32)
  .regex(/^[A-Z0-9][A-Z0-9_-]*$/, 'Promo codes are letters, digits, hyphens and underscores');

export const CartQuoteInput = z
  .object({
    lines: z.array(CartLineInput).min(1).max(CART_MAX_LINES),
    promoCode: PromoCodeInput.optional(),
    shippingMethod: ShippingMethod.default('standard'),
  })
  .strict();
export type CartQuoteInput = z.infer<typeof CartQuoteInput>;

/** The Apply button next to the promo field. Same body, but the code is required. */
export const CartPromoInput = CartQuoteInput.omit({ promoCode: true })
  .extend({ promoCode: PromoCodeInput })
  .strict();
export type CartPromoInput = z.infer<typeof CartPromoInput>;

export const CartQuoteLine = z.object({
  variantId: Id,
  productId: Id,
  productSlug: Slug,
  name: z.string(),
  categoryName: z.string(),
  weightLabel: z.string(),
  sku: z.string(),
  image: z.object({ url: z.string().url(), alt: z.string() }).nullable(),
  qty: z.number().int().positive(),
  unitPriceCents: Cents,
  /** Set means this line is marked down; the cart shows the struck-through original. */
  compareAtPriceCents: Cents.nullable(),
  lineTotalCents: Cents,
  stockState: StockState,
  /** Capped at the per-line maximum, so the stepper knows where to stop without leaking stock. */
  availableQty: z.number().int().nonnegative(),
});
export type CartQuoteLine = z.infer<typeof CartQuoteLine>;

/**
 * What the server changed without being asked.
 *
 * A cart persisted in `localStorage` in March is presented again in July, by which time a
 * variant may have been retired or sold out. Silently dropping the line would be a customer
 * discovering at the confirmation screen that they did not buy what they thought; these are
 * what the storefront turns into a toast.
 */
export const CART_ADJUSTMENT_REASON = [
  'qty_reduced',
  'removed_unavailable',
  'removed_out_of_stock',
] as const;
export const CartAdjustmentReason = z.enum(CART_ADJUSTMENT_REASON);
export type CartAdjustmentReason = z.infer<typeof CartAdjustmentReason>;

export const CartAdjustment = z.object({
  variantId: Id,
  reason: CartAdjustmentReason,
  /** The name is carried because a removed line is no longer in `lines` to look it up from. */
  name: z.string(),
  weightLabel: z.string(),
  requestedQty: z.number().int().positive(),
  acceptedQty: z.number().int().nonnegative(),
  message: z.string(),
});
export type CartAdjustment = z.infer<typeof CartAdjustment>;

export const AppliedPromo = z.object({
  code: z.string(),
  type: PromoType,
  description: z.string().nullable(),
  discountCents: Cents,
  /** True for a `free_shipping` code, whose saving is the shipping line rather than a discount. */
  coversShipping: z.boolean(),
});
export type AppliedPromo = z.infer<typeof AppliedPromo>;

/**
 * Why a code that was sent could not be used.
 *
 * `POST /api/cart/validate` never fails over a promo code: the cart still has to render, and a
 * code that expired overnight must not turn the whole page into an error state. `POST
 * /api/cart/promo` - the Apply button - throws the matching `PROMO_*` error instead, because
 * there the code is the whole point of the request.
 */
export const RejectedPromo = z.object({
  code: z.string(),
  reason: ErrorCode,
  message: z.string(),
});
export type RejectedPromo = z.infer<typeof RejectedPromo>;

export const ShippingOption = z.object({
  code: ShippingMethod,
  name: z.string(),
  description: z.string().nullable(),
  /** The list price of this method. */
  baseCents: Cents,
  /** What this particular order would pay - zero once the threshold or a promo covers it. */
  priceCents: Cents,
  isFree: z.boolean(),
  estimatedDaysMin: z.number().int().nonnegative(),
  estimatedDaysMax: z.number().int().nonnegative(),
});
export type ShippingOption = z.infer<typeof ShippingOption>;

/**
 * "You're $12.40 away from free shipping".
 *
 * The threshold comes from the shipping rate itself (`shipping_rates.free_above_cents`), not
 * from a setting: the rate row is what the checkout actually charges from, and a second copy
 * of the same number is a second copy that can disagree.
 */
export const FreeShippingProgress = z.object({
  thresholdCents: Cents,
  remainingCents: Cents,
  progressPercent: z.number().min(0).max(100),
  qualified: z.boolean(),
});
export type FreeShippingProgress = z.infer<typeof FreeShippingProgress>;

export const CartQuote = z.object({
  lines: z.array(CartQuoteLine),
  itemCount: z.number().int().nonnegative(),
  subtotalCents: Cents,
  discountCents: Cents,
  shippingCents: Cents,
  /**
   * Decision D-4: an estimate at the default rate, so the cart shows a total rather than a
   * shrug. Stripe Tax recomputes it at checkout once there is an address to tax against.
   */
  taxCents: Cents,
  taxIsEstimated: z.boolean(),
  totalCents: Cents,
  currency: Currency,
  promo: AppliedPromo.nullable(),
  promoRejected: RejectedPromo.nullable(),
  shippingMethod: ShippingMethod,
  shippingOptions: z.array(ShippingOption),
  /** Null when no active method offers free shipping at any threshold. */
  freeShipping: FreeShippingProgress.nullable(),
  adjustments: z.array(CartAdjustment),
});
export type CartQuote = z.infer<typeof CartQuote>;
