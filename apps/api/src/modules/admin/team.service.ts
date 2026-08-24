import type {
  AdminTeamCreateInput,
  AdminTeamList,
  AdminTeamMember,
  AdminTeamUpdateInput,
} from '@silkgrain/contracts';
import { and, asc, eq, ne } from 'drizzle-orm';

import type { Database, DbExecutor } from '../../db/client';
import { adminUsers } from '../../db/schema';
import { AppError, notFound } from '../../lib/errors';
import { hashPassword } from '../../lib/password';
import { revokeAllForSubject } from '../auth/tokens';

import type { AdminActor } from './actor';
import { diffSnapshots } from './audit.diff';
import { adminUserSnapshot } from './audit.projectors';
import { type AuditContext, recordAudit } from './audit.service';

/**
 * The team, managed by the owner.
 *
 * This exists because the permission matrix needs somewhere to be administered from. Nothing could
 * write `admin_users.role` or `is_active` before it: the only way to make somebody a manager was an
 * UPDATE in Studio, which made the matrix a claim the system could not honour. That is decision
 * D-29's situation exactly, applied to authority rather than to a customer's account.
 *
 * Three guards shape everything, and all three are about the same failure - an owner locking
 * themselves or the shop out of its own back office. An owner cannot change their own role or
 * deactivate themselves, and no change may leave the shop with zero active owners.
 *
 * Accounts are created, edited and deactivated. Never deleted: deleting one nulls
 * `audit_log.admin_user_id`, orphans the wholesale notes it wrote and empties the enquiries it was
 * assigned. `is_active = false` is the terminal action, and the refresh path already honours it.
 */

function toMember(row: typeof adminUsers.$inferSelect): AdminTeamMember {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    isActive: row.isActive,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    // `passwordHash` is on the row and has no field to land in: `AdminTeamMember` has none, so the
    // serialiser could not emit one even if this function tried.
  };
}

export async function listTeam(db: Database): Promise<AdminTeamList> {
  const rows = await db
    .select()
    .from(adminUsers)
    // Active first, then by name: the people who can be given work read as a list, and the
    // departed sit below rather than interleaved.
    .orderBy(asc(adminUsers.isActive), asc(adminUsers.name));
  return { members: rows.reverse().map(toMember) };
}

/**
 * Refuses an email another account already holds.
 *
 * A pre-check rather than a caught `ER_DUP_ENTRY`, for the same reason the product writer has one:
 * a unique-index violation reaches the error handler as a 500 with no field named. The catch is
 * still there below, because the pre-check and the insert are two statements and a concurrent
 * create can land between them.
 */
async function assertEmailFree(tx: DbExecutor, email: string): Promise<void> {
  const [taken] = await tx
    .select({ id: adminUsers.id })
    .from(adminUsers)
    .where(eq(adminUsers.email, email));
  if (taken) {
    throw new AppError('CONFLICT', 'An administrator with that email already exists', {
      details: [{ path: 'email', message: 'Already taken' }],
    });
  }
}

export async function createTeamMember(
  db: Database,
  input: AdminTeamCreateInput,
  actor: AdminActor,
  context: AuditContext,
): Promise<AdminTeamMember> {
  const passwordHash = await hashPassword(input.password);

  const id = await db.transaction(async (tx) => {
    await assertEmailFree(tx, input.email);
    try {
      const [row] = await tx
        .insert(adminUsers)
        .values({
          email: input.email,
          name: input.name,
          role: input.role,
          passwordHash,
          isActive: true,
        })
        .$returningId();
      if (!row) throw new AppError('INTERNAL', 'The administrator row was not inserted');

      const [created] = await tx.select().from(adminUsers).where(eq(adminUsers.id, row.id));
      await recordAudit(tx, actor, context, {
        action: 'admin_user.created',
        entityId: row.id,
        entityLabel: input.email,
        before: null,
        after: created ? adminUserSnapshot(created) : null,
      });
      return row.id;
    } catch (error) {
      // The window between the pre-check and the insert.
      if ((error as { code?: string }).code === 'ER_DUP_ENTRY') {
        throw new AppError('CONFLICT', 'An administrator with that email already exists', {
          details: [{ path: 'email', message: 'Already taken' }],
        });
      }
      throw error;
    }
  });

  return getTeamMember(db, id);
}

export async function getTeamMember(db: Database, id: number): Promise<AdminTeamMember> {
  const [row] = await db.select().from(adminUsers).where(eq(adminUsers.id, id));
  if (!row) throw notFound('Administrator');
  return toMember(row);
}

/**
 * Renames, re-roles or retires an account.
 *
 * The self-rules are checked before the transaction: they are about who is asking, not about what
 * the table holds, and refusing early keeps a doomed request off a row lock. The last-owner rule is
 * checked inside it, under `FOR UPDATE`, because serially the self-rules already guarantee a
 * survivor - only an owner reaches this route and cannot touch their own row - and the lock is what
 * makes that true when two owners demote each other at once.
 */
export async function updateTeamMember(
  db: Database,
  id: number,
  input: AdminTeamUpdateInput,
  actor: AdminActor,
  context: AuditContext,
): Promise<AdminTeamMember> {
  if (id === actor.id) {
    if (input.role !== undefined) {
      throw new AppError('CONFLICT', 'You cannot change your own role');
    }
    if (input.isActive === false) {
      throw new AppError('CONFLICT', 'You cannot deactivate your own account');
    }
  }

  await db.transaction(async (tx) => {
    const [target] = await tx.select().from(adminUsers).where(eq(adminUsers.id, id)).for('update');
    if (!target) throw notFound('Administrator');

    // Would this change remove the last active owner?
    const losesOwner =
      target.role === 'owner' &&
      target.isActive &&
      ((input.role !== undefined && input.role !== 'owner') || input.isActive === false);

    if (losesOwner) {
      const survivors = await tx
        .select({ id: adminUsers.id })
        .from(adminUsers)
        .where(
          and(eq(adminUsers.role, 'owner'), eq(adminUsers.isActive, true), ne(adminUsers.id, id)),
        )
        .for('update');
      if (survivors.length === 0) {
        throw new AppError('CONFLICT', 'The shop would be left with no active owner');
      }
    }

    await tx
      .update(adminUsers)
      .set({
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.role === undefined ? {} : { role: input.role }),
        ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
      })
      .where(eq(adminUsers.id, id));

    /**
     * A reduction in authority revokes; a promotion does not.
     *
     * Deactivating, or moving somebody down, must not leave them holding a fifteen-minute token
     * that still carries the old role - that is the window `requireFreshPermission` closes for
     * `team:manage` and that revocation closes for everything else. A promotion is the opposite
     * case: the person is trusted with more, and signing them out to tell them so is rude and
     * buys nothing, because their next refresh re-reads the row anyway.
     */
    const demoted =
      input.isActive === false ||
      (input.role !== undefined && rank(input.role) < rank(target.role));

    if (demoted) await revokeAllForSubject(tx, 'admin', id, 'authority reduced');

    const [after] = await tx.select().from(adminUsers).where(eq(adminUsers.id, id));
    const delta = after && diffSnapshots(adminUserSnapshot(target), adminUserSnapshot(after));
    if (delta) {
      await recordAudit(tx, actor, context, {
        action: 'admin_user.updated',
        entityId: id,
        entityLabel: target.email,
        before: delta.before,
        after: delta.after,
      });
    }
  });

  return getTeamMember(db, id);
}

/** Owner over manager over support. Only used to tell a demotion from a promotion. */
function rank(role: 'owner' | 'manager' | 'support'): number {
  return role === 'owner' ? 3 : role === 'manager' ? 2 : 1;
}

/**
 * The owner resetting somebody else's password.
 *
 * Never their own, and this is the gap rather than the design. An earlier draft of this comment
 * said self-service went through `PATCH /api/auth/admin/password` "which asks for the current one".
 * That route does not exist - it is named nowhere in `apps/` but here - so an administrator has no
 * way at all to change their own password, and the refusal below used to send them to a screen that
 * was never built. What actually works today is another owner resetting it, which is why the
 * message says so. It is in `BACKLOG.md`; the route it describes is the right shape when it lands.
 *
 * Resetting always revokes, so a password changed because it may have leaked also ends every
 * session it may have leaked into.
 */
export async function resetTeamPassword(
  db: Database,
  id: number,
  password: string,
  actor: AdminActor,
  context: AuditContext,
): Promise<void> {
  if (id === actor.id) {
    throw new AppError(
      'CONFLICT',
      'You cannot reset your own password here. Ask another owner to reset it for you.',
    );
  }

  const passwordHash = await hashPassword(password);

  await db.transaction(async (tx) => {
    const [target] = await tx
      .select({ id: adminUsers.id, email: adminUsers.email })
      .from(adminUsers)
      .where(eq(adminUsers.id, id))
      .for('update');
    if (!target) throw notFound('Administrator');

    await tx.update(adminUsers).set({ passwordHash }).where(eq(adminUsers.id, id));
    await revokeAllForSubject(tx, 'admin', id, 'password reset by an owner');

    // That it happened, to whom, by whom. Neither the old hash nor the new one, obviously - and
    // there is no field on the entry for one to land in even by accident.
    await recordAudit(tx, actor, context, {
      action: 'admin_user.password_reset',
      entityId: id,
      entityLabel: target.email,
      before: null,
      after: null,
    });
  });
}
