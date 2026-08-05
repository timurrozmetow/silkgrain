import type { Queue } from 'bullmq';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import type { Env } from '../env';
import {
  type EmailJob,
  createEmailQueue,
  createEmailWorker,
  jobIdFor,
} from '../modules/mail/email.queue';
import { createMailer } from '../modules/mail/mailer';

declare module 'fastify' {
  interface FastifyInstance {
    /**
     * Hands a message to the queue and returns. Never throws into a request: a receipt that
     * could not be enqueued must not undo a payment that succeeded.
     */
    enqueueEmail: (job: EmailJob) => Promise<void>;
    emailQueue: Queue<EmailJob>;
  }
}

export interface MailOptions {
  env: Env;
}

/**
 * The queue and the worker in one process.
 *
 * Right for this deployment - a single VPS running PM2 - and the reason the worker is created
 * here rather than in a separate entry point. If mail volume ever justifies its own process,
 * the split is this plugin registering only the queue and `server.ts` gaining a sibling that
 * registers only the worker; nothing else moves.
 *
 * The worker gets a duplicated connection. BullMQ blocks on it waiting for jobs, and a
 * connection that is blocking cannot also answer the rate limiter's `INCR`.
 */
export const mailPlugin = fp<MailOptions>(
  // eslint-disable-next-line @typescript-eslint/require-await -- fastify-plugin expects a promise
  async function mail(app: FastifyInstance, { env }) {
    const mailer = createMailer(env);
    const queue = createEmailQueue(app.redis);
    const worker = createEmailWorker(app.redis.duplicate(), {
      db: app.db,
      mailer,
      env,
      onError: (error) => {
        app.log.error({ err: error }, 'email job failed');
      },
    });

    app.decorate('emailQueue', queue);
    app.decorate('enqueueEmail', async (job: EmailJob): Promise<void> => {
      try {
        await queue.add(job.type, job, { jobId: jobIdFor(job) });
      } catch (error) {
        // Swallowed on purpose, and loudly. The caller is the payment webhook; failing there
        // would ask Stripe to redeliver an event whose real work - the money and the stock -
        // is already committed, and the second attempt would find the order paid and send
        // nothing anyway. A missing receipt is a support ticket; a redelivery loop is worse.
        app.log.error({ err: error, job }, 'could not enqueue email');
      }
    });

    app.addHook('onClose', async () => {
      // Order matters: stop taking work, then stop the transport.
      await worker.close();
      await queue.close();
      await mailer.close();
    });
  },
  { name: 'silkgrain-mail', dependencies: ['silkgrain-redis', 'silkgrain-database'] },
);
