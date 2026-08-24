import { ApiError, CartPromoInput, CartQuote, CartQuoteInput } from '@silkgrain/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import { quoteCart } from './cart.service';
import type { PromoIdentity } from './promo.service';

/**
 * Cart pricing.
 *
 * Both routes are open to guests - there is no cart table and no session to attach one to
 * (decision D-18). `optionalCustomer` is here only so a signed-in customer's promo history can
 * be checked; it grants nothing and a missing or expired token is not an error.
 */

/**
 * Repricing a cart is cheap, but it is the storefront route a bot would hammer. Sixty a
 * minute is far more than a customer changing quantities and far less than a useful crawl.
 */
const CART_LIMIT = { rateLimit: { max: 60, timeWindow: '1 minute' } };

/**
 * Applying a promo code is a guess at a campaign name, and must not be priced like repricing.
 *
 * The response tells the guesser whether they were right - `PROMO_INVALID` means "keep going",
 * anything else means the code exists - and unlike a login there is no account to lock and no
 * cost to the attacker. This budget is sized for someone typing a code by hand.
 *
 * `@fastify/rate-limit` gives a route with its own `config.rateLimit` an independent bucket
 * rather than adding to the global one, so this genuinely replaces the 300/min in
 * `plugins/security.ts` rather than layering under it.
 *
 * `/cart/validate` also accepts a stored code and so remains a slower version of the same
 * oracle; closing that needs a limiter that can see the request body, which means moving the
 * plugin off `onRequest`. Recorded in `BACKLOG.md` rather than done here.
 */
const PROMO_LIMIT = { rateLimit: { max: 12, timeWindow: '5 minutes' } };

function identityOf(request: FastifyRequest): PromoIdentity {
  const customerId = request.auth?.sub;
  return customerId === undefined ? {} : { customerId };
}

// eslint-disable-next-line @typescript-eslint/require-await -- Fastify plugins are async by contract
export async function cartRoutes(app: FastifyInstance): Promise<void> {
  const routes = app.withTypeProvider<ZodTypeProvider>();

  routes.post(
    '/validate',
    {
      onRequest: app.optionalCustomer,
      config: CART_LIMIT,
      schema: {
        tags: ['cart'],
        summary: 'Reprice a cart against the database',
        description:
          'The body carries variant ids and quantities only - there is no field for a price, ' +
          'and the schema is strict, so a request that tries to state one is rejected before ' +
          'any handler runs. Lines whose variant was retired or sold out come back in ' +
          '`adjustments` rather than failing the request. A promo code that cannot be applied ' +
          'is reported in `promoRejected`; the cart still prices.',
        body: CartQuoteInput,
        response: { 200: CartQuote, 422: ApiError, 429: ApiError },
      },
    },
    (request) =>
      quoteCart(app.db, request.body, { strictPromo: false, identity: identityOf(request) }),
  );

  routes.post(
    '/promo',
    {
      onRequest: app.optionalCustomer,
      config: PROMO_LIMIT,
      schema: {
        tags: ['cart'],
        summary: 'Apply a promo code to a cart',
        description:
          'The Apply button. Unlike `/cart/validate`, a code that is invalid, expired, below ' +
          'its minimum order or fully redeemed fails the request with the matching `PROMO_*` ' +
          'error, because here the code is what was asked for.',
        body: CartPromoInput,
        response: { 200: CartQuote, 422: ApiError, 429: ApiError },
      },
    },
    (request) =>
      quoteCart(app.db, request.body, { strictPromo: true, identity: identityOf(request) }),
  );
}
