import { z } from 'zod';

import { OrderStatus, PaymentProvider, ShippingMethod } from '../enums';
import { Cents, Currency, Email, Id, IsoDate, Phone, Slug, UsState, Zip } from '../primitives';

/**
 * Orders, and the addresses attached to them.
 *
 * An order line is a snapshot, not a join. Name, SKU, weight and unit price are copied at
 * order time and never updated, because a price change next month must not rewrite what the
 * customer was charged - and because the product itself may be deleted while the receipt for
 * it has to survive.
 */

/**
 * A shipping or billing address as the customer types it.
 *
 * US only, and `country` is a literal rather than a two-letter enum so the one place that
 * would have to change to sell abroad is impossible to miss.
 */
export const AddressInput = z
  .object({
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().min(1).max(80),
    line1: z.string().trim().min(1).max(200),
    line2: z.string().trim().max(200).optional(),
    city: z.string().trim().min(1).max(100),
    state: UsState,
    zip: Zip,
    country: z.literal('US'),
    phone: Phone.optional(),
  })
  .strict();
export type AddressInput = z.infer<typeof AddressInput>;

/**
 * The same address coming back out.
 *
 * The optional fields become nullable: the columns are nullable, and an output schema that
 * said `optional` would let a handler omit a key the client then has to test for twice.
 */
export const AddressView = AddressInput.extend({
  line2: z.string().nullable(),
  phone: z.string().nullable(),
});
export type AddressView = z.infer<typeof AddressView>;

/**
 * `SG-2026-00001` - decision D-3, a per-year sequence padded to five digits.
 *
 * The prefix is two to four letters because `ORDER_NUMBER_PREFIX` is configuration; the shape
 * around it is not, since the number appears in emails, on the tracking page and in the admin
 * search, and every one of those parses it.
 */
export const OrderNumber = z
  .string()
  .regex(/^[A-Z]{2,4}-\d{4}-\d{5}$/, 'Order numbers look like SG-2026-00001');
export type OrderNumber = z.infer<typeof OrderNumber>;

export const OrderItemView = z.object({
  /** Null once the product has been deleted. The snapshot beside it still describes it. */
  productId: Id.nullable(),
  variantId: Id.nullable(),
  productSlug: Slug.nullable(),
  name: z.string(),
  sku: z.string(),
  weightLabel: z.string(),
  imageUrl: z.string().url().nullable(),
  unitPriceCents: Cents,
  qty: z.number().int().positive(),
  lineTotalCents: Cents,
  /** This line's share of the order discount, allocated so the lines sum to the total. */
  lineDiscountCents: Cents,
});
export type OrderItemView = z.infer<typeof OrderItemView>;

/**
 * What a customer is shown about their own order.
 *
 * Deliberately not everything the row holds: `adminNote` and the payment provider's raw
 * payload never appear here, and the card is reduced to a brand and four digits.
 */
export const OrderView = z.object({
  orderNumber: OrderNumber,
  status: OrderStatus,
  email: Email,
  items: z.array(OrderItemView).min(1),

  subtotalCents: Cents,
  discountCents: Cents,
  shippingCents: Cents,
  taxCents: Cents,
  totalCents: Cents,
  currency: Currency,

  promoCode: z.string().nullable(),
  shippingMethod: ShippingMethod,
  shippingAddress: AddressView,
  billingAddress: AddressView,

  payment: z
    .object({
      provider: PaymentProvider,
      brand: z.string().nullable(),
      /** The only part of a card this system ever sees, let alone stores. */
      last4: z.string().length(4).nullable(),
    })
    .nullable(),

  tracking: z
    .object({
      carrier: z.string(),
      number: z.string(),
      url: z.string().url().nullable(),
    })
    .nullable(),

  customerNote: z.string().nullable(),

  createdAt: IsoDate,
  paidAt: IsoDate.nullable(),
  shippedAt: IsoDate.nullable(),
  deliveredAt: IsoDate.nullable(),
  cancelledAt: IsoDate.nullable(),
  refundedAt: IsoDate.nullable(),
});
export type OrderView = z.infer<typeof OrderView>;

/** The row an order list draws, without dragging every line item along with it. */
export const OrderSummary = OrderView.pick({
  orderNumber: true,
  status: true,
  totalCents: true,
  currency: true,
  createdAt: true,
  paidAt: true,
  shippedAt: true,
  deliveredAt: true,
}).extend({
  itemCount: z.number().int().nonnegative(),
  /** The first line's photograph, for the thumbnail in the list. */
  imageUrl: z.string().url().nullable(),
});
export type OrderSummary = z.infer<typeof OrderSummary>;

/**
 * Guest access to an order.
 *
 * The email is required as well as the number, because the numbers are sequential: without it,
 * anyone could walk `SG-2026-00001` upwards and read every order the shop has ever taken.
 */
export const OrderLookupQuery = z.object({ email: Email }).strict();
export type OrderLookupQuery = z.infer<typeof OrderLookupQuery>;

export const OrderNumberParams = z.object({ orderNumber: OrderNumber });
export type OrderNumberParams = z.infer<typeof OrderNumberParams>;
