import {
  type AccountSummary,
  EARNED_ORDER_STATUS,
  type AddressView,
  type OrderSummary,
  type OrderView,
  type PageQuery,
  pageBounds,
  pageMeta,
} from '@silkgrain/contracts';
import { count, desc, eq, inArray, sql } from 'drizzle-orm';

import type { Database } from '../../db/client';
import { addresses, orderItems, orders, payments } from '../../db/schema';
import { notFound } from '../../lib/errors';

/**
 * Reading an order back.
 *
 * Two ways in, and they differ only in who is allowed through: a guest presents the number
 * and the email it was placed with, a signed-in customer presents nothing because the session
 * already says who they are. Both end in the same projection, so the confirmation screen and
 * the account page cannot drift.
 */

export type OrderAccess = { email: string } | { customerId: number };

/**
 * A wrong email and a number that was never issued give the same answer on purpose.
 *
 * Order numbers are a per-year sequence, so they can be walked. If "no such order" and "not
 * your order" were distinguishable, walking them would tell an attacker exactly how many
 * orders the shop has taken and which numbers are real, which is both a privacy leak and a
 * competitor's monthly revenue report.
 */
export async function getOrderByNumber(
  db: Database,
  orderNumber: string,
  access: OrderAccess,
): Promise<OrderView> {
  const [row] = await db.select().from(orders).where(eq(orders.orderNumber, orderNumber));
  if (!row) throw notFound('Order');

  const permitted =
    'customerId' in access
      ? row.customerId === access.customerId
      : // Addresses are stored lower-cased by the Email schema, and compared that way here.
        row.email === access.email.trim().toLowerCase();
  if (!permitted) throw notFound('Order');

  return projectOrder(db, row);
}

export type OrderRow = typeof orders.$inferSelect;

/**
 * One order row turned into the projection every reader shares.
 *
 * Separated from the access check above so the back office can read an order it is entitled to see
 * without a flag that says "skip the permission test". The admin's own detail schema extends this
 * projection rather than restating it, so the two views of one order cannot disagree about what was
 * bought or what it cost.
 */
export async function projectOrder(db: Database, row: OrderRow): Promise<OrderView> {
  const [items, addressRows, paymentRows] = await Promise.all([
    db.select().from(orderItems).where(eq(orderItems.orderId, row.id)).orderBy(orderItems.id),
    db.select().from(addresses).where(eq(addresses.orderId, row.id)),
    db
      .select()
      .from(payments)
      .where(eq(payments.orderId, row.id))
      .orderBy(desc(payments.id))
      .limit(1),
  ]);

  const shipping = addressRows.find((address) => address.type === 'shipping');
  const billing = addressRows.find((address) => address.type === 'billing') ?? shipping;
  if (!shipping || !billing) {
    // Every order is written with both. One missing means the order was created by something
    // other than checkout, and returning half an order would hide that.
    throw notFound('Order');
  }

  const payment = paymentRows[0];

  return {
    orderNumber: row.orderNumber,
    status: row.status,
    email: row.email,
    items: items.map((item) => ({
      productId: item.productId,
      variantId: item.variantId,
      productSlug: item.productSlug,
      name: item.name,
      sku: item.sku,
      weightLabel: item.weightLabel,
      imageUrl: item.imageUrl,
      unitPriceCents: item.unitPriceCents,
      qty: item.qty,
      lineTotalCents: item.lineTotalCents,
      lineDiscountCents: item.lineDiscountCents,
    })),
    subtotalCents: row.subtotalCents,
    discountCents: row.discountCents,
    shippingCents: row.shippingCents,
    taxCents: row.taxCents,
    totalCents: row.totalCents,
    currency: 'USD',
    promoCode: row.promoCode,
    shippingMethod: row.shippingMethod,
    shippingAddress: toAddressView(shipping),
    billingAddress: toAddressView(billing),
    payment: payment
      ? { provider: payment.provider, brand: payment.cardBrand, last4: payment.cardLast4 }
      : null,
    tracking:
      row.trackingNumber === null || row.carrier === null
        ? null
        : { carrier: row.carrier, number: row.trackingNumber, url: row.trackingUrl },
    customerNote: row.customerNote,
    // `adminNote` is deliberately absent: it is where staff write "customer sounds difficult".
    createdAt: row.createdAt.toISOString(),
    paidAt: row.paidAt?.toISOString() ?? null,
    shippedAt: row.shippedAt?.toISOString() ?? null,
    deliveredAt: row.deliveredAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    refundedAt: row.refundedAt?.toISOString() ?? null,
  };
}

type AddressRow = typeof addresses.$inferSelect;

function toAddressView(row: AddressRow): AddressView {
  return {
    firstName: row.firstName,
    lastName: row.lastName,
    line1: row.line1,
    line2: row.line2,
    city: row.city,
    // The column is a two-character varchar, but `AddressInput.country` is the literal `US`
    // and checkout is its only writer, so nothing else can be in there.
    state: row.state as AddressView['state'],
    zip: row.zip,
    country: 'US',
    phone: row.phone,
  };
}

/**
 * The account page's three stat cards, in one round trip.
 *
 * `SUM` over an empty set is `NULL`, not zero, so the coalesce is load-bearing: a customer who
 * has signed up but not yet checked out must read $0.00, never a blank card. The spend total is
 * restricted to the four statuses that mean money was taken and kept; the count is deliberately
 * not, so it agrees with the history list, which shows every order regardless of status.
 */
export async function getAccountSummary(db: Database, customerId: number): Promise<AccountSummary> {
  const [row] = await db
    .select({
      orderCount: count(),
      // Typed as string, not number: MySQL returns a SUM over BIGINT as a decimal string, and
      // claiming it is a number would make the `Number()` below look redundant when it is the
      // one thing making the value safe to use.
      lifetimeSpentCents: sql<string>`COALESCE(SUM(CASE WHEN ${inArray(orders.status, [...EARNED_ORDER_STATUS])} THEN ${orders.totalCents} ELSE 0 END), 0)`,
    })
    .from(orders)
    .where(eq(orders.customerId, customerId));

  return {
    orderCount: row?.orderCount ?? 0,
    // MySQL returns SUM over BIGINT as a decimal string; Number is exact below 2^53 cents,
    // which is more money than this shop will ever take.
    lifetimeSpentCents: Number(row?.lifetimeSpentCents ?? 0),
    currency: 'USD',
  };
}

/** The account page's order history. */
export async function listCustomerOrders(
  db: Database,
  customerId: number,
  page: PageQuery,
): Promise<{ items: OrderSummary[]; meta: ReturnType<typeof pageMeta> }> {
  const { limit, offset } = pageBounds(page);

  const [rows, [totals]] = await Promise.all([
    db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        status: orders.status,
        totalCents: orders.totalCents,
        createdAt: orders.createdAt,
        paidAt: orders.paidAt,
        shippedAt: orders.shippedAt,
        deliveredAt: orders.deliveredAt,
      })
      .from(orders)
      .where(eq(orders.customerId, customerId))
      .orderBy(desc(orders.createdAt), desc(orders.id))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(orders).where(eq(orders.customerId, customerId)),
  ]);

  const ids = rows.map((row) => row.id);
  const lines =
    ids.length === 0
      ? []
      : await db
          .select({
            orderId: orderItems.orderId,
            qty: orderItems.qty,
            imageUrl: orderItems.imageUrl,
            id: orderItems.id,
          })
          .from(orderItems)
          .where(inArray(orderItems.orderId, ids))
          .orderBy(orderItems.id);

  return {
    items: rows.map((row) => {
      const own = lines.filter((line) => line.orderId === row.id);
      return {
        orderNumber: row.orderNumber,
        status: row.status,
        totalCents: row.totalCents,
        currency: 'USD' as const,
        createdAt: row.createdAt.toISOString(),
        paidAt: row.paidAt?.toISOString() ?? null,
        shippedAt: row.shippedAt?.toISOString() ?? null,
        deliveredAt: row.deliveredAt?.toISOString() ?? null,
        itemCount: own.reduce((sum, line) => sum + line.qty, 0),
        imageUrl: own.find((line) => line.imageUrl !== null)?.imageUrl ?? null,
      };
    }),
    meta: pageMeta(page.page, page.perPage, totals?.total ?? 0),
  };
}
