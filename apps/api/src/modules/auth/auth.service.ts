import type {
  AdminProfile,
  CustomerProfile,
  LoginInput,
  RegisterInput,
  SubjectType,
} from '@silkgrain/contracts';
import { and, eq } from 'drizzle-orm';

import type { Database } from '../../db/client';
import { adminUsers, customers, refreshTokens } from '../../db/schema';
import { AppError, conflict, unauthorized } from '../../lib/errors';
import { equaliseTiming, hashPassword, verifyPassword } from '../../lib/password';

import {
  hashRefreshToken,
  issueRefreshToken,
  type IssuedRefreshToken,
  type RefreshTokenContext,
  revokeAllForSubject,
  revokeFamily,
} from './tokens';

export interface AuthDeps {
  db: Database;
  refreshSecret: string;
  refreshTtlSeconds: number;
}

export function toCustomerProfile(row: typeof customers.$inferSelect): CustomerProfile {
  return {
    id: row.id,
    email: row.email,
    firstName: row.firstName,
    lastName: row.lastName,
    phone: row.phone,
    marketingOptIn: row.marketingOptIn,
    emailVerified: row.emailVerifiedAt !== null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toAdminProfile(row: typeof adminUsers.$inferSelect): AdminProfile {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
  };
}

/**
 * Creates a customer, or claims the row a guest checkout already made.
 *
 * A guest order creates a `customers` row with a null `password_hash`; registering with that
 * same address later sets the password instead of failing, which is how the confirmation
 * screen's one-click account creation works without a second code path.
 */
export async function registerCustomer(
  deps: AuthDeps,
  input: RegisterInput,
): Promise<typeof customers.$inferSelect> {
  const existing = await deps.db.query.customers.findFirst({
    where: eq(customers.email, input.email),
  });

  const passwordHash = await hashPassword(input.password);

  if (existing) {
    if (existing.passwordHash !== null) {
      throw conflict('An account with this email already exists');
    }
    await deps.db
      .update(customers)
      .set({
        passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
        phone: input.phone ?? existing.phone,
        marketingOptIn: input.marketingOptIn,
      })
      .where(eq(customers.id, existing.id));

    const claimed = await deps.db.query.customers.findFirst({
      where: eq(customers.id, existing.id),
    });
    if (!claimed) throw new AppError('INTERNAL', 'Customer disappeared during registration');
    return claimed;
  }

  await deps.db.insert(customers).values({
    email: input.email,
    passwordHash,
    firstName: input.firstName,
    lastName: input.lastName,
    phone: input.phone ?? null,
    marketingOptIn: input.marketingOptIn,
  });

  const created = await deps.db.query.customers.findFirst({
    where: eq(customers.email, input.email),
  });
  if (!created) throw new AppError('INTERNAL', 'Customer was not persisted');
  return created;
}

/**
 * Verifies customer credentials.
 *
 * Every failure returns the same message and takes the same time. Distinguishing "no such
 * account" from "wrong password" - in the text or in the latency - hands an attacker a
 * working customer list before they have guessed a single password.
 */
export async function loginCustomer(
  deps: AuthDeps,
  input: LoginInput,
): Promise<typeof customers.$inferSelect> {
  const row = await deps.db.query.customers.findFirst({ where: eq(customers.email, input.email) });

  if (!row?.passwordHash) {
    await equaliseTiming();
    throw unauthorized('Email or password is incorrect');
  }
  if (!(await verifyPassword(row.passwordHash, input.password))) {
    throw unauthorized('Email or password is incorrect');
  }
  if (row.status === 'blocked') {
    throw new AppError('FORBIDDEN', 'This account has been suspended');
  }

  await deps.db.update(customers).set({ lastLoginAt: new Date() }).where(eq(customers.id, row.id));

  return row;
}

export async function loginAdmin(
  deps: AuthDeps,
  input: LoginInput,
): Promise<typeof adminUsers.$inferSelect> {
  const row = await deps.db.query.adminUsers.findFirst({
    where: eq(adminUsers.email, input.email),
  });

  if (!row) {
    await equaliseTiming();
    throw unauthorized('Email or password is incorrect');
  }
  if (!(await verifyPassword(row.passwordHash, input.password))) {
    throw unauthorized('Email or password is incorrect');
  }
  if (!row.isActive) {
    throw new AppError('FORBIDDEN', 'This account is disabled');
  }

  const lastLoginAt = new Date();
  await deps.db.update(adminUsers).set({ lastLoginAt }).where(eq(adminUsers.id, row.id));

  return { ...row, lastLoginAt };
}

export interface RotationResult {
  subjectType: SubjectType;
  subjectId: number;
  issued: IssuedRefreshToken;
}

/**
 * Exchanges a refresh token for a fresh one and reports who it belonged to.
 *
 * The whole thing runs in one transaction with the row locked, because two tabs refreshing at
 * the same moment would otherwise both pass the "not yet revoked" check, both rotate, and the
 * second one would look exactly like a replay attack and kill a legitimate session.
 *
 * A token that is presented after it has already been rotated is treated as theft: the entire
 * family is revoked. The legitimate client holds the newest token, so the only way to present
 * an old one is to have copied it.
 */
export async function rotateRefreshToken(
  deps: AuthDeps,
  presentedToken: string,
  context: RefreshTokenContext,
): Promise<RotationResult> {
  const tokenHash = hashRefreshToken(presentedToken, deps.refreshSecret);

  /**
   * The transaction reports a verdict instead of throwing.
   *
   * Throwing out of a Drizzle transaction rolls it back, which would have undone the very
   * revocation the rejection is there to perform: the replayed token would be refused once
   * and the stolen family would stay alive. The bookkeeping for the two failure cases
   * therefore happens after the transaction commits.
   */
  type Verdict =
    | { kind: 'rotated'; result: RotationResult }
    | { kind: 'unknown' }
    | { kind: 'reuse'; familyId: string }
    | { kind: 'expired'; id: number };

  const verdict = await deps.db.transaction<Verdict>(async (tx) => {
    const [row] = await tx
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .for('update')
      .limit(1);

    if (!row) return { kind: 'unknown' };
    if (row.revokedAt !== null) return { kind: 'reuse', familyId: row.familyId };
    if (row.expiresAt.getTime() <= Date.now()) return { kind: 'expired', id: row.id };

    await tx
      .update(refreshTokens)
      .set({ revokedAt: new Date(), revokedReason: 'rotated' })
      .where(eq(refreshTokens.id, row.id));

    const issued = await issueRefreshToken(tx, {
      subjectType: row.subjectType,
      subjectId: row.subjectId,
      ttlSeconds: deps.refreshTtlSeconds,
      secret: deps.refreshSecret,
      familyId: row.familyId,
      context,
    });

    return {
      kind: 'rotated',
      result: { subjectType: row.subjectType, subjectId: row.subjectId, issued },
    };
  });

  switch (verdict.kind) {
    case 'rotated':
      return verdict.result;
    case 'reuse':
      await revokeFamily(deps.db, verdict.familyId, 'reuse_detected');
      throw unauthorized('Session was ended for security reasons');
    case 'expired':
      await deps.db
        .update(refreshTokens)
        .set({ revokedAt: new Date(), revokedReason: 'expired' })
        .where(eq(refreshTokens.id, verdict.id));
      throw unauthorized('Session expired');
    case 'unknown':
      throw unauthorized('Session expired or invalid');
  }
}

/**
 * Ends the session the presented token belongs to.
 *
 * Silent when the token is unknown: logging out is not an operation a caller should be able
 * to probe, and a client clearing a stale cookie should not see an error for doing the right
 * thing.
 */
export async function logout(deps: AuthDeps, presentedToken: string | undefined): Promise<void> {
  if (!presentedToken) return;
  const tokenHash = hashRefreshToken(presentedToken, deps.refreshSecret);
  const row = await deps.db.query.refreshTokens.findFirst({
    where: eq(refreshTokens.tokenHash, tokenHash),
  });
  if (!row) return;
  await revokeFamily(deps.db, row.familyId, 'logout');
}

/** Ends every session for the subject. Used by "sign out everywhere" and by a password change. */
export async function logoutEverywhere(
  deps: AuthDeps,
  subjectType: SubjectType,
  subjectId: number,
  reason: string,
): Promise<void> {
  await revokeAllForSubject(deps.db, subjectType, subjectId, reason);
}

export async function findCustomerById(
  deps: AuthDeps,
  id: number,
): Promise<typeof customers.$inferSelect | undefined> {
  return deps.db.query.customers.findFirst({
    where: and(eq(customers.id, id), eq(customers.status, 'active')),
  });
}

export async function findAdminById(
  deps: AuthDeps,
  id: number,
): Promise<typeof adminUsers.$inferSelect | undefined> {
  return deps.db.query.adminUsers.findFirst({
    where: and(eq(adminUsers.id, id), eq(adminUsers.isActive, true)),
  });
}
