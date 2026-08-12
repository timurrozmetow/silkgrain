import { z } from 'zod';

import { OrderStatus } from '../enums';
import { Cents, Currency, Id, IsoDate, Slug } from '../primitives';

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
