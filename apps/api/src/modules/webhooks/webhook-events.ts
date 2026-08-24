import type { PaymentProvider } from '@silkgrain/contracts';
import { and, eq, sql } from 'drizzle-orm';

import type { Database } from '../../db/client';
import { webhookEvents } from '../../db/schema';

/**
 * Webhook idempotency.
 *
 * The unique index on `(provider, event_id)` is the whole mechanism. The row is written before
 * the event is acted on, so a duplicate delivery cannot reach the handler twice - and because
 * a provider repeats an event until it is acknowledged, duplicates are ordinary traffic rather
 * than an attack.
 *
 * The claim is deliberately not "the row exists, therefore stop". A first attempt that failed
 * halfway leaves a row with no `processed_at`, and refusing to retry that would strand an
 * order the provider has already taken money for. Only a *completed* event is a no-op.
 */

export type WebhookClaim =
  { status: 'already_processed' } | { status: 'claimed'; id: number; attempt: number };

export async function claimWebhookEvent(
  db: Database,
  provider: PaymentProvider,
  eventId: string,
  eventType: string,
  payload: unknown,
): Promise<WebhookClaim> {
  await db
    .insert(webhookEvents)
    .values({ provider, eventId, eventType, payload, attempts: 1 })
    .onDuplicateKeyUpdate({ set: { attempts: sql`${webhookEvents.attempts} + 1` } });

  const [row] = await db
    .select({
      id: webhookEvents.id,
      processedAt: webhookEvents.processedAt,
      attempts: webhookEvents.attempts,
    })
    .from(webhookEvents)
    .where(and(eq(webhookEvents.provider, provider), eq(webhookEvents.eventId, eventId)));

  if (!row) {
    // The row was inserted a statement ago; if it is gone, something is deleting rows from
    // under us and pretending the event is new would be worse than failing loudly.
    throw new Error(`webhook_events row for ${provider}/${eventId} vanished after insert`);
  }

  if (row.processedAt !== null) return { status: 'already_processed' };
  return { status: 'claimed', id: row.id, attempt: row.attempts };
}

export async function completeWebhookEvent(db: Database, id: number): Promise<void> {
  await db
    .update(webhookEvents)
    .set({ processedAt: new Date(), error: null })
    .where(eq(webhookEvents.id, id));
}

/**
 * Records why an attempt failed, outside the transaction that failed.
 *
 * Phase 2 taught this the hard way: throwing out of a Drizzle transaction rolls back the very
 * row the rejection was written to record. The handler catches first, then calls this.
 */
export async function failWebhookEvent(db: Database, id: number, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await db.update(webhookEvents).set({ error: message }).where(eq(webhookEvents.id, id));
}
