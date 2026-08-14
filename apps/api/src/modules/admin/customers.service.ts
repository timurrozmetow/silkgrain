import {
  type AdminCustomerDetail,
  type AdminCustomerListQuery,
  type AdminCustomerListResponse,
  type AdminCustomerRow,
  type AdminOrderRow,
  type CustomerStatus,
  EARNED_ORDER_STATUS,
  pageBounds,
  pageMeta,
} from '@silkgrain/contracts';
import { and, count, desc, eq, inArray, or, sql } from 'drizzle-orm';

import type { Database } from '../../db/client';
import { customers, orderItems, orders } from '../../db/schema';
import { notFound } from '../../lib/errors';
import { revokeAllForSubject } from '../auth/tokens';
import { likePattern } from '../catalog/catalog.query';

/**
 * Customers, as the back office sees them.
 *
 * Read-mostly on purpose: `status` is the only writable field. Everything an admin panel usually
 * grows here - reset the password, change the email, edit the name, toggle marketing consent -
 * either manufactures a fact only the customer can create or opens an account-takeover path, and
 * each is in `BACKLOG.md` with its reason.
 *
 * People who only ever checked out as a guest are not here, because there is no row for them.
 * Grouping `orders` by email to invent one would assert the identity the checkout deliberately
 * declines to assert - two orders from one address may be two people in one household.
 */

const RECENT_ORDERS = 10;

const fullName = (first: string, last: string) => `${first} ${last}`.trim();

/**
 * The spend and order aggregates, as a subquery rather than a join.
 *
 * A join to `orders` in the main query multiplies each customer by their orders, which makes the
 * `COUNT` for the pagination wrong - the classic way a list of twenty shows six. Grouping first and
 * joining the grouped result keeps one row per customer, and lets the sort order by the same
 * expression the column displays, so the two cannot disagree.
 */
function orderAggregates() {
  return sql`(
    SELECT
      ${orders.customerId} AS customer_id,
      COUNT(*) AS order_count,
      COALESCE(SUM(CASE WHEN ${inArray(orders.status, [...EARNED_ORDER_STATUS])}
        THEN ${orders.totalCents} ELSE 0 END), 0) AS spent_cents,
      MAX(${orders.createdAt}) AS last_order_at
    FROM ${orders}
    WHERE ${orders.customerId} IS NOT NULL
    GROUP BY ${orders.customerId}
  )`;
}

export async function listCustomers(
  db: Database,
  query: AdminCustomerListQuery,
): Promise<AdminCustomerListResponse> {
  const filters = [];

  if (query.q !== undefined && query.q !== '') {
    const pattern = likePattern(query.q);
    // Name or email. An order number belongs to the order list; two searches that answer
    // differently to the same string is worse than one search that answers narrowly.
    filters.push(
      or(
        sql`CONCAT(${customers.firstName}, ' ', ${customers.lastName}) LIKE ${pattern}`,
        sql`${customers.email} LIKE ${pattern}`,
      ),
    );
  }
  if (query.status !== 'all') filters.push(eq(customers.status, query.status));

  const where = filters.length === 0 ? undefined : and(...filters);
  const { limit, offset } = pageBounds(query);

  const aggregates = orderAggregates();

  const [rows, [totals]] = await Promise.all([
    db
      .select({
        id: customers.id,
        email: customers.email,
        firstName: customers.firstName,
        lastName: customers.lastName,
        status: customers.status,
        createdAt: customers.createdAt,
        // mysql2 returns COUNT and SUM over BIGINT as strings; claiming otherwise would make the
        // Number() conversions below look redundant when they are what makes the values safe.
        orderCount: sql<string | null>`agg.order_count`,
        spentCents: sql<string | null>`agg.spent_cents`,
        lastOrderAt: sql<Date | null>`agg.last_order_at`,
      })
      .from(customers)
      .leftJoin(sql`${aggregates} AS agg`, sql`agg.customer_id = ${customers.id}`)
      .where(where)
      // A customer who has never ordered sorts last under `spend`, not first: COALESCE, because
      // a NULL from the left join would sort before zero in MySQL's ascending order.
      .orderBy(
        query.sort === 'spend'
          ? sql`COALESCE(agg.spent_cents, 0) DESC, ${customers.id} DESC`
          : sql`${customers.createdAt} DESC, ${customers.id} DESC`,
      )
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(customers).where(where),
  ]);

  const items: AdminCustomerRow[] = rows.map((row) => ({
    id: row.id,
    email: row.email,
    name: fullName(row.firstName, row.lastName),
    status: row.status,
    orderCount: Number(row.orderCount ?? 0),
    lifetimeSpentCents: Number(row.spentCents ?? 0),
    currency: 'USD',
    lastOrderAt: row.lastOrderAt === null ? null : new Date(row.lastOrderAt).toISOString(),
    createdAt: row.createdAt.toISOString(),
  }));

  return { items, meta: pageMeta(query.page, query.perPage, totals?.total ?? 0) };
}

export async function getCustomer(db: Database, id: number): Promise<AdminCustomerDetail> {
  const [row] = await db.select().from(customers).where(eq(customers.id, id));
  if (!row) throw notFound('Customer');

  const [summary, recent] = await Promise.all([
    db
      .select({
        orderCount: count(),
        spentCents: sql<string>`COALESCE(SUM(CASE WHEN ${inArray(orders.status, [
          ...EARNED_ORDER_STATUS,
        ])} THEN ${orders.totalCents} ELSE 0 END), 0)`,
        lastOrderAt: sql<Date | null>`MAX(${orders.createdAt})`,
      })
      .from(orders)
      .where(eq(orders.customerId, id)),
    db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        email: orders.email,
        status: orders.status,
        totalCents: orders.totalCents,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .where(eq(orders.customerId, id))
      .orderBy(desc(orders.createdAt), desc(orders.id))
      .limit(RECENT_ORDERS),
  ]);

  const counts = new Map<number, number>();
  if (recent.length > 0) {
    const perOrder = await db
      .select({ orderId: orderItems.orderId, items: sql<string>`SUM(${orderItems.qty})` })
      .from(orderItems)
      .where(
        inArray(
          orderItems.orderId,
          recent.map((order) => order.id),
        ),
      )
      .groupBy(orderItems.orderId);
    for (const entry of perOrder) counts.set(entry.orderId, Number(entry.items));
  }

  const name = fullName(row.firstName, row.lastName);
  const recentOrders: AdminOrderRow[] = recent.map((order) => ({
    orderNumber: order.orderNumber,
    email: order.email,
    customerName: name,
    status: order.status,
    totalCents: order.totalCents,
    currency: 'USD',
    itemCount: counts.get(order.id) ?? 0,
    createdAt: order.createdAt.toISOString(),
  }));

  const aggregate = summary[0];

  return {
    id: row.id,
    email: row.email,
    name,
    status: row.status,
    orderCount: aggregate?.orderCount ?? 0,
    lifetimeSpentCents: Number(aggregate?.spentCents ?? 0),
    currency: 'USD',
    lastOrderAt:
      aggregate?.lastOrderAt == null ? null : new Date(aggregate.lastOrderAt).toISOString(),
    createdAt: row.createdAt.toISOString(),
    phone: row.phone,
    marketingOptIn: row.marketingOptIn,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    recentOrders,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Suspends or restores an account, and ends its sessions either way.
 *
 * Revoking on the block edge is what makes the suspension immediate rather than "at some point in
 * the next fifteen minutes": the access token already in the browser stays valid until it expires,
 * and the refresh that would replace it is now refused twice over - the family is revoked here, and
 * `POST /api/auth/refresh` re-reads `status` before it rotates.
 *
 * Revoking on the unblock edge too, which is less obvious. A restored account whose old refresh
 * family still worked would resume a session that was signed in before the suspension, carrying an
 * access token minted under the old state. Making the person sign in again is one inconvenience
 * against one class of confusion.
 */
export async function setCustomerStatus(
  db: Database,
  id: number,
  status: CustomerStatus,
): Promise<AdminCustomerDetail> {
  const [row] = await db
    .select({ id: customers.id, status: customers.status })
    .from(customers)
    .where(eq(customers.id, id));
  if (!row) throw notFound('Customer');

  if (row.status !== status) {
    await db.transaction(async (tx) => {
      await tx.update(customers).set({ status }).where(eq(customers.id, id));
      await revokeAllForSubject(
        tx,
        'customer',
        id,
        status === 'blocked' ? 'blocked_by_admin' : 'unblocked_by_admin',
      );
    });
  }

  return getCustomer(db, id);
}
