import { z } from 'zod';

import {
  Certification,
  NutritionSource,
  OrderStatus,
  Origin,
  PaymentStatus,
  ProductBadge,
  ProductStatus,
  WeightUnit,
} from '../enums';
import { paginated } from '../pagination';
import { Cents, Currency, Id, IsoDate, Slug } from '../primitives';

import { QueryBoolean } from './catalog';
import { OrderView } from './order';

/**
 * The back office's read models.
 *
 * Separate from the storefront's schemas even where the shapes look similar, because they answer
 * to different rules: a customer is shown what they are allowed to see, an administrator is shown
 * what they need to act on. `OrderSummary` deliberately carries no email; `AdminOrderRow` does.
 */

/**
 * A figure and the same figure a window earlier.
 *
 * `deltaBasisPoints` is null rather than zero when the previous window was empty: a shop's first
 * month of revenue is not "up 0%", and printing a percentage against nothing is how a dashboard
 * starts lying. The client shows a dash.
 */
export const AdminMetric = z.object({
  current: z.number().int().nonnegative(),
  previous: z.number().int().nonnegative(),
  deltaBasisPoints: z.number().int().nullable(),
});
export type AdminMetric = z.infer<typeof AdminMetric>;

/** One day of the revenue chart. `date` is `YYYY-MM-DD` in the shop's own timezone. */
export const AdminRevenuePoint = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  cents: Cents,
});
export type AdminRevenuePoint = z.infer<typeof AdminRevenuePoint>;

/**
 * A variant worth restocking.
 *
 * Out of stock is included and sorts first: it is the most urgent case, and a panel called Low
 * Stock that hid the zeroes would be the wrong way round.
 */
export const AdminLowStockRow = z.object({
  variantId: Id,
  productSlug: Slug,
  productName: z.string(),
  sku: z.string(),
  weightLabel: z.string(),
  stockQty: z.number().int().nonnegative(),
  /** The variant's own threshold, so the bar has something to be a fraction of. */
  lowStockThreshold: z.number().int().nonnegative(),
});
export type AdminLowStockRow = z.infer<typeof AdminLowStockRow>;

/** A row in the admin's order tables. Carries the email, which the customer's view does not. */
export const AdminOrderRow = z.object({
  orderNumber: z.string(),
  email: z.string(),
  /** Null for a guest checkout, which is most of them. */
  customerName: z.string().nullable(),
  status: OrderStatus,
  totalCents: Cents,
  currency: Currency,
  itemCount: z.number().int().nonnegative(),
  createdAt: IsoDate,
});
export type AdminOrderRow = z.infer<typeof AdminOrderRow>;

/**
 * The order list's filters.
 *
 * `q` matches an order number or an email, which is what an operator has in front of them when a
 * customer writes in. `needsFulfilment` is the working queue - paid and processing together, the
 * orders somebody has to do something about - because that is the view a shipping desk lives in and
 * it is two statuses, not one, so a plain status filter cannot express it.
 */
export const AdminOrderListQuery = z
  .object({
    q: z.string().trim().max(120).optional(),
    status: z.union([OrderStatus, z.literal('all')]).default('all'),
    needsFulfilment: QueryBoolean.optional(),
    page: z.coerce.number().int().min(1).default(1),
    perPage: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
export type AdminOrderListQuery = z.infer<typeof AdminOrderListQuery>;

export const AdminOrderListResponse = paginated(AdminOrderRow);
export type AdminOrderListResponse = z.infer<typeof AdminOrderListResponse>;

/**
 * One order, everything the back office acts on.
 *
 * Built by extending the storefront's `OrderView` rather than restating it, so the two cannot
 * describe the same order differently. What the admin adds is what a customer must never see: the
 * internal note, the payment's provider id, and `allowedTransitions` - the statuses this order may
 * move to next, computed on the server from `ORDER_STATUS_TRANSITIONS`.
 *
 * `refunded` never appears in `allowedTransitions`, even though the transition map allows it. A
 * refund is money leaving the account, and it is recorded when the provider says it happened
 * (the `charge.refunded` webhook, already built). An admin button that wrote `refunded` locally
 * would state that a customer had been paid back when nothing had left the account.
 */
export const AdminOrderDetail = OrderView.extend({
  id: Id,
  customerId: Id.nullable(),
  customerName: z.string().nullable(),
  adminNote: z.string().nullable(),
  /** What a person may move this order to now. Empty for a finished order. */
  allowedTransitions: z.array(OrderStatus),
  payment: OrderView.shape.payment
    .unwrap()
    .extend({
      status: PaymentStatus,
      /** The provider's own id, which is what a support conversation with them starts from. */
      providerPaymentId: z.string(),
      amountCents: Cents,
      refundedCents: Cents,
    })
    .nullable(),
  cancelledAt: IsoDate.nullable(),
  refundedAt: IsoDate.nullable(),
  updatedAt: IsoDate,
});
export type AdminOrderDetail = z.infer<typeof AdminOrderDetail>;

/**
 * A status change, with the tracking details that usually accompany one.
 *
 * Carrier and tracking ride along because the moment an operator marks an order shipped is the
 * moment they have the tracking number in hand; making it a second request would mean a customer
 * receiving a "your order shipped" email with nothing to follow. They are optional rather than
 * required - a local hand-delivery has no tracking number, and inventing one to satisfy a form is
 * worse than an order without.
 */
export const AdminOrderStatusInput = z
  .object({
    status: OrderStatus,
    carrier: z.string().trim().min(1).max(60).optional(),
    trackingNumber: z.string().trim().min(1).max(120).optional(),
    trackingUrl: z.string().url().max(500).optional(),
    /** Appended to the internal note, so why an order was cancelled survives the person. */
    note: z.string().trim().max(500).optional(),
  })
  .strict();
export type AdminOrderStatusInput = z.infer<typeof AdminOrderStatusInput>;

/** Tracking details on their own, for the common case of correcting a typo in a number. */
export const AdminTrackingInput = z
  .object({
    carrier: z.string().trim().min(1).max(60).nullable(),
    trackingNumber: z.string().trim().min(1).max(120).nullable(),
    trackingUrl: z.string().url().max(500).nullable(),
  })
  .strict();
export type AdminTrackingInput = z.infer<typeof AdminTrackingInput>;

/** The internal note, replaced wholesale. Never serialised to a storefront response. */
export const AdminOrderNoteInput = z.object({ adminNote: z.string().max(4000) }).strict();
export type AdminOrderNoteInput = z.infer<typeof AdminOrderNoteInput>;

// --------------------------------------------------------------------------------------
// Products
// --------------------------------------------------------------------------------------

/**
 * A row in the admin's product list.
 *
 * Carries what an editor scans for and nothing they would have to open the product to see:
 * whether it is live, how many variants it has, what the cheapest one costs, how much stock is
 * left across all of them, and whether its nutrition panel is real or the seed's reference values.
 */
export const AdminProductRow = z.object({
  id: Id,
  slug: Slug,
  name: z.string(),
  status: ProductStatus,
  categoryName: z.string(),
  imageUrl: z.string().url().nullable(),
  variantCount: z.number().int().nonnegative(),
  /** Null when the product has no active variant, which is how a draft usually starts. */
  priceFromCents: Cents.nullable(),
  stockTotal: z.number().int().nonnegative(),
  isFeatured: z.boolean(),
  /** Absent means no panel at all; otherwise where the figures came from. See decision D-20. */
  nutritionSource: NutritionSource.nullable(),
  updatedAt: IsoDate,
});
export type AdminProductRow = z.infer<typeof AdminProductRow>;

/**
 * The list's filters.
 *
 * `status` accepts `all` rather than being omitted for it, because the default here is not "every
 * status" - an editor opening the list wants the live catalogue first, and a filter that has to be
 * cleared to see drafts is one an editor will forget is on.
 */
export const AdminProductListQuery = z
  .object({
    q: z.string().trim().max(120).optional(),
    status: z.union([ProductStatus, z.literal('all')]).default('all'),
    category: Slug.optional(),
    /** Products whose stock is at or under a variant's threshold, the dashboard's definition. */
    lowStock: QueryBoolean.optional(),
    page: z.coerce.number().int().min(1).default(1),
    perPage: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
export type AdminProductListQuery = z.infer<typeof AdminProductListQuery>;

export const AdminProductListResponse = paginated(AdminProductRow);
export type AdminProductListResponse = z.infer<typeof AdminProductListResponse>;

/**
 * A variant as the form sends it.
 *
 * `id` present means "update this row", absent means "create one". A row the payload leaves out is
 * deleted - and deleting a variant somebody once ordered is safe, because `order_items.variant_id`
 * is `ON DELETE SET NULL` and the line keeps its own snapshot of name, SKU and price.
 *
 * Every physical quantity is a scaled integer (decision D-14): `weightValueMilli` is the value
 * times a thousand, `weightGrams` is what range filters compare. `weightLabel` is the designer's
 * string and the only one a customer reads.
 */
export const AdminVariantInput = z
  .object({
    id: Id.optional(),
    sku: z
      .string()
      .trim()
      .min(2)
      .max(64)
      .regex(/^[A-Za-z0-9][A-Za-z0-9-]*$/, 'Letters, digits and hyphens only'),
    weightValueMilli: z.number().int().positive(),
    weightUnit: WeightUnit,
    weightLabel: z.string().trim().min(1).max(40),
    /** Null for a `kit`, which has no single gram weight. The column is nullable for it. */
    weightGrams: z.number().int().nonnegative().nullable().optional(),
    priceCents: Cents.refine((value) => value > 0, 'A variant needs a price'),
    compareAtPriceCents: Cents.nullable().optional(),
    costCents: Cents.nullable().optional(),
    stockQty: z.number().int().nonnegative(),
    lowStockThreshold: z.number().int().nonnegative(),
    position: z.number().int().nonnegative(),
    isDefault: z.boolean(),
    isActive: z.boolean(),
  })
  .strict()
  .refine(
    (variant) =>
      variant.compareAtPriceCents === null ||
      variant.compareAtPriceCents === undefined ||
      variant.compareAtPriceCents > variant.priceCents,
    {
      // A "was" price at or below the current one is not a markdown, it is a mistake that renders
      // as a struck-through number the customer can see is wrong.
      message: 'The compare-at price has to be above the price',
      path: ['compareAtPriceCents'],
    },
  );
export type AdminVariantInput = z.infer<typeof AdminVariantInput>;

/**
 * The Nutrition Facts panel, in the units it is stored in.
 *
 * Milligrams on the wire, not grams. An FDA label is written in grams for the macros and
 * milligrams for sodium, so the form multiplies by a thousand before sending - which keeps
 * fractions out of the request entirely and honours the rule that no business value is a float.
 * `1.5 g` becomes `1500`, exactly, and there is no rounding decision to get wrong on the server.
 *
 * Sending this at all sets the row's `source` to `entered`: the form is the only writer of that
 * value, and the seed's category-level averages stay marked `reference` until someone types over
 * them (decision D-20).
 */
export const AdminNutritionInput = z
  .object({
    servingSize: z.string().trim().min(1).max(60),
    servingsPerContainer: z.number().int().positive().nullable().optional(),
    calories: z.number().int().nonnegative(),
    fatMg: z.number().int().nonnegative(),
    satFatMg: z.number().int().nonnegative(),
    carbsMg: z.number().int().nonnegative(),
    sugarsMg: z.number().int().nonnegative(),
    fiberMg: z.number().int().nonnegative(),
    proteinMg: z.number().int().nonnegative(),
    sodiumMg: z.number().int().nonnegative(),
    ingredientsText: z.string().trim().min(1).max(2000),
    allergensText: z.string().trim().max(400).nullable().optional(),
  })
  .strict()
  .refine((panel) => panel.satFatMg <= panel.fatMg, {
    // Saturated fat is a subset of total fat. A label saying otherwise is a label nobody checked.
    message: 'Saturated fat cannot exceed total fat',
    path: ['satFatMg'],
  })
  .refine((panel) => panel.sugarsMg <= panel.carbsMg, {
    message: 'Sugars cannot exceed total carbohydrates',
    path: ['sugarsMg'],
  });
export type AdminNutritionInput = z.infer<typeof AdminNutritionInput>;

export const AdminProductInput = z
  .object({
    name: z.string().trim().min(2).max(200),
    slug: Slug,
    subtitle: z.string().trim().max(200).nullable().optional(),
    blurb: z.string().trim().min(1).max(300),
    /** NOT NULL in the table: a product page with no description is not a product page. */
    description: z.string().trim().min(1).max(8000),
    story: z.string().trim().max(8000).nullable().optional(),
    categoryId: Id,
    origin: Origin,
    originRegion: z.string().trim().max(160).nullable().optional(),
    status: ProductStatus,
    isFeatured: z.boolean(),
    tone: z.string().trim().max(200).nullable().optional(),
    icon: z.string().trim().max(60).nullable().optional(),
    metaTitle: z.string().trim().max(200).nullable().optional(),
    metaDescription: z.string().trim().max(320).nullable().optional(),

    variants: z.array(AdminVariantInput).min(1).max(20),
    certifications: z.array(Certification).max(5),
    /**
     * Editorial badges only. `sale` and `organic` are never stored (decision D-12): `sale` is
     * exactly "a variant has a compare-at price" and `organic` is exactly "the product carries the
     * organic certification", so storing either would be storing a second answer that can drift.
     */
    badges: z.array(ProductBadge).max(3),
    nutrition: AdminNutritionInput.nullable().optional(),
  })
  .strict()
  .refine((product) => product.variants.filter((variant) => variant.isDefault).length === 1, {
    // The default is what "Add to cart" adds from a grid. Zero leaves the button with nothing to
    // do; two makes the choice arbitrary.
    message: 'Exactly one variant has to be the default',
    path: ['variants'],
  })
  .refine(
    (product) =>
      new Set(product.variants.map((variant) => variant.sku.toUpperCase())).size ===
      product.variants.length,
    { message: 'Two variants cannot share a SKU', path: ['variants'] },
  );
export type AdminProductInput = z.infer<typeof AdminProductInput>;

/** A variant coming back out, with the id the form needs to update it. */
export const AdminVariantView = z.object({
  id: Id,
  sku: z.string(),
  weightValueMilli: z.number().int(),
  weightUnit: WeightUnit,
  weightLabel: z.string(),
  weightGrams: z.number().int().nullable(),
  priceCents: Cents,
  compareAtPriceCents: Cents.nullable(),
  costCents: Cents.nullable(),
  stockQty: z.number().int(),
  lowStockThreshold: z.number().int(),
  position: z.number().int(),
  isDefault: z.boolean(),
  isActive: z.boolean(),
});
export type AdminVariantView = z.infer<typeof AdminVariantView>;

/** A product image row, as the admin edits its order and alt text. */
export const AdminProductImage = z.object({
  id: Id,
  url: z.string().url(),
  alt: z.string(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  position: z.number().int().nonnegative(),
  isPrimary: z.boolean(),
});
export type AdminProductImage = z.infer<typeof AdminProductImage>;

/**
 * Reordering images and choosing the primary, in one call.
 *
 * The two belong together: the primary is what a card shows, and an editor dragging images into an
 * order is usually deciding which leads. `order` lists every image id exactly once; a request that
 * names a stranger, or forgets one, is rejected whole rather than applied in part.
 */
export const AdminImageArrangement = z
  .object({
    order: z.array(Id).min(1),
    primaryId: Id,
  })
  .strict();
export type AdminImageArrangement = z.infer<typeof AdminImageArrangement>;

/** The alt text an editor types for one image. */
export const AdminImageAltInput = z.object({ alt: z.string().trim().max(300) }).strict();
export type AdminImageAltInput = z.infer<typeof AdminImageAltInput>;

/**
 * One product, everything the form edits.
 *
 * Not the storefront's `ProductDetailResponse`: that one carries derived badges, a review
 * histogram and related products, and carries none of the cost price, the draft status or the
 * nutrition source. Two audiences, two projections.
 */
export const AdminProductDetail = z.object({
  id: Id,
  name: z.string(),
  slug: Slug,
  subtitle: z.string().nullable(),
  blurb: z.string(),
  description: z.string(),
  story: z.string().nullable(),
  categoryId: Id,
  origin: Origin,
  originRegion: z.string().nullable(),
  status: ProductStatus,
  isFeatured: z.boolean(),
  tone: z.string().nullable(),
  icon: z.string().nullable(),
  metaTitle: z.string().nullable(),
  metaDescription: z.string().nullable(),
  variants: z.array(AdminVariantView),
  certifications: z.array(Certification),
  badges: z.array(ProductBadge),
  images: z.array(AdminProductImage),
  nutrition: AdminNutritionInput.nullable(),
  /** Where the panel's figures came from. Null when there is no panel. */
  nutritionSource: NutritionSource.nullable(),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type AdminProductDetail = z.infer<typeof AdminProductDetail>;

export const AdminDashboard = z.object({
  /** The window every metric is measured over, so the client states it rather than assuming. */
  windowDays: z.number().int().positive(),
  revenueCents: AdminMetric,
  orderCount: AdminMetric,
  averageOrderCents: AdminMetric,
  newCustomers: AdminMetric,
  currency: Currency,
  revenueSeries: z.array(AdminRevenuePoint),
  lowStock: z.array(AdminLowStockRow),
  recentOrders: z.array(AdminOrderRow),
});
export type AdminDashboard = z.infer<typeof AdminDashboard>;
