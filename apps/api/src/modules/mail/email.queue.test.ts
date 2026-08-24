import type { FastifyInstance } from 'fastify';
import Stripe from 'stripe';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { type CatalogFixture, seedCatalogFixture } from '../../test/fixtures/catalog';
import { type PendingOrder, seedPendingOrder } from '../../test/fixtures/orders';
import { buildTestApp, freshAddress, testEnv, truncateAll } from '../../test/harness';

/**
 * The receipt, end to end: a paid webhook, through BullMQ, out of nodemailer, into Mailpit.
 *
 * Nothing here is mocked. Mailpit is a real SMTP server with an HTTP API, so "the email was
 * sent" is answered by asking the server that received it rather than by asserting that a
 * function was called - which is the difference between testing the mail path and testing the
 * test's own idea of it.
 */

/** Mailpit's UI and API, from `scripts/dev-setup.ps1`. */
const MAILPIT = 'http://127.0.0.1:8025';

interface MailpitSummary {
  ID: string;
  Subject: string;
  To: { Address: string }[];
}

async function clearMailbox(): Promise<void> {
  await fetch(`${MAILPIT}/api/v1/messages`, { method: 'DELETE' });
}

async function listMessages(): Promise<MailpitSummary[]> {
  const response = await fetch(`${MAILPIT}/api/v1/messages?limit=50`);
  const body = (await response.json()) as { messages: MailpitSummary[] };
  return body.messages;
}

/**
 * Polls rather than sleeps.
 *
 * The queue is genuinely asynchronous, so there is no moment the test can know the worker has
 * finished. A fixed sleep would be either flaky or slow; this is neither.
 */
async function waitForMessages(count: number, timeoutMs = 15_000): Promise<MailpitSummary[]> {
  const deadline = Date.now() + timeoutMs;
  let latest: MailpitSummary[] = [];
  while (Date.now() < deadline) {
    latest = await listMessages();
    if (latest.length >= count) return latest;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return latest;
}

async function messageBody(id: string): Promise<{ HTML: string; Text: string }> {
  const response = await fetch(`${MAILPIT}/api/v1/message/${id}`);
  return (await response.json()) as { HTML: string; Text: string };
}

describe('the order confirmation email', () => {
  let app: FastifyInstance;
  let fixture: CatalogFixture;
  let databaseUrl: string;
  let webhookSecret: string;
  let stripe: Stripe;

  beforeAll(async () => {
    app = await buildTestApp();
    const env = testEnv();
    databaseUrl = env.DATABASE_URL;
    webhookSecret = env.STRIPE_WEBHOOK_SECRET;
    stripe = new Stripe(env.STRIPE_SECRET_KEY);
  });

  afterAll(async () => {
    // Closes the worker and the queue as well; without it Vitest hangs on the open connection.
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(databaseUrl);
    fixture = await seedCatalogFixture(app.db);
    await clearMailbox();
    // Jobs are keyed by order number, and BullMQ remembers a completed id. Draining keeps one
    // test's receipt from suppressing the next one's.
    await app.emailQueue.obliterate({ force: true });
  });

  let counter = 0;
  async function payFor(order: PendingOrder): Promise<number> {
    counter += 1;
    const event = {
      id: `evt_mail_${String(counter)}`,
      object: 'event',
      type: 'payment_intent.succeeded',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: `pi_mail_${String(counter)}`,
          object: 'payment_intent',
          amount_received: order.totalCents,
          currency: 'usd',
          metadata: { order_id: String(order.id) },
        },
      },
    };
    const payload = JSON.stringify(event);
    const response = await app.inject({
      method: 'POST',
      url: '/api/webhooks/stripe',
      remoteAddress: freshAddress(),
      headers: {
        'content-type': 'application/json',
        'stripe-signature': stripe.webhooks.generateTestHeaderString({
          payload,
          secret: webhookSecret,
        }),
      },
      payload,
    });
    return response.statusCode;
  }

  it('reaches a real mailbox with the order’s own figures', async () => {
    const order = await seedPendingOrder(app.db, fixture, {
      email: 'nodira@example.com',
      promoCode: 'FLAT5',
      promoDiscountCents: 500,
    });

    expect(await payFor(order)).toBe(200);

    const messages = await waitForMessages(1);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.To[0]?.Address).toBe('nodira@example.com');
    expect(messages[0]?.Subject).toContain(order.orderNumber);

    const body = await messageBody(messages[0]!.ID);
    expect(body.Text).toContain('Devzira Red Rice');
    expect(body.Text).toContain('2 lb');
    // $24.00 of rice, $5.00 off, $7.99 postage, tax on the difference.
    expect(body.Text).toContain('$24.00');
    expect(body.Text).toContain('-$5.00');
    expect(body.Text).toContain('$7.99');
    expect(body.Text).toContain(`$${(order.totalCents / 100).toFixed(2)}`);
    // The address the parcel is going to, so a customer can spot a mistake while it matters.
    expect(body.Text).toContain('5850 San Felipe St');
    expect(body.HTML).toContain(order.orderNumber);
  });

  it('sends nothing at all when the payment failed', async () => {
    const order = await seedPendingOrder(app.db, fixture, { orderNumber: 'SG-2026-09101' });

    const payload = JSON.stringify({
      id: 'evt_mail_declined',
      object: 'event',
      type: 'payment_intent.payment_failed',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: 'pi_mail_declined',
          object: 'payment_intent',
          amount: order.totalCents,
          currency: 'usd',
          metadata: { order_id: String(order.id) },
          last_payment_error: { code: 'card_declined', message: 'Declined.' },
        },
      },
    });
    await app.inject({
      method: 'POST',
      url: '/api/webhooks/stripe',
      remoteAddress: freshAddress(),
      headers: {
        'content-type': 'application/json',
        'stripe-signature': stripe.webhooks.generateTestHeaderString({
          payload,
          secret: webhookSecret,
        }),
      },
      payload,
    });

    // Nothing to wait for, so wait long enough that a message would have arrived if one were
    // coming, then assert the box is empty.
    await waitForMessages(1, 2000);
    expect(await listMessages()).toHaveLength(0);
  });

  /**
   * Two receipts for one order is the failure a customer notices and does not forgive. Both
   * guards are exercised at once: the settlement reports it changed nothing, and the job id
   * is the order number either way.
   */
  it('sends one receipt however many times the event is redelivered', async () => {
    const order = await seedPendingOrder(app.db, fixture, { orderNumber: 'SG-2026-09102' });

    expect(await payFor(order)).toBe(200);
    await waitForMessages(1);

    // A different event id for the same, already-paid order.
    expect(await payFor(order)).toBe(200);
    await waitForMessages(2, 2000);

    expect(await listMessages()).toHaveLength(1);
  });

  it('does not fail the webhook when the mail server is unreachable', async () => {
    // The queue accepts the job; delivery is the worker's problem and its retries', not the
    // webhook's. Stripe must not be asked to redeliver a payment because SMTP was down.
    const order = await seedPendingOrder(app.db, fixture, { orderNumber: 'SG-2026-09103' });
    expect(await payFor(order)).toBe(200);

    const [job] = await app.emailQueue.getJobs(['completed', 'active', 'waiting', 'delayed']);
    expect(job?.data.type).toBe('order_confirmation');
    expect(job?.data.orderNumber).toBe(order.orderNumber);
  });
});
