import {
  type AdminOrderDetail,
  type AdminOrderListQuery,
  type AdminOrderListResponse,
  type AdminOrderRow,
  type AdminOrderStatusInput,
  type AdminTrackingInput,
  ORDER_STATUS_TRANSITIONS,
  type OrderStatus,
  pageBounds,
  pageMeta,
} from '@silkgrain/contracts';
import { and, count, desc, eq, inArray, like, or, sql } from 'drizzle-orm';

import type { Database, DbExecutor } from '../../db/client';
import {
  customers,
  inventoryMovements,
  orderItems,
  orders,
  payments,
  productVariants,
  products,
} from '../../db/schema';
import { AppError, notFound } from '../../lib/errors';
import { likePattern } from '../catalog/catalog.query';
import { type OrderRow, projectOrder } from '../orders/orders.service';

/**
 * The back office's orders: reading them, moving them along, and recording what was sent.
 *
 * Two rules shape everything here. An order is never moved anywhere the transition map does not
 * allow, so the set of reachable states is one table in `packages/contracts` rather than a
 * condition scattered across a UI and a handler. And `refunded` is never reachable from this
 * service at all - see `allowedFor` below.
 */

/** The statuses in which stock has already been taken off the shelf by the paid transaction. */
const STOCK_COMMITTED: readonly OrderStatus[] = ['paid', 'processing', 'shipped', 'delivered'];

/**
 * What a person may move this order to.
 *
 * The transition map allows `refunded`, and this deliberately does not offer it. A refund is money
 * leaving the account; it is recorded when the provider reports it, in the `charge.refunded`
 * webhook that is already built and tested. A button here that wrote `refunded` locally would tell
 * a customer they had been paid back when nothing had left the account - the same class of lie as
 * a client-supplied price.
 */
function allowedFor(status: OrderStatus): OrderStatus[] {
  return ORDER_STATUS_TRANSITIONS[status].filter((next) => next !== 'refunded');
}

export async function listAdminOrders(
  db: Database,
  query: AdminOrderListQuery,
): Promise<AdminOrderListResponse> {
  const filters = [];

  if (query.q !== undefined && query.q !== '') {
    const pattern = likePattern(query.q);
    // Number or email: the two things a customer quotes when they write in.
    filters.push(or(like(orders.orderNumber, pattern), like(orders.email, pattern)));
  }
  if (query.status !== 'all') filters.push(eq(orders.status, query.status));
  // The shipping desk's queue. Two statuses, which is why it cannot be a status filter.
  if (query.needsFulfilment === true) filters.push(inArray(orders.status, ['paid', 'processing']));

  const where = filters.length === 0 ? undefined : and(...filters);
  const { limit, offset } = pageBounds(query);

  const [rows, [totals]] = await Promise.all([
    db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        email: orders.email,
        firstName: customers.firstName,
        lastName: customers.lastName,
        status: orders.status,
        totalCents: orders.totalCents,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .leftJoin(customers, eq(customers.id, orders.customerId))
      .where(where)
      .orderBy(desc(orders.createdAt), desc(orders.id))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(orders).where(where),
  ]);

  // Item counts for this page only, by id. A join would multiply the order rows and make the
  // pagination count wrong, which is the classic way a list of ten shows four.
  const counts = new Map<number, number>();
  if (rows.length > 0) {
    const perOrder = await db
      .select({ orderId: orderItems.orderId, items: sql<string>`SUM(${orderItems.qty})` })
      .from(orderItems)
      .where(
        inArray(
          orderItems.orderId,
          rows.map((row) => row.id),
        ),
      )
      .groupBy(orderItems.orderId);
    for (const entry of perOrder) counts.set(entry.orderId, Number(entry.items));
  }

  const items: AdminOrderRow[] = rows.map((row) => ({
    orderNumber: row.orderNumber,
    email: row.email,
    // Left join, so both are null for a guest checkout - which is most of them.
    customerName: row.firstName === null ? null : `${row.firstName} ${row.lastName ?? ''}`.trim(),
    status: row.status,
    totalCents: row.totalCents,
    currency: 'USD',
    itemCount: counts.get(row.id) ?? 0,
    createdAt: row.createdAt.toISOString(),
  }));

  return { items, meta: pageMeta(query.page, query.perPage, totals?.total ?? 0) };
}

async function loadOrderRow(db: Database, orderNumber: string): Promise<OrderRow> {
  const [row] = await db.select().from(orders).where(eq(orders.orderNumber, orderNumber));
  if (!row) throw notFound('Order');
  return row;
}

export async function getAdminOrder(db: Database, orderNumber: string): Promise<AdminOrderDetail> {
  const row = await loadOrderRow(db, orderNumber);
  const view = await projectOrder(db, row);

  const [customer, paymentRows] = await Promise.all([
    row.customerId === null
      ? Promise.resolve([])
      : db
          .select({ firstName: customers.firstName, lastName: customers.lastName })
          .from(customers)
          .where(eq(customers.id, row.customerId)),
    db
      .select()
      .from(payments)
      .where(eq(payments.orderId, row.id))
      .orderBy(desc(payments.id))
      .limit(1),
  ]);

  const payment = paymentRows[0];

  return {
    ...view,
    id: row.id,
    customerId: row.customerId,
    customerName:
      customer[0] === undefined ? null : `${customer[0].firstName} ${customer[0].lastName}`.trim(),
    adminNote: row.adminNote,
    allowedTransitions: allowedFor(row.status),
    payment:
      payment === undefined
        ? null
        : {
            provider: payment.provider,
            brand: payment.cardBrand,
            last4: payment.cardLast4,
            status: payment.status,
            providerPaymentId: payment.providerPaymentId,
            amountCents: payment.amountCents,
            refundedCents: payment.refundedCents,
          },
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    refundedAt: row.refundedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface StatusChangeOutcome {
  detail: AdminOrderDetail;
  /** True when this call is what shipped the order, so the route knows to send the notice once. */
  nowShipped: boolean;
}

/**
 * Moves an order along, in one transaction with everything the move implies.
 *
 * The row is locked for the duration: two operators on the same order would otherwise both read
 * `paid`, both find the transition legal, and both write - and the second write would be a
 * transition from a state that no longer existed when it was authorised.
 */
export async function changeOrderStatus(
  db: Database,
  orderNumber: string,
  input: AdminOrderStatusInput,
): Promise<StatusChangeOutcome> {
  const nowShipped = await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(orders)
      .where(eq(orders.orderNumber, orderNumber))
      .for('update');
    if (!row) throw notFound('Order');

    if (!allowedFor(row.status).includes(input.status)) {
      throw new AppError(
        'ORDER_STATUS_INVALID',
        `An order that is ${row.status} cannot become ${input.status}`,
      );
    }

    const at = new Date();
    const stamp: Partial<typeof orders.$inferInsert> = {};
    if (input.status === 'shipped') stamp.shippedAt = at;
    if (input.status === 'delivered') stamp.deliveredAt = at;
    if (input.status === 'cancelled') stamp.cancelledAt = at;

    // A cancellation puts the goods back only if they were ever taken off the shelf. Cancelling a
    // `pending` order - one that was never paid for - decrements nothing, so returning stock would
    // invent inventory.
    if (input.status === 'cancelled' && STOCK_COMMITTED.includes(row.status)) {
      await restock(tx, row.id);
    }

    await tx
      .update(orders)
      .set({
        status: input.status,
        ...stamp,
        ...trackingColumns(input),
        ...(input.note === undefined
          ? {}
          : { adminNote: appendNote(row.adminNote, input.status, input.note, at) }),
      })
      .where(eq(orders.id, row.id));

    return input.status === 'shipped';
  });

  return { detail: await getAdminOrder(db, orderNumber), nowShipped };
}

/** Only the tracking fields the payload actually carried; `undefined` leaves a column alone. */
function trackingColumns(input: AdminOrderStatusInput) {
  return {
    ...(input.carrier === undefined ? {} : { carrier: input.carrier }),
    ...(input.trackingNumber === undefined ? {} : { trackingNumber: input.trackingNumber }),
    ...(input.trackingUrl === undefined ? {} : { trackingUrl: input.trackingUrl }),
  };
}

/**
 * Appends to the internal note rather than replacing it.
 *
 * Why an order was cancelled is the one thing anybody asks a month later, and a note that
 * overwrote the last one would answer only for the most recent change.
 */
function appendNote(existing: string | null, status: OrderStatus, note: string, at: Date): string {
  const line = `[${at.toISOString().slice(0, 10)}] ${status}: ${note}`;
  return existing === null || existing === '' ? line : `${existing}\n${line}`;
}

/**
 * Returns a cancelled order's units to the shelf, and takes them back off the sold count.
 *
 * The ledger entry uses reason `cancellation`, which exists for exactly this: `restock` is somebody
 * bringing a pallet in, `return` is a parcel coming back, and a cancellation is neither - the goods
 * never left. `sold_count` is reversed too, or the bestseller sort would keep counting an order
 * nobody received.
 */
async function restock(tx: DbExecutor, orderId: number): Promise<void> {
  const lines = await tx
    .select({
      variantId: orderItems.variantId,
      productId: orderItems.productId,
      qty: orderItems.qty,
    })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));

  for (const line of lines) {
    // A variant deleted since the order leaves nothing to credit. The snapshot still records what
    // was sold, and inventing a row to point the movement at would be worse than skipping it.
    if (line.variantId === null) continue;

    await tx
      .update(productVariants)
      .set({ stockQty: sql`${productVariants.stockQty} + ${line.qty}` })
      .where(eq(productVariants.id, line.variantId));

    await tx.insert(inventoryMovements).values({
      variantId: line.variantId,
      delta: line.qty,
      reason: 'cancellation',
      referenceId: orderId,
      note: `Order ${String(orderId)} cancelled`,
    });

    if (line.productId !== null) {
      // `GREATEST` because `sold_count` is unsigned: an order cancelled after the product was
      // reseeded would otherwise try to write a negative and be refused by MySQL.
      await tx
        .update(products)
        .set({ soldCount: sql`GREATEST(${products.soldCount} - ${line.qty}, 0)` })
        .where(eq(products.id, line.productId));
    }
  }
}

/** Corrects the tracking details without touching the status - usually a typo in a number. */
export async function setTracking(
  db: Database,
  orderNumber: string,
  input: AdminTrackingInput,
): Promise<AdminOrderDetail> {
  const row = await loadOrderRow(db, orderNumber);
  await db
    .update(orders)
    .set({
      carrier: input.carrier,
      trackingNumber: input.trackingNumber,
      trackingUrl: input.trackingUrl,
    })
    .where(eq(orders.id, row.id));
  return getAdminOrder(db, orderNumber);
}

export async function setAdminNote(
  db: Database,
  orderNumber: string,
  adminNote: string,
): Promise<AdminOrderDetail> {
  const row = await loadOrderRow(db, orderNumber);
  await db
    .update(orders)
    .set({ adminNote: adminNote === '' ? null : adminNote })
    .where(eq(orders.id, row.id));
  return getAdminOrder(db, orderNumber);
}
