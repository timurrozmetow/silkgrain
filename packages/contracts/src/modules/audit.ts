import { z } from 'zod';

import { AdminRole, AuditAction, AuditEntityType } from '../enums';
import { Id, IsoDate } from '../primitives';

/**
 * Reading the audit log.
 *
 * The screen answers three questions and is filtered for exactly those: "why is this order like
 * this", "what did this person do last Tuesday", and "who has been touching prices and settings".
 * A generic log viewer with a control per column would answer all three badly and cost more.
 *
 * Two shapes, not one. The list carries the names of the fields that moved and not their values,
 * because a page of fifty entries each hauling a full before/after is a slow screen nobody reads;
 * the values arrive when a row is expanded. That also keeps the widest payload - a bulk price
 * change over hundreds of SKUs - out of the list response entirely.
 */

/**
 * A stored value.
 *
 * `unknown` rather than a union, because the payload is JSON written by nine different projectors
 * and a schema that enumerated the shapes would be a fourth place they are described. The panel
 * decides how to render each value from its key, which is where that knowledge belongs.
 */
export const AuditFieldMap = z.record(z.string(), z.unknown()).nullable();
export type AuditFieldMap = z.infer<typeof AuditFieldMap>;

/**
 * A row in the log, without its payload.
 *
 * `actorId` is nullable and `actorName` is not: the foreign key is `ON DELETE SET NULL` and the
 * name is a copy, so an entry still says who after the account is gone. `actorRole` is the
 * authority the action was taken with, which is not the role that account holds now.
 */
export const AdminAuditRow = z.object({
  id: Id,
  createdAt: IsoDate,
  actorId: Id.nullable(),
  actorName: z.string(),
  actorRole: AdminRole,
  action: AuditAction,
  entityType: AuditEntityType,
  entityId: Id.nullable(),
  /** What the row was called at the time, so an entry is legible without a join. */
  entityLabel: z.string().nullable(),
  /** The names of the fields that moved. The values come with the detail. */
  changedFields: z.array(z.string()),
  note: z.string().nullable(),
});
export type AdminAuditRow = z.infer<typeof AdminAuditRow>;

/** One entry in full, fetched when a row is expanded. */
export const AdminAuditEntry = AdminAuditRow.extend({
  before: AuditFieldMap,
  after: AuditFieldMap,
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
});
export type AdminAuditEntry = z.infer<typeof AdminAuditEntry>;

/**
 * The filters, and the cursor.
 *
 * Keyset on the id rather than offset, which departs from D-25 deliberately. That decision chose
 * offset because the catalogue's mockup showed numbered pages and because keyset cannot sort by the
 * `MIN(price)` aggregate the cards need. Neither reason survives here: nobody asks for page nine of
 * an audit log, the sort is the primary key itself, and the table only grows - so an offset scan
 * would get slower every week while a keyset seek does not. There is no `total` for the same
 * reason: counting the whole table to print a number nobody acts on is the most expensive query on
 * the screen.
 */
export const AdminAuditQuery = z
  .object({
    /** An administrator's id, or `deleted` for the entries whose account is gone. */
    actor: z.union([z.coerce.number().int().positive(), z.literal('deleted')]).optional(),
    entityType: AuditEntityType.optional(),
    entityId: z.coerce.number().int().positive().optional(),
    action: AuditAction.optional(),
    from: IsoDate.optional(),
    to: IsoDate.optional(),
    /** The id to read back from. Absent means the newest page. */
    before: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.entityId !== undefined && value.entityType === undefined) {
      // Ids are only unique within a type: product 41 and order 41 are different rows, and
      // answering with both would be a coincidence presented as a result.
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['entityType'],
        message: 'An entity id needs the type it belongs to',
      });
    }
  });
export type AdminAuditQuery = z.infer<typeof AdminAuditQuery>;

/** `nextCursor` is the id to pass back as `before`; null when the last page has been reached. */
export const AdminAuditResponse = z.object({
  items: z.array(AdminAuditRow),
  nextCursor: Id.nullable(),
});
export type AdminAuditResponse = z.infer<typeof AdminAuditResponse>;

/**
 * Who appears in the log, for the actor filter.
 *
 * Drawn from the log itself rather than from `admin_users`, because the useful list is the people
 * who have done something - including the ones whose accounts have since been deleted, which the
 * team list by definition cannot show.
 */
export const AdminAuditActor = z.object({
  actorId: Id.nullable(),
  name: z.string(),
  entryCount: z.number().int().nonnegative(),
});
export type AdminAuditActor = z.infer<typeof AdminAuditActor>;

export const AdminAuditActors = z.object({ actors: z.array(AdminAuditActor) });
export type AdminAuditActors = z.infer<typeof AdminAuditActors>;
