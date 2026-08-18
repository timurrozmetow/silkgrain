import type {
  AdminAuditActors,
  AdminAuditEntry,
  AdminAuditQuery,
  AdminAuditResponse,
  AdminAuditRow,
} from '@silkgrain/contracts';
import { and, count, desc, eq, gte, isNull, lt, lte, sql } from 'drizzle-orm';

import type { Database } from '../../db/client';
import { auditLog } from '../../db/schema';
import { notFound } from '../../lib/errors';

/**
 * Reading the log back.
 *
 * Keyset on the id, newest first. `limit + 1` rows are fetched and the extra one is dropped: that
 * is how the cursor knows whether there is another page without a second query and without a
 * `COUNT(*)` over a table that only grows.
 *
 * The list carries the names of the fields that moved rather than their values. Fifty entries each
 * hauling a full before/after is a slow screen, and the widest payload here - a bulk price change
 * over hundreds of SKUs - would dominate every page it appeared on. The values arrive with the
 * detail, when somebody actually expands the row.
 */

type Row = typeof auditLog.$inferSelect;

/** The keys that moved, taken from whichever side has them. */
function changedFields(row: Row): string[] {
  const source = row.after ?? row.before;
  if (source === null || typeof source !== 'object') return [];
  return Object.keys(source);
}

function toRow(row: Row): AdminAuditRow {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    actorId: row.adminUserId,
    actorName: row.actorName,
    // The column is a plain varchar so an old row cannot 500 the screen; anything unexpected reads
    // as `support`, the least authority, rather than as a crash.
    actorRole: row.actorRole === 'owner' || row.actorRole === 'manager' ? row.actorRole : 'support',
    action: row.action as AdminAuditRow['action'],
    entityType: row.entityType as AdminAuditRow['entityType'],
    entityId: row.entityId,
    entityLabel: row.entityLabel,
    changedFields: changedFields(row),
    note: row.note,
  };
}

function filtersFor(query: AdminAuditQuery) {
  const filters = [];

  if (query.actor === 'deleted') filters.push(isNull(auditLog.adminUserId));
  else if (query.actor !== undefined) filters.push(eq(auditLog.adminUserId, query.actor));

  if (query.entityType !== undefined) filters.push(eq(auditLog.entityType, query.entityType));
  if (query.entityId !== undefined) filters.push(eq(auditLog.entityId, query.entityId));
  if (query.action !== undefined) filters.push(eq(auditLog.action, query.action));
  if (query.from !== undefined) filters.push(gte(auditLog.createdAt, new Date(query.from)));
  if (query.to !== undefined) filters.push(lte(auditLog.createdAt, new Date(query.to)));
  // The cursor. Ids are monotonic, so "older than this row" is "a smaller id" - and unlike a
  // timestamp cursor it cannot skip or repeat rows written in the same second.
  if (query.before !== undefined) filters.push(lt(auditLog.id, query.before));

  return filters.length === 0 ? undefined : and(...filters);
}

export async function listAudit(db: Database, query: AdminAuditQuery): Promise<AdminAuditResponse> {
  const rows = await db
    .select()
    .from(auditLog)
    .where(filtersFor(query))
    .orderBy(desc(auditLog.id))
    // One more than asked for: its existence is the answer to "is there another page".
    .limit(query.limit + 1);

  const page = rows.slice(0, query.limit);
  const nextCursor = rows.length > query.limit ? (page.at(-1)?.id ?? null) : null;

  return { items: page.map(toRow), nextCursor };
}

export async function getAuditEntry(db: Database, id: number): Promise<AdminAuditEntry> {
  const [row] = await db.select().from(auditLog).where(eq(auditLog.id, id));
  if (!row) throw notFound('Audit entry');

  return {
    ...toRow(row),
    before: (row.before ?? null) as AdminAuditEntry['before'],
    after: (row.after ?? null) as AdminAuditEntry['after'],
    ip: row.ip,
    userAgent: row.userAgent,
  };
}

/**
 * Who appears in the log.
 *
 * Grouped on the id and the copied name together, so an account that was renamed shows both names
 * it acted under rather than collapsing history into whichever one is current. Deleted accounts
 * group under a null id, which is the one thing the team list can never show.
 */
export async function listAuditActors(db: Database): Promise<AdminAuditActors> {
  const rows = await db
    .select({
      actorId: auditLog.adminUserId,
      name: auditLog.actorName,
      entryCount: count(),
    })
    .from(auditLog)
    .groupBy(auditLog.adminUserId, auditLog.actorName)
    .orderBy(sql`count(*) DESC`);

  return {
    actors: rows.map((row) => ({
      actorId: row.actorId,
      name: row.name,
      entryCount: row.entryCount,
    })),
  };
}
