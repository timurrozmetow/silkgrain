import {
  type AdminUserOption,
  type AdminWholesaleDetail,
  type AdminWholesaleListQuery,
  type AdminWholesaleListResponse,
  type AdminWholesaleNote,
  type AdminWholesaleRow,
  type AdminWholesaleTriageInput,
  pageBounds,
  pageMeta,
} from '@silkgrain/contracts';
import { and, asc, count, desc, eq, inArray, isNull, like, or } from 'drizzle-orm';

import type { Database } from '../../db/client';
import { adminUsers, wholesaleRequestNotes, wholesaleRequests } from '../../db/schema';
import { AppError, notFound } from '../../lib/errors';

/**
 * Wholesale enquiries, from the desk that answers them.
 *
 * An enquiry is a conversation, not a record to be corrected, so the thread is append-only and each
 * note carries the name of whoever wrote it - copied, not joined, so it still says who after that
 * account is gone. Status and assignee move together, because taking an enquiry and marking it
 * contacted is one action to the person doing it.
 *
 * `submitted_ip` is stored by the public form and never leaves this service. It is there for
 * investigating a flood of junk, which is a database question; a panel printing it beside somebody's
 * business name is a different thing entirely.
 */

const contactName = (first: string, last: string | null) => `${first} ${last ?? ''}`.trim();

export async function listWholesaleRequests(
  db: Database,
  query: AdminWholesaleListQuery,
): Promise<AdminWholesaleListResponse> {
  const filters = [];

  if (query.q !== undefined && query.q !== '') {
    const pattern = `%${query.q}%`;
    filters.push(
      or(like(wholesaleRequests.businessName, pattern), like(wholesaleRequests.email, pattern)),
    );
  }
  if (query.status !== 'all') filters.push(eq(wholesaleRequests.status, query.status));
  if (query.unassigned === true) filters.push(isNull(wholesaleRequests.assignedToId));

  const where = filters.length === 0 ? undefined : and(...filters);
  const { limit, offset } = pageBounds(query);

  const [rows, [totals]] = await Promise.all([
    db
      .select({
        id: wholesaleRequests.id,
        businessName: wholesaleRequests.businessName,
        businessType: wholesaleRequests.businessType,
        contactFirstName: wholesaleRequests.contactFirstName,
        contactLastName: wholesaleRequests.contactLastName,
        email: wholesaleRequests.email,
        phone: wholesaleRequests.phone,
        monthlyVolumeBand: wholesaleRequests.monthlyVolumeBand,
        status: wholesaleRequests.status,
        assignedToName: adminUsers.name,
        createdAt: wholesaleRequests.createdAt,
      })
      .from(wholesaleRequests)
      .leftJoin(adminUsers, eq(adminUsers.id, wholesaleRequests.assignedToId))
      // Oldest first within a status would be the fairer queue, but a desk works from what just
      // arrived, and the status filter is how somebody digs into the backlog.
      .orderBy(desc(wholesaleRequests.createdAt), desc(wholesaleRequests.id))
      .where(where)
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(wholesaleRequests).where(where),
  ]);

  const counts = await noteCounts(
    db,
    rows.map((row) => row.id),
  );

  const items: AdminWholesaleRow[] = rows.map((row) => ({
    id: row.id,
    businessName: row.businessName,
    businessType: row.businessType,
    contactName: contactName(row.contactFirstName, row.contactLastName),
    email: row.email,
    phone: row.phone,
    monthlyVolumeBand: row.monthlyVolumeBand,
    status: row.status,
    assignedToName: row.assignedToName,
    noteCount: counts.get(row.id) ?? 0,
    createdAt: row.createdAt.toISOString(),
  }));

  return { items, meta: pageMeta(query.page, query.perPage, totals?.total ?? 0) };
}

/** Note counts for one page of ids. A join would multiply the rows and break the page count. */
async function noteCounts(db: Database, ids: number[]): Promise<Map<number, number>> {
  const counts = new Map<number, number>();
  if (ids.length === 0) return counts;

  const rows = await db
    .select({ requestId: wholesaleRequestNotes.requestId, notes: count() })
    .from(wholesaleRequestNotes)
    .where(inArray(wholesaleRequestNotes.requestId, ids))
    .groupBy(wholesaleRequestNotes.requestId);

  for (const row of rows) counts.set(row.requestId, row.notes);
  return counts;
}

export async function getWholesaleRequest(db: Database, id: number): Promise<AdminWholesaleDetail> {
  const [row] = await db.select().from(wholesaleRequests).where(eq(wholesaleRequests.id, id));
  if (!row) throw notFound('Wholesale request');

  const [assignee, thread] = await Promise.all([
    row.assignedToId === null
      ? Promise.resolve([])
      : db
          .select({ name: adminUsers.name })
          .from(adminUsers)
          .where(eq(adminUsers.id, row.assignedToId)),
    db
      .select()
      .from(wholesaleRequestNotes)
      .where(eq(wholesaleRequestNotes.requestId, id))
      .orderBy(asc(wholesaleRequestNotes.createdAt), asc(wholesaleRequestNotes.id)),
  ]);

  const notes: AdminWholesaleNote[] = thread.map((note) => ({
    id: note.id,
    authorName: note.authorName,
    body: note.body,
    createdAt: note.createdAt.toISOString(),
  }));

  return {
    id: row.id,
    businessName: row.businessName,
    businessType: row.businessType,
    contactName: contactName(row.contactFirstName, row.contactLastName),
    email: row.email,
    phone: row.phone,
    monthlyVolumeBand: row.monthlyVolumeBand,
    status: row.status,
    assignedToId: row.assignedToId,
    assignedToName: assignee[0]?.name ?? null,
    noteCount: notes.length,
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2,
    city: row.city,
    state: row.state,
    zip: row.zip,
    categoriesOfInterest: row.categoriesOfInterest ?? [],
    notes: row.notes,
    thread: notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Sets the status, the assignee, or both.
 *
 * Any status may follow any other: unlike an order, an enquiry has no money or stock behind it, and
 * a conversation that was marked `declined` in error and then revives is an ordinary Tuesday. The
 * assignee is checked against the admin table, so a stale id from a colleague's open tab cannot
 * assign work to somebody who no longer exists.
 */
export async function triageWholesaleRequest(
  db: Database,
  id: number,
  input: AdminWholesaleTriageInput,
): Promise<AdminWholesaleDetail> {
  const [row] = await db
    .select({ id: wholesaleRequests.id })
    .from(wholesaleRequests)
    .where(eq(wholesaleRequests.id, id));
  if (!row) throw notFound('Wholesale request');

  if (input.assignedToId !== undefined && input.assignedToId !== null) {
    const [assignee] = await db
      .select({ id: adminUsers.id })
      .from(adminUsers)
      .where(and(eq(adminUsers.id, input.assignedToId), eq(adminUsers.isActive, true)));
    if (!assignee) throw new AppError('VALIDATION_FAILED', 'No active administrator with that id');
  }

  await db
    .update(wholesaleRequests)
    .set({
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.assignedToId === undefined ? {} : { assignedToId: input.assignedToId }),
    })
    .where(eq(wholesaleRequests.id, id));

  return getWholesaleRequest(db, id);
}

/**
 * Appends a note, stamped with the author's name.
 *
 * The name is read once and copied into the row. The foreign key is kept as well, so the two can be
 * reconciled, but it is `ON DELETE SET NULL` and the copy is what the thread actually reads.
 */
export async function addWholesaleNote(
  db: Database,
  id: number,
  adminUserId: number,
  body: string,
): Promise<AdminWholesaleDetail> {
  const [row] = await db
    .select({ id: wholesaleRequests.id })
    .from(wholesaleRequests)
    .where(eq(wholesaleRequests.id, id));
  if (!row) throw notFound('Wholesale request');

  const [author] = await db
    .select({ name: adminUsers.name })
    .from(adminUsers)
    .where(eq(adminUsers.id, adminUserId));
  if (!author) throw notFound('Administrator');

  await db.insert(wholesaleRequestNotes).values({
    requestId: id,
    adminUserId,
    authorName: author.name,
    body,
  });

  return getWholesaleRequest(db, id);
}

/** The team, for the assignee picker. Inactive accounts are left out: they cannot be given work. */
export async function listAdminUsers(db: Database): Promise<AdminUserOption[]> {
  return db
    .select({ id: adminUsers.id, name: adminUsers.name, role: adminUsers.role })
    .from(adminUsers)
    .where(eq(adminUsers.isActive, true))
    .orderBy(asc(adminUsers.name));
}
