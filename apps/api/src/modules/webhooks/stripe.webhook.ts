import { ApiError } from '@silkgrain/contracts';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import Stripe from 'stripe';
import { z } from 'zod';

import type { Database } from '../../db/client';
import { orders } from '../../db/schema';
import type { Env } from '../../env';
import { AppError } from '../../lib/errors';
import type { EmailJob } from '../mail/email.queue';
import { markOrderPaid, markOrderRefunded, markPaymentFailed } from '../orders/settle.service';

import { claimWebhookEvent, completeWebhookEvent, failWebhookEvent } from './webhook-events';

/**
 * Stripe's webhook endpoint.
 *
 * Three things make this route unlike every other one:
 *
 * 1. **It needs the raw body.** The signature covers the bytes Stripe sent, so a body that has
 *    been parsed and re-serialised will not verify. The parser below is registered inside this
 *    plugin, and Fastify encapsulates content-type parsers by scope, so exactly this route
 *    gets bytes and every other route goes on getting JSON.
 * 2. **It is not authenticated, and must not be.** Stripe has no session. The signature is the
 *    authentication, which is why verification is unconditional and comes before anything
 *    reads the payload.
 * 3. **It always answers 200 once the event is recorded.** A 500 tells Stripe to redeliver;
 *    that is right when the work failed and wrong when the work was already done.
 */

/** Stripe's own default. A replayed body older than this is a replay, not a redelivery. */
const SIGNATURE_TOLERANCE_SECONDS = 300;

const StripeMetadata = z.object({ order_id: z.coerce.number().int().positive() });

export interface StripeWebhookOptions {
  env: Env;
}

// eslint-disable-next-line @typescript-eslint/require-await -- Fastify plugins are async by contract
export async function stripeWebhookRoutes(
  app: FastifyInstance,
  { env }: StripeWebhookOptions,
): Promise<void> {
  const stripe = new Stripe(env.STRIPE_SECRET_KEY);

  // Scoped to this plugin. `parseAs: 'buffer'` hands the handler the exact bytes received.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (_request, body, done: (error: Error | null, result?: unknown) => void) => {
      done(null, body);
    },
  );

  const routes = app.withTypeProvider<ZodTypeProvider>();

  routes.post(
    '/stripe',
    {
      // Stripe retries hard after an outage, and a burst of redeliveries must not be turned
      // away by a limit sized for browsers.
      config: { rateLimit: { max: 600, timeWindow: '1 minute' } },
      schema: {
        tags: ['webhooks'],
        summary: 'Stripe payment events',
        description:
          'Verified by signature, not by session. The event id is written to `webhook_events` ' +
          'under a unique index before it is acted on, so a redelivery is acknowledged without ' +
          'touching the order twice.',
        response: {
          200: z.object({ received: z.literal(true) }),
          400: ApiError,
        },
      },
    },
    async (request, reply) => {
      const signature = request.headers['stripe-signature'];
      const payload = request.body;

      if (typeof signature !== 'string' || !Buffer.isBuffer(payload)) {
        throw new AppError('WEBHOOK_SIGNATURE_INVALID', 'Missing signature or body');
      }

      let event: Stripe.Event;
      try {
        event = stripe.webhooks.constructEvent(
          payload,
          signature,
          env.STRIPE_WEBHOOK_SECRET,
          SIGNATURE_TOLERANCE_SECONDS,
        );
      } catch (error) {
        // The message is Stripe's and names the reason - wrong secret, stale timestamp, bad
        // digest. It goes to the log; the client gets the code and nothing else.
        request.log.warn({ err: error }, 'stripe webhook signature rejected');
        throw new AppError('WEBHOOK_SIGNATURE_INVALID', 'Signature verification failed');
      }

      const claim = await claimWebhookEvent(app.db, 'stripe', event.id, event.type, event.data);
      if (claim.status === 'already_processed') {
        return reply.status(200).send({ received: true } as const);
      }

      try {
        await handleEvent(app.db, event, app.enqueueEmail);
        await completeWebhookEvent(app.db, claim.id);
      } catch (error) {
        // Recorded outside the transaction that failed, which has already rolled back.
        await failWebhookEvent(app.db, claim.id, error);
        request.log.error(
          { err: error, eventId: event.id, eventType: event.type, attempt: claim.attempt },
          'stripe webhook handler failed',
        );
        // Deliberately not the status this code would carry for a customer. `INSUFFICIENT_STOCK`
        // is a 422 to someone filling a cart, and answering Stripe with a 4xx would say the
        // request was malformed when the request was fine and the work failed. A 500 is what
        // asks for a redelivery and what belongs in an alert; the cause is in the log line
        // above and in `webhook_events.error`.
        throw new AppError('INTERNAL', 'Could not process this event', { cause: error });
      }

      return reply.status(200).send({ received: true } as const);
    },
  );
}

/**
 * Written as branches rather than a `switch`, because Stripe's event union has some two
 * hundred and fifty members and an exhaustive switch over it is neither possible nor useful.
 * An event this code does not act on is still recorded and acknowledged - the account decides
 * what it is subscribed to, and retrying an event forever because nobody handles it is worse
 * than ignoring it.
 */
async function handleEvent(
  db: Database,
  event: Stripe.Event,
  enqueueEmail: (job: EmailJob) => Promise<void>,
): Promise<void> {
  if (event.type === 'payment_intent.succeeded') {
    const intent = event.data.object;
    const orderId = await orderIdFrom(db, intent.metadata);
    const settlement = await markOrderPaid(db, orderId, {
      provider: 'stripe',
      providerPaymentId: intent.id,
      amountCents: intent.amount_received,
      currency: intent.currency.toUpperCase(),
      ...cardDetails(intent),
      rawPayload: event,
    });

    // Only when this delivery is the one that moved the order. A redelivery finds it already
    // paid and must not produce a second receipt.
    if (settlement.changed) {
      const [order] = await db
        .select({ orderNumber: orders.orderNumber, email: orders.email })
        .from(orders)
        .where(eq(orders.id, orderId));
      if (order) {
        await enqueueEmail({
          type: 'order_confirmation',
          orderNumber: order.orderNumber,
          email: order.email,
        });
      }
    }
    return;
  }

  if (event.type === 'payment_intent.payment_failed') {
    const intent = event.data.object;
    await markPaymentFailed(db, await orderIdFrom(db, intent.metadata), {
      provider: 'stripe',
      providerPaymentId: intent.id,
      amountCents: intent.amount,
      currency: intent.currency.toUpperCase(),
      failureCode: intent.last_payment_error?.code ?? null,
      failureMessage: intent.last_payment_error?.message ?? null,
      rawPayload: event,
    });
    return;
  }

  if (event.type === 'charge.refunded') {
    const charge = event.data.object;
    const intentId =
      typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
    if (intentId === undefined) {
      throw new AppError('INTERNAL', `Refund ${charge.id} carries no payment intent`);
    }
    await markOrderRefunded(db, await orderIdFrom(db, charge.metadata), {
      providerPaymentId: intentId,
      refundedCents: charge.amount_refunded,
      rawPayload: event,
    });
  }
}

/**
 * The order this event belongs to.
 *
 * `metadata.order_id` is set when the PaymentIntent is created, and it is the only link back:
 * matching on the amount or the email would be guesswork the moment a customer places two
 * identical orders.
 */
async function orderIdFrom(db: Database, metadata: Stripe.Metadata | null): Promise<number> {
  const parsed = StripeMetadata.safeParse(metadata ?? {});
  if (!parsed.success) {
    throw new AppError('INTERNAL', 'Stripe event carries no usable order_id in metadata');
  }

  const [order] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.id, parsed.data.order_id));
  if (!order) {
    throw new AppError('INTERNAL', `No order ${String(parsed.data.order_id)} for this event`);
  }
  return order.id;
}

/**
 * Brand and last four, which is the most a card ever reveals to this system.
 *
 * `latest_charge` is typed `string | Charge | null`, but the field is also simply absent on an
 * intent that never produced a charge, and it is a bare id unless the event expanded it. Only
 * an object carries the card, so anything else answers "no card" rather than throwing - which
 * it did, until a payment without an expanded charge reached it.
 */
function cardDetails(intent: Stripe.PaymentIntent): {
  cardBrand: string | null;
  cardLast4: string | null;
} {
  const charge: unknown = intent.latest_charge;
  if (typeof charge !== 'object' || charge === null) {
    return { cardBrand: null, cardLast4: null };
  }
  const card = (charge as Stripe.Charge).payment_method_details?.card;
  return { cardBrand: card?.brand ?? null, cardLast4: card?.last4 ?? null };
}
