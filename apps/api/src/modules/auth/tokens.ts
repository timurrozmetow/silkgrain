import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

import type { AccessTokenClaims, AdminRole, SubjectType } from '@silkgrain/contracts';
import { and, eq, isNull, lt, or } from 'drizzle-orm';

import type { DbExecutor } from '../../db/client';
import { refreshTokens } from '../../db/schema';

/** Audience claim per contour. A customer token presented to an admin route fails here. */
export const AUDIENCE: Record<SubjectType, string> = {
  customer: 'silkgrain:customer',
  admin: 'silkgrain:admin',
};

export const ISSUER = 'silkgrain-api';

/**
 * One cookie name per contour, so a browser can hold a storefront session and a back-office
 * session at once without one silently overwriting the other.
 */
export const REFRESH_COOKIE: Record<SubjectType, string> = {
  customer: 'sg_refresh',
  admin: 'sg_admin_refresh',
};

/**
 * The refresh token is 48 bytes of CSPRNG output, not a JWT.
 *
 * A JWT refresh token is self-validating, which is exactly the property that makes it
 * impossible to revoke without a database lookup anyway - so the JWT buys nothing and costs
 * the ability to reason about what is currently valid. An opaque token means the database
 * row *is* the session.
 */
export function generateRefreshToken(): string {
  return randomBytes(48).toString('base64url');
}

/**
 * Stored as HMAC-SHA256 under the refresh secret, not as a bare hash.
 *
 * The token has 384 bits of entropy, so a plain SHA-256 would already be safe against
 * reversal; the keyed digest adds that a database dump alone - without the application
 * secret - cannot be turned into a lookup table for tokens seen elsewhere.
 *
 * Not Argon2: there is no low-entropy secret to slow an attacker down over, and every
 * refresh would otherwise pay a 19 MiB memory-hard cost for nothing.
 */
export function hashRefreshToken(token: string, secret: string): string {
  return createHmac('sha256', secret).update(token).digest('hex');
}

/** Constant-time comparison, so a near-miss cannot be found one character at a time. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export interface IssuedRefreshToken {
  token: string;
  familyId: string;
  expiresAt: Date;
}

export interface RefreshTokenContext {
  userAgent?: string | undefined;
  ip?: string | undefined;
}

/**
 * Issues a refresh token and records it.
 *
 * `familyId` is carried across every rotation of the same session. Presenting a token that
 * has already been rotated is the signature of a stolen cookie - the legitimate client would
 * be holding the newest one - so the whole family is revoked at that point rather than just
 * the replayed token. That logs out the thief and the victim, which is the correct outcome:
 * the victim can log in again, the thief has nothing.
 */
export async function issueRefreshToken(
  db: DbExecutor,
  params: {
    subjectType: SubjectType;
    subjectId: number;
    ttlSeconds: number;
    secret: string;
    familyId?: string;
    context?: RefreshTokenContext;
  },
): Promise<IssuedRefreshToken> {
  const token = generateRefreshToken();
  const familyId = params.familyId ?? randomUUID();
  const expiresAt = new Date(Date.now() + params.ttlSeconds * 1000);

  await db.insert(refreshTokens).values({
    subjectType: params.subjectType,
    subjectId: params.subjectId,
    tokenHash: hashRefreshToken(token, params.secret),
    familyId,
    expiresAt,
    userAgent: params.context?.userAgent?.slice(0, 400) ?? null,
    ip: params.context?.ip ?? null,
  });

  return { token, familyId, expiresAt };
}

export async function revokeFamily(
  db: DbExecutor,
  familyId: string,
  reason: string,
): Promise<void> {
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date(), revokedReason: reason })
    .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
}

export async function revokeAllForSubject(
  db: DbExecutor,
  subjectType: SubjectType,
  subjectId: number,
  reason: string,
): Promise<void> {
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date(), revokedReason: reason })
    .where(
      and(
        eq(refreshTokens.subjectType, subjectType),
        eq(refreshTokens.subjectId, subjectId),
        isNull(refreshTokens.revokedAt),
      ),
    );
}

/**
 * Removes tokens that can no longer be used. Expired rows are worthless, and revoked rows
 * stop being evidence once nothing can present them. Run from a scheduled job in Phase 4.
 */
export async function pruneRefreshTokens(db: DbExecutor, olderThan = new Date()): Promise<void> {
  await db
    .delete(refreshTokens)
    .where(or(lt(refreshTokens.expiresAt, olderThan), lt(refreshTokens.revokedAt, olderThan)));
}

export function accessClaims(
  subjectType: SubjectType,
  subjectId: number,
  familyId: string,
  role?: AdminRole,
): AccessTokenClaims {
  return {
    sub: subjectId,
    typ: subjectType,
    sid: familyId,
    ...(role === undefined ? {} : { role }),
  };
}
