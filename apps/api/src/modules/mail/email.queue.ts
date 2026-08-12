import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { z } from 'zod';

import type { Database } from '../../db/client';
import type { Env } from '../../env';
import { getOrderByNumber } from '../orders/orders.service';

import type { Mailer } from './mailer';
import { orderConfirmation, shippingNotice } from './templates';

/**
 * Outgoing mail, through a queue rather than inline.
 *
 * The order confirmation is sent from the payment webhook, and the webhook has to answer
 * Stripe within seconds. An SMTP conversation with a provider having a slow morning would turn
 * a successful payment into a redelivery, and a redelivery into a second attempt at work that
 * already succeeded. Handing the job to BullMQ means the webhook's answer depends on the
 * database and nothing else, and a mail server that is down delays a receipt instead of
 * jeopardising an order.
 */

export const EMAIL_QUEUE = 'email';

export const EmailJob = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('order_confirmation'),
    orderNumber: z.string(),
    email: z.string(),
  }),
  /** Enqueued when an operator marks an order shipped, from the admin panel. */
  z.object({
    type: z.literal('order_shipped'),
    orderNumber: z.string(),
    email: z.string(),
  }),
]);
export type EmailJob = z.infer<typeof EmailJob>;

/**
 * One job per thing that happened, not per attempt.
 *
 * BullMQ refuses a second job with an id it already holds, so a webhook redelivered after the
 * order was already settled cannot produce a second receipt even if something upstream let it
 * through.
 */
export function jobIdFor(job: EmailJob): string {
  // A dot, not a colon: BullMQ builds its Redis keys with `:` and rejects a custom id that
  // contains one. Order numbers already carry hyphens, so a dot is what is left.
  return `${job.type}.${job.orderNumber}`;
}

export function createEmailQueue(connection: Redis): Queue<EmailJob> {
  return new Queue<EmailJob>(EMAIL_QUEUE, {
    connection,
    defaultJobOptions: {
      attempts: 5,
      // A provider that is briefly down is the common case; backing off to about a minute
      // covers it without a person having to notice.
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { count: 200 },
      // Failures are kept: an unsent receipt is a customer who will write in, and the job is
      // the only record of what was meant to go out.
      removeOnFail: false,
    },
  });
}

export interface EmailWorkerDeps {
  db: Database;
  mailer: Mailer;
  env: Env;
  onError?: (error: unknown) => void;
}

export function createEmailWorker(connection: Redis, deps: EmailWorkerDeps): Worker<EmailJob> {
  const worker = new Worker<EmailJob>(
    EMAIL_QUEUE,
    async (job) => {
      const payload = EmailJob.parse(job.data);

      // Re-read rather than carry the figures in the job: the receipt is then rendered from
      // exactly the projection the customer sees on the order page, and the two cannot show
      // different totals.
      const order = await getOrderByNumber(deps.db, payload.orderNumber, {
        email: payload.email,
      });

      const store = {
        name: deps.env.MAIL_FROM_NAME,
        webUrl: deps.env.PUBLIC_WEB_URL,
        supportEmail: deps.env.MAIL_REPLY_TO || deps.env.MAIL_FROM_ADDRESS,
      };
      const rendered =
        payload.type === 'order_shipped'
          ? shippingNotice(order, store)
          : orderConfirmation(order, store);

      await deps.mailer.send({ to: order.email, ...rendered });
    },
    { connection, concurrency: 5 },
  );

  // Without a listener BullMQ emits an unhandled `error` event, which takes the process down.
  worker.on('failed', (_job, error) => {
    deps.onError?.(error);
  });
  worker.on('error', (error) => {
    deps.onError?.(error);
  });

  return worker;
}
