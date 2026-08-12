import type { AdminDashboard, AdminMetric } from '@silkgrain/contracts';
import { and, asc, count, desc, eq, gte, inArray, lt, lte, sql } from 'drizzle-orm';

import type { Database } from '../../db/client';
import {
  categories,
  customers,
  orderItems,
  orders,
  productVariants,
  products,
} from '../../db/schema';

/**
 * The dashboard's figures.
 *
 * Every number here is computed on the way out; nothing is cached and nothing is stored. A
 * dashboard reading a summary table would be a dashboard that can disagree with the orders it
 * summarises, and the shop is nowhere near the row count where that trade is worth making.
 *
 * "Revenue" means money taken and kept: `paid`, `processing`, `shipped`, `delivered`. A pending
 * order has not been charged, a cancelled one never was, and a refunded one went back - the same
 * definition the customer's own lifetime-spend card uses, so the two can never disagree about
 * what a sale is.
 */

const WINDOW_DAYS = 30;
const RECENT_ORDERS = 8;
const LOW_STOCK_ROWS = 6;

/** The statuses that mean money arrived and stayed. */
const EARNED: ['paid', 'processing', 'shipped', 'delivered'] = [
  'paid',
  'processing',
  'shipped',
  'delivered',
];

/**
 * Percentage change in basis points, or null when there is nothing to compare against.
 *
 * A first month of trading is not "up 0%". Null travels to the client, which prints a dash.
 */
function delta(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 10_000);
}

function metric(current: number, previous: number): AdminMetric {
  return { current, previous, deltaBasisPoints: delta(current, previous) };
}

export async function loadDashboard(db: Database, now = new Date()): Promise<AdminDashboard> {
  const windowStart = new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const previousStart = new Date(now.getTime() - 2 * WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const earned = inArray(orders.status, EARNED);

  const [current, previous, series, lowStock, recentOrders, newCustomers, previousCustomers] =
    await Promise.all([
      db
        .select({
          revenue: sql<string>`COALESCE(SUM(${orders.totalCents}), 0)`,
          orders: count(),
        })
        .from(orders)
        .where(and(earned, gte(orders.createdAt, windowStart))),

      db
        .select({
          revenue: sql<string>`COALESCE(SUM(${orders.totalCents}), 0)`,
          orders: count(),
        })
        .from(orders)
        .where(
          and(earned, gte(orders.createdAt, previousStart), lt(orders.createdAt, windowStart)),
        ),

      db
        .select({
          date: sql<string>`DATE(${orders.createdAt})`,
          cents: sql<string>`COALESCE(SUM(${orders.totalCents}), 0)`,
        })
        .from(orders)
        .where(and(earned, gte(orders.createdAt, windowStart)))
        .groupBy(sql`DATE(${orders.createdAt})`)
        .orderBy(asc(sql`DATE(${orders.createdAt})`)),

      db
        .select({
          variantId: productVariants.id,
          productSlug: products.slug,
          productName: products.name,
          sku: productVariants.sku,
          weightLabel: productVariants.weightLabel,
          stockQty: productVariants.stockQty,
          lowStockThreshold: productVariants.lowStockThreshold,
        })
        .from(productVariants)
        .innerJoin(products, eq(products.id, productVariants.productId))
        .innerJoin(categories, eq(categories.id, products.categoryId))
        .where(
          and(
            eq(productVariants.isActive, true),
            eq(products.status, 'active'),
            lte(productVariants.stockQty, productVariants.lowStockThreshold),
          ),
        )
        // Emptiest first: out of stock is the most urgent case, not the one to hide.
        .orderBy(asc(productVariants.stockQty), asc(productVariants.id))
        .limit(LOW_STOCK_ROWS),

      db
        .select({
          orderNumber: orders.orderNumber,
          email: orders.email,
          firstName: customers.firstName,
          lastName: customers.lastName,
          status: orders.status,
          totalCents: orders.totalCents,
          createdAt: orders.createdAt,
          itemCount: sql<string>`COALESCE((
            SELECT SUM(${orderItems.qty}) FROM ${orderItems}
            WHERE ${orderItems.orderId} = ${orders.id}
          ), 0)`,
        })
        .from(orders)
        // Left join: most orders are guest checkouts and have no customer row to join to.
        .leftJoin(customers, eq(customers.id, orders.customerId))
        .orderBy(desc(orders.createdAt), desc(orders.id))
        .limit(RECENT_ORDERS),

      db.select({ total: count() }).from(customers).where(gte(customers.createdAt, windowStart)),

      db
        .select({ total: count() })
        .from(customers)
        .where(and(gte(customers.createdAt, previousStart), lt(customers.createdAt, windowStart))),
    ]);

  const currentRevenue = Number(current[0]?.revenue ?? 0);
  const previousRevenue = Number(previous[0]?.revenue ?? 0);
  const currentOrders = current[0]?.orders ?? 0;
  const previousOrders = previous[0]?.orders ?? 0;

  // Integer division, floored: an average order value is a display figure, and carrying a
  // fraction of a cent through it would be the one place in the codebase that does.
  const averageOf = (revenue: number, orderCount: number) =>
    orderCount === 0 ? 0 : Math.round(revenue / orderCount);

  return {
    windowDays: WINDOW_DAYS,
    revenueCents: metric(currentRevenue, previousRevenue),
    orderCount: metric(currentOrders, previousOrders),
    averageOrderCents: metric(
      averageOf(currentRevenue, currentOrders),
      averageOf(previousRevenue, previousOrders),
    ),
    newCustomers: metric(newCustomers[0]?.total ?? 0, previousCustomers[0]?.total ?? 0),
    currency: 'USD',
    // Days with no sales are absent from a GROUP BY and have to be filled in, or the chart draws
    // a straight line between two distant points and invents a trend that did not happen.
    revenueSeries: fillDays(windowStart, now, series),
    lowStock: lowStock.map((row) => ({ ...row })),
    recentOrders: recentOrders.map((row) => ({
      orderNumber: row.orderNumber,
      email: row.email,
      customerName: row.firstName === null ? null : `${row.firstName} ${row.lastName ?? ''}`.trim(),
      status: row.status,
      totalCents: row.totalCents,
      currency: 'USD' as const,
      itemCount: Number(row.itemCount),
      createdAt: row.createdAt.toISOString(),
    })),
  };
}

/** `YYYY-MM-DD` in local time, which is what `DATE()` returns on the same connection. */
function isoDay(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${String(year)}-${month}-${day}`;
}

/**
 * `cents` arrives as a string, and the annotation says so.
 *
 * mysql2 hands `SUM()` over a BIGINT back as a string to keep precision it cannot promise in a
 * double. Typing it `number` would be a lie that costs a 500: the response schema is a serialiser,
 * and `Cents` rejects a string. So the conversion is real work, not a redundant cast.
 */
function fillDays(
  from: Date,
  to: Date,
  rows: { date: string | Date; cents: string }[],
): { date: string; cents: number }[] {
  const byDay = new Map<string, number>();
  for (const row of rows) {
    // MySQL's DATE() comes back as a string through some drivers and a Date through others.
    const key = row.date instanceof Date ? isoDay(row.date) : row.date;
    byDay.set(key, Number(row.cents));
  }

  const points: { date: string; cents: number }[] = [];
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const last = new Date(to.getFullYear(), to.getMonth(), to.getDate());

  while (cursor <= last) {
    const key = isoDay(cursor);
    points.push({ date: key, cents: byDay.get(key) ?? 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  return points;
}
