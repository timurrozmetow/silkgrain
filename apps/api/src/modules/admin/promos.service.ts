import {
  type AdminPromoDetail,
  type AdminPromoDiscount,
  type AdminPromoInput,
  type AdminPromoListQuery,
  type AdminPromoListResponse,
  type AdminPromoRow,
  type PromoState,
  pageBounds,
  pageMeta,
} from '@silkgrain/contracts';
import { and, count, desc, eq, gt, isNotNull, isNull, lte, ne, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import type { Database, DbExecutor } from '../../db/client';
import { orders, promoCodes, promoRedemptions } from '../../db/schema';
import { AppError, notFound } from '../../lib/errors';
import { likePattern } from '../catalog/catalog.query';

import type { AdminActor } from './actor';
import { diffSnapshots } from './audit.diff';
import { promoSnapshot } from './audit.projectors';
import { type AuditContext, recordAudit } from './audit.service';

/**
 * Promo codes in the back office.
 *
 * Two rules shape this file. `used_count` is an accounting fact written by the paid transaction and
 * is writable nowhere; and nothing here deletes anything a customer has touched - the terminal
 * action is `is_active = false`, which the cart's evaluator already honours.
 *
 * There is no `DELETE`. `promo_redemptions.promo_code_id` is `ON DELETE CASCADE`, so deleting a used
 * code destroys the rows a per-customer limit is counted from, and a delete-then-recreate resets
 * every such limit to zero without anybody deciding to. The typo created five minutes ago is
 * answered by rename, which is free while no order has ever named the code.
 */

const REDEMPTION_PAGE = 20;

/** The editable fields, as the two input schemas both resolve to. */
type PromoFields = AdminPromoInput;

type PromoRow = typeof promoCodes.$inferSelect;

/**
 * Where a code stands, in the evaluator's own order.
 *
 * `applyPromo` checks active, then the start date, then the end date, then the usage limit, and the
 * chip has to name the same blocking condition the customer is being told about. A different
 * ordering - however sensible on its own - would be a second answer to one question.
 */
export function stateOf(row: PromoRow, now: Date): PromoState {
  if (!row.isActive) return 'disabled';
  if (row.startsAt !== null && row.startsAt > now) return 'scheduled';
  if (row.endsAt !== null && row.endsAt <= now) return 'expired';
  if (row.usageLimit !== null && row.usedCount >= row.usageLimit) return 'exhausted';
  return 'live';
}

/**
 * The same five states as SQL, fed the same `now`.
 *
 * Written beside `stateOf` because the classic failure here is a `WHERE` clause and a projection
 * drifting apart - a filter for `live` returning a row the same response chips `exhausted`. A test
 * asserts that every row a filter returns carries that filter's chip.
 */
function stateFilter(state: PromoState, now: Date): SQL | undefined {
  const active = eq(promoCodes.isActive, true);
  const started = or(isNull(promoCodes.startsAt), lte(promoCodes.startsAt, now));
  const notEnded = or(isNull(promoCodes.endsAt), gt(promoCodes.endsAt, now));
  const notExhausted = or(
    isNull(promoCodes.usageLimit),
    sql`${promoCodes.usedCount} < ${promoCodes.usageLimit}`,
  );

  switch (state) {
    case 'disabled':
      return eq(promoCodes.isActive, false);
    case 'scheduled':
      return and(active, isNotNull(promoCodes.startsAt), gt(promoCodes.startsAt, now));
    case 'expired':
      return and(active, started, isNotNull(promoCodes.endsAt), lte(promoCodes.endsAt, now));
    case 'exhausted':
      return and(
        active,
        started,
        notEnded,
        isNotNull(promoCodes.usageLimit),
        sql`${promoCodes.usedCount} >= ${promoCodes.usageLimit}`,
      );
    case 'live':
      return and(active, started, notEnded, notExhausted);
  }
}

/** The column triple, as the union the contract transports. */
function toDiscount(row: PromoRow): AdminPromoDiscount {
  if (row.type === 'percent') {
    return {
      type: 'percent',
      basisPoints: row.value,
      maxDiscountCents: row.maxDiscountCents,
    };
  }
  if (row.type === 'fixed') return { type: 'fixed', amountCents: row.value };
  return { type: 'free_shipping' };
}

/** And back again. `max_discount_cents` is forced null off the percent path, as the CHECK demands. */
function fromDiscount(discount: AdminPromoDiscount): {
  type: PromoRow['type'];
  value: number;
  maxDiscountCents: number | null;
} {
  switch (discount.type) {
    case 'percent':
      return {
        type: 'percent',
        value: discount.basisPoints,
        maxDiscountCents: discount.maxDiscountCents,
      };
    case 'fixed':
      return { type: 'fixed', value: discount.amountCents, maxDiscountCents: null };
    case 'free_shipping':
      // `value` is read by nothing for this type; zero is the honest placeholder, and the CHECKs
      // only constrain it for the other two.
      return { type: 'free_shipping', value: 0, maxDiscountCents: null };
  }
}

function toRow(row: PromoRow, now: Date): AdminPromoRow {
  return {
    id: row.id,
    code: row.code,
    description: row.description,
    discount: toDiscount(row),
    minOrderCents: row.minOrderCents,
    usageLimit: row.usageLimit,
    usageLimitPerCustomer: row.usageLimitPerCustomer,
    usedCount: row.usedCount,
    startsAt: row.startsAt?.toISOString() ?? null,
    endsAt: row.endsAt?.toISOString() ?? null,
    isActive: row.isActive,
    state: stateOf(row, now),
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listPromos(
  db: Database,
  query: AdminPromoListQuery,
): Promise<AdminPromoListResponse> {
  // One `now` for the filter and the projection both, or a code expiring mid-request could be
  // selected as live and chipped as expired.
  const now = new Date();
  const filters = [];

  if (query.q !== undefined && query.q !== '') {
    const pattern = likePattern(query.q);
    filters.push(
      or(sql`${promoCodes.code} LIKE ${pattern}`, sql`${promoCodes.description} LIKE ${pattern}`),
    );
  }
  if (query.state !== 'all') filters.push(stateFilter(query.state, now));

  const where = filters.length === 0 ? undefined : and(...filters);
  const { limit, offset } = pageBounds(query);

  const [rows, [totals]] = await Promise.all([
    db
      .select()
      .from(promoCodes)
      .where(where)
      .orderBy(desc(promoCodes.createdAt), desc(promoCodes.id))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(promoCodes).where(where),
  ]);

  return {
    items: rows.map((row) => toRow(row, now)),
    meta: pageMeta(query.page, query.perPage, totals?.total ?? 0),
  };
}

/**
 * Whether any order has ever named this code, at any status.
 *
 * `used_count` and `promo_redemptions` are both written by the paid transaction, so between
 * checkout writing `orders.promo_code` and the webhook arriving they both read zero. Guarding on
 * either would let a code be renamed out from under an order already priced with it.
 */
async function codeIsUntouched(tx: DbExecutor, code: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.promoCode, code))
    .limit(1);
  return row === undefined;
}

export async function getPromo(db: Database, id: number): Promise<AdminPromoDetail> {
  const [row] = await db.select().from(promoCodes).where(eq(promoCodes.id, id));
  if (!row) throw notFound('Promo code');

  const [redemptions, [totals], untouched] = await Promise.all([
    db
      .select({
        orderNumber: orders.orderNumber,
        email: promoRedemptions.email,
        recordedDiscountCents: promoRedemptions.discountCents,
        createdAt: promoRedemptions.createdAt,
      })
      .from(promoRedemptions)
      .innerJoin(orders, eq(orders.id, promoRedemptions.orderId))
      .where(eq(promoRedemptions.promoCodeId, id))
      .orderBy(desc(promoRedemptions.createdAt), desc(promoRedemptions.id))
      .limit(REDEMPTION_PAGE),
    db
      .select({ total: count() })
      .from(promoRedemptions)
      .where(eq(promoRedemptions.promoCodeId, id)),
    codeIsUntouched(db, row.code),
  ]);

  return {
    ...toRow(row, new Date()),
    canRenameCode: untouched,
    redemptionCount: totals?.total ?? 0,
    redemptions: redemptions.map((entry) => ({
      orderNumber: entry.orderNumber,
      email: entry.email,
      recordedDiscountCents: entry.recordedDiscountCents,
      createdAt: entry.createdAt.toISOString(),
    })),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * A duplicate code, caught before the unique index turns it into a 500.
 *
 * The comparison is the database's own: `promo_codes.code` is a `varchar` under a case-insensitive
 * collation, so `welcome10` and `WELCOME10` are the same row. The contract upper-cases on the way
 * in, which makes that visible rather than surprising.
 */
async function assertCodeFree(
  tx: DbExecutor,
  code: string,
  exceptId: number | null,
): Promise<void> {
  const [clash] = await tx
    .select({ id: promoCodes.id })
    .from(promoCodes)
    .where(
      exceptId === null
        ? eq(promoCodes.code, code)
        : and(eq(promoCodes.code, code), ne(promoCodes.id, exceptId)),
    );

  if (clash) {
    throw new AppError('CONFLICT', `The code ${code} is already in use`, {
      details: [{ path: 'code', message: 'Already taken' }],
    });
  }
}

function columnsFor(input: Omit<PromoFields, 'isActive'>) {
  const discount = fromDiscount(input.discount);
  return {
    code: input.code,
    description: input.description,
    type: discount.type,
    value: discount.value,
    maxDiscountCents: discount.maxDiscountCents,
    minOrderCents: input.minOrderCents,
    usageLimit: input.usageLimit,
    usageLimitPerCustomer: input.usageLimitPerCustomer,
    startsAt: input.startsAt === null ? null : new Date(input.startsAt),
    endsAt: input.endsAt === null ? null : new Date(input.endsAt),
  };
}

export async function createPromo(
  db: Database,
  input: PromoFields,
  actor: AdminActor,
  context: AuditContext,
): Promise<AdminPromoDetail> {
  const id = await db.transaction(async (tx) => {
    await assertCodeFree(tx, input.code, null);
    const [row] = await tx
      .insert(promoCodes)
      .values({ ...columnsFor(input), isActive: input.isActive })
      .$returningId();
    if (!row) throw new AppError('INTERNAL', 'The promo code was not inserted');

    const [created] = await tx.select().from(promoCodes).where(eq(promoCodes.id, row.id));
    await recordAudit(tx, actor, context, {
      action: 'promo.created',
      entityId: row.id,
      entityLabel: input.code,
      // Nothing existed before, so the whole snapshot is the change.
      before: null,
      after: created ? promoSnapshot(created) : null,
    });
    return row.id;
  });

  return getPromo(db, id);
}

/**
 * Replaces a code's fields, and refuses to rename one an order has already named.
 *
 * The check and the write share a transaction with `FOR UPDATE` on the row - the same lock the paid
 * transaction takes - so a rename and a redemption arriving together serialise instead of racing.
 *
 * `isActive` is absent from the payload on purpose: a stale form would otherwise revert a kill
 * switch somebody threw while it was open.
 */
export async function updatePromo(
  db: Database,
  id: number,
  input: Omit<PromoFields, 'isActive'>,
  actor: AdminActor,
  context: AuditContext,
): Promise<AdminPromoDetail> {
  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(promoCodes)
      .where(eq(promoCodes.id, id))
      .for('update');
    if (!existing) throw notFound('Promo code');

    if (existing.code !== input.code && !(await codeIsUntouched(tx, existing.code))) {
      throw new AppError(
        'CONFLICT',
        `${existing.code} has been used on an order and cannot be renamed`,
        { details: [{ path: 'code', message: 'Used on an order' }] },
      );
    }

    await assertCodeFree(tx, input.code, id);
    await tx.update(promoCodes).set(columnsFor(input)).where(eq(promoCodes.id, id));

    const [after] = await tx.select().from(promoCodes).where(eq(promoCodes.id, id));
    const delta = after && diffSnapshots(promoSnapshot(existing), promoSnapshot(after));
    if (delta) {
      await recordAudit(tx, actor, context, {
        action: 'promo.updated',
        entityId: id,
        entityLabel: after.code,
        before: delta.before,
        after: delta.after,
      });
    }
  });

  return getPromo(db, id);
}

/** The kill switch. The terminal action for a code that has been used. */
export async function setPromoActive(
  db: Database,
  id: number,
  isActive: boolean,
  actor: AdminActor,
  context: AuditContext,
): Promise<AdminPromoDetail> {
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(promoCodes).where(eq(promoCodes.id, id)).for('update');
    if (!row) throw notFound('Promo code');
    if (row.isActive === isActive) return;

    await tx.update(promoCodes).set({ isActive }).where(eq(promoCodes.id, id));
    await recordAudit(tx, actor, context, {
      action: 'promo.active_changed',
      entityId: id,
      entityLabel: row.code,
      before: { isActive: row.isActive },
      after: { isActive },
    });
  });

  return getPromo(db, id);
}
