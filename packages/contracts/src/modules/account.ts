import { z } from 'zod';

import { Cents, Currency } from '../primitives';

/**
 * The three numbers behind the account page's stat cards.
 *
 * `orderCount` counts every order the customer has placed, so it matches the number of cards
 * in the history list beneath it. `lifetimeSpentCents` is narrower on purpose: only orders
 * whose money was actually taken and kept - paid, processing, shipped, delivered. A pending
 * order has not been charged, a cancelled one never was, and a refunded one was paid back, so
 * none of the three belong in a total labelled "spent".
 *
 * The dark "Grain points" card from the mockup has no backing model and is not counted here;
 * it, addresses and payment methods wait in BACKLOG.
 */
export const AccountSummary = z.object({
  orderCount: z.number().int().nonnegative(),
  lifetimeSpentCents: Cents,
  currency: Currency,
});
export type AccountSummary = z.infer<typeof AccountSummary>;
