import { AUDIT_ACTION_ENTITY, type AuditAction } from '@silkgrain/contracts';
import { eq } from 'drizzle-orm';

import type { DbExecutor } from '../../db/client';
import { adminUsers, auditLog } from '../../db/schema';

import type { AdminActor } from './actor';
import type { AuditPayload } from './audit.diff';

/**
 * Writing down what an administrator did.
 *
 * The entry goes in **inside the caller's transaction**, which is the decision the rest of the
 * design follows from. A Fastify hook cannot see the before-image, and that image is the whole
 * point of `before`/`after`. A write after the commit can succeed while the audit fails, leaving a
 * destructive change with no record - exactly the gap the log exists to close. The codebase's own
 * precedent for staying outside a transaction is `enqueueEmail`, and it earns that by talking to an
 * independently-failing remote system; a row in the same MySQL on the same connection is not one.
 *
 * So a failed audit write fails the whole action, with no try/catch and no best effort. That is
 * only safe because the realistic failure is removed by construction: under `STRICT_TRANS_TABLES`
 * an over-long varchar is an error rather than a truncation, so every string is clamped to its
 * column before it is offered. What remains is "MySQL is unavailable", which would have failed the
 * change anyway. An unlogged privileged change is worse than a refused one.
 */

/** Column widths, so a long name or a long user-agent cannot turn a save into a 500. */
const ACTOR_NAME_MAX = 120;
const LABEL_MAX = 200;
const USER_AGENT_MAX = 400;
const IP_MAX = 45;

/**
 * The size a payload may reach before it is replaced by a note that it was too big.
 *
 * A bulk price change over a thousand variants is the case. Storing megabytes of JSON per entry
 * would make the log the largest table in the database and the list screen unusable; recording
 * that it happened, to how many rows, and by whom is what somebody actually needs.
 */
const PAYLOAD_MAX_KEYS = 2000;
const PAYLOAD_MAX_BYTES = 512 * 1024;

export interface AuditContext {
  /** From the request, for the two columns the schema already has. */
  ip: string | null;
  userAgent: string | null;
}

export interface AuditEntry {
  action: AuditAction;
  entityId: number | null;
  /** What the row was called at the time: an order number, a product name, a promo code. */
  entityLabel?: string | null;
  before: AuditPayload | null;
  after: AuditPayload | null;
  note?: string | null;
}

const clamp = (value: string | null, max: number): string | null =>
  value === null ? null : value.slice(0, max);

function capPayload(payload: AuditPayload | null): AuditPayload | null {
  if (payload === null) return null;

  const keys = Object.keys(payload).length;
  if (keys > PAYLOAD_MAX_KEYS || JSON.stringify(payload).length > PAYLOAD_MAX_BYTES) {
    // Honest about what was dropped rather than silently storing a fraction.
    return { _truncated: true, _keys: keys };
  }
  return payload;
}

/**
 * One row, on the caller's own executor.
 *
 * The actor's name is read here rather than carried on the token, because the token has no name
 * and a name copied at sign-in would be a fortnight stale. The role comes from the token, which is
 * correct: it is the authority the action was actually taken with, not the authority the account
 * has now.
 */
export async function recordAudit(
  tx: DbExecutor,
  actor: AdminActor,
  context: AuditContext,
  entry: AuditEntry,
): Promise<void> {
  const [row] = await tx
    .select({ name: adminUsers.name })
    .from(adminUsers)
    .where(eq(adminUsers.id, actor.id));

  await tx.insert(auditLog).values({
    adminUserId: actor.id,
    // An account deleted later nulls the foreign key; the copied name and role are what the entry
    // still reads by. "Unknown" is unreachable behind the guards and is not worth a throw.
    actorName: clamp(row?.name ?? 'Unknown', ACTOR_NAME_MAX) ?? 'Unknown',
    actorRole: actor.role,
    action: entry.action,
    entityType: AUDIT_ACTION_ENTITY[entry.action],
    entityId: entry.entityId,
    entityLabel: clamp(entry.entityLabel ?? null, LABEL_MAX),
    before: capPayload(entry.before),
    after: capPayload(entry.after),
    ip: clamp(context.ip, IP_MAX),
    userAgent: clamp(context.userAgent, USER_AGENT_MAX),
    note: entry.note ?? null,
  });
}
