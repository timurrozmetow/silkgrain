import { z } from 'zod';

import { NutritionSource, OrderStatus, ProductStatus } from '../enums';
import { paginated } from '../pagination';
import { Cents, Currency, Id, IsoDate, Slug } from '../primitives';

import { QueryBoolean } from './catalog';

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
