import type {
  FreeShippingProgress,
  Money,
  ShippingMethod,
  ShippingOption,
} from '@silkgrain/contracts';
import { asc, eq } from 'drizzle-orm';

import type { Database } from '../../db/client';
import { shippingRates } from '../../db/schema';
import { AppError, badRequest } from '../../lib/errors';

/**
 * Shipping is priced from `shipping_rates`, which the admin panel owns (decision D-2).
 *
 * The free-shipping threshold is read from the rate row rather than from the
 * `commerce.free_shipping_threshold_cents` setting. Both exist, and the rate is the one the
 * checkout charges from, so it is the one that decides. The setting is announcement-bar copy.
 */

export interface ShippingQuote {
  options: ShippingOption[];
  selected: ShippingOption;
  progress: FreeShippingProgress | null;
}

export async function quoteShipping(
  db: Database,
  method: ShippingMethod,
  /** After the discount: a promo that drops the subtotal below the threshold loses free shipping. */
  qualifyingSubtotal: Money,
  promoCoversShipping: boolean,
): Promise<ShippingQuote> {
  const rates = await db
    .select()
    .from(shippingRates)
    .where(eq(shippingRates.isActive, true))
    .orderBy(asc(shippingRates.position), asc(shippingRates.priceCents));

  if (rates.length === 0) {
    // A store that cannot price shipping cannot take an order. Failing loudly here is far
    // better than quoting a cart at zero postage and discovering it on the bank statement.
    throw new AppError('INTERNAL', 'No shipping rates are configured');
  }

  const options: ShippingOption[] = rates.map((rate) => {
    const meetsThreshold =
      rate.freeAboveCents !== null && qualifyingSubtotal.cents >= rate.freeAboveCents;
    const isFree = meetsThreshold || promoCoversShipping;
    return {
      code: rate.code,
      name: rate.name,
      description: rate.description,
      baseCents: rate.priceCents,
      priceCents: isFree ? 0 : rate.priceCents,
      isFree,
      estimatedDaysMin: rate.estimatedDaysMin,
      estimatedDaysMax: rate.estimatedDaysMax,
    };
  });

  const selected = options.find((option) => option.code === method);
  if (!selected) {
    // The method was valid when the customer chose it and has since been switched off. Saying
    // so beats silently shipping them by a different service at a different price.
    throw badRequest(`${method} shipping is not available at the moment`);
  }

  return {
    options,
    selected,
    progress: progressFor(rates, qualifyingSubtotal, promoCoversShipping),
  };
}

/**
 * "You're $12.40 away from free shipping."
 *
 * The lowest threshold on offer is the one worth showing: it is the nearest one the customer
 * can reach, and reaching it is the whole point of the bar.
 */
function progressFor(
  rates: readonly { freeAboveCents: number | null }[],
  subtotal: Money,
  promoCoversShipping: boolean,
): FreeShippingProgress | null {
  const thresholds = rates
    .map((rate) => rate.freeAboveCents)
    .filter((value): value is number => value !== null && value > 0);
  if (thresholds.length === 0) return null;

  const threshold = Math.min(...thresholds);
  // A free-shipping code has already got the customer there. Without this the same response
  // would carry a zero shipping line and a bar reading "you're $12.40 away from free
  // shipping", and the customer would believe the one that costs them money.
  const qualified = promoCoversShipping || subtotal.cents >= threshold;

  return {
    thresholdCents: threshold,
    remainingCents: qualified ? 0 : threshold - subtotal.cents,
    progressPercent: qualified ? 100 : Math.round((subtotal.cents / threshold) * 100),
    qualified,
  };
}
