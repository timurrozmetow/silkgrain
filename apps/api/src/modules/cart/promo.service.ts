import { type AppliedPromo, type ErrorCode, Money, type RejectedPromo } from '@silkgrain/contracts';
import { and, count, eq, or } from 'drizzle-orm';

import type { Database } from '../../db/client';
import { promoCodes, promoRedemptions } from '../../db/schema';
import { AppError } from '../../lib/errors';

/**
 * Promo codes, evaluated against a cart.
 *
 * Nothing here writes: a redemption row is created by the transaction that marks an order paid,
 * in Phase 4. Validating and redeeming are deliberately separate, because a customer may sit on
 * the cart page for an hour with a valid code and never buy anything, and a code that counted
 * that as a use would exhaust itself against carts instead of orders.
 */

/** Who is asking. A guest has neither until checkout collects an email. */
export interface PromoIdentity {
  customerId?: number;
  email?: string;
}

export interface PromoEvaluation {
  applied: AppliedPromo | null;
  rejected: RejectedPromo | null;
}

class PromoRejection extends Error {
  constructor(
    readonly reason: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PromoRejection';
  }
}

/**
 * @param strict `POST /api/cart/promo` - the Apply button - passes true and gets a `PROMO_*`
 * error. `POST /api/cart/validate` passes false: a code that expired while the cart sat in
 * `localStorage` must not turn the whole cart page into an error state, so the quote comes
 * back priced without it and the storefront explains why.
 */
export async function evaluatePromo(
  db: Database,
  code: string,
  subtotal: Money,
  identity: PromoIdentity,
  strict: boolean,
): Promise<PromoEvaluation> {
  try {
    return { applied: await applyPromo(db, code, subtotal, identity), rejected: null };
  } catch (error) {
    if (!(error instanceof PromoRejection)) throw error;
    if (strict) throw new AppError(error.reason, error.message);
    return { applied: null, rejected: { code, reason: error.reason, message: error.message } };
  }
}

async function applyPromo(
  db: Database,
  code: string,
  subtotal: Money,
  identity: PromoIdentity,
): Promise<AppliedPromo> {
  const [promo] = await db.select().from(promoCodes).where(eq(promoCodes.code, code));

  // An inactive code and a code that never existed get the same answer on purpose: telling a
  // stranger which of the two it is turns the endpoint into a way to enumerate campaigns.
  if (!promo?.isActive) {
    throw new PromoRejection('PROMO_INVALID', `"${code}" is not a valid promo code`);
  }

  const now = new Date();
  if (promo.startsAt && promo.startsAt > now) {
    throw new PromoRejection('PROMO_EXPIRED', `"${code}" is not active yet`);
  }
  if (promo.endsAt && promo.endsAt <= now) {
    throw new PromoRejection('PROMO_EXPIRED', `"${code}" has expired`);
  }

  if (subtotal.cents < promo.minOrderCents) {
    const minimum = Money.fromCents(promo.minOrderCents).format();
    throw new PromoRejection(
      'PROMO_MIN_ORDER_NOT_MET',
      `"${code}" applies to orders of ${minimum} or more`,
    );
  }

  if (promo.usageLimit !== null && promo.usedCount >= promo.usageLimit) {
    throw new PromoRejection('PROMO_USAGE_LIMIT_REACHED', `"${code}" has been fully redeemed`);
  }

  await assertPerCustomerLimit(db, promo.id, promo.usageLimitPerCustomer, code, identity);

  return {
    code: promo.code,
    type: promo.type,
    description: promo.description,
    discountCents: discountFor(promo, subtotal).cents,
    coversShipping: promo.type === 'free_shipping',
  };
}

/**
 * A guest cart cannot be checked against a per-customer limit - there is no identity to check
 * against yet. The limit is enforced for certain inside the checkout transaction, where the
 * email is known and `promo_redemptions` is written in the same statement that reads it.
 */
async function assertPerCustomerLimit(
  db: Database,
  promoCodeId: number,
  limit: number | null,
  code: string,
  identity: PromoIdentity,
): Promise<void> {
  if (limit === null) return;

  const who =
    identity.customerId !== undefined
      ? eq(promoRedemptions.customerId, identity.customerId)
      : identity.email !== undefined
        ? eq(promoRedemptions.email, identity.email)
        : undefined;
  if (!who) return;

  // A customer who registered after buying as a guest is the same person to a promo code, so
  // both keys are checked whenever both are known.
  const identified =
    identity.customerId !== undefined && identity.email !== undefined
      ? or(who, eq(promoRedemptions.email, identity.email))
      : who;

  const [row] = await db
    .select({ used: count() })
    .from(promoRedemptions)
    .where(and(eq(promoRedemptions.promoCodeId, promoCodeId), identified));

  if ((row?.used ?? 0) >= limit) {
    throw new PromoRejection(
      'PROMO_USAGE_LIMIT_REACHED',
      limit === 1
        ? `"${code}" can only be used once per customer`
        : `"${code}" can only be used ${String(limit)} times per customer`,
    );
  }
}

/**
 * `value` is basis points for a percentage and cents for a fixed amount, per the column's
 * comment. Both are clamped to the subtotal: a $20 code on a $12 cart is a $12 discount, never
 * a payout, and `max_discount_cents` caps what a percentage can take off a large order.
 */
function discountFor(
  promo: {
    type: 'percent' | 'fixed' | 'free_shipping';
    value: number;
    maxDiscountCents: number | null;
  },
  subtotal: Money,
): Money {
  if (promo.type === 'free_shipping') return Money.zero();

  const raw =
    promo.type === 'percent' ? subtotal.basisPoints(promo.value) : Money.fromCents(promo.value);

  const capped =
    promo.maxDiscountCents !== null && raw.cents > promo.maxDiscountCents
      ? Money.fromCents(promo.maxDiscountCents)
      : raw;

  // `clampToZero` guards the one input nothing else checks: `max_discount_cents` is a plain
  // BIGINT with no non-negative CHECK behind it, so a typo in the admin panel would otherwise
  // become a negative discount, which is a surcharge.
  const bounded = capped.clampToZero();
  return bounded.cents > subtotal.cents ? subtotal : bounded;
}
