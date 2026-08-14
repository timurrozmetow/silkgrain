import type { PublicSettings } from '@silkgrain/contracts';
import { Money } from '@silkgrain/contracts/money';
import { useQuery } from '@tanstack/react-query';

import { apiGet } from './api';

/**
 * The handful of settings the storefront renders.
 *
 * One query, cached for the session, read by the announcement bar, the header's drawer and the
 * product page. Three places used to hard-code "$75" - decision D-22 says
 * `shipping_rates.free_above_cents` is the authority on free shipping because the checkout charges
 * from it, and three strings that happened to agree with it were three chances to disagree.
 *
 * `staleTime: Infinity` because a shop's announcement copy does not change during a visit, and a
 * refetch on every window focus would be a request per tab switch for a line of text.
 */
export function usePublicSettings() {
  return useQuery({
    queryKey: ['public-settings'],
    queryFn: ({ signal }) => apiGet<PublicSettings>('/settings', signal),
    staleTime: Number.POSITIVE_INFINITY,
    // A failed read must not blank the announcement bar on a retry loop; one attempt is enough
    // for something every page renders and nothing depends on.
    retry: false,
  });
}

/**
 * "$75" from the threshold, or null when no active rate offers free shipping.
 *
 * Whole dollars, because the copy reads "over $75" and never "over $75.00" - and if a threshold is
 * ever set to something with cents, showing them is more honest than rounding the promise down.
 */
export function freeShippingLabel(cents: number | null | undefined): string | null {
  if (cents === null || cents === undefined) return null;
  const money = Money.fromCents(cents);
  return cents % 100 === 0 ? `$${String(cents / 100)}` : money.format();
}
