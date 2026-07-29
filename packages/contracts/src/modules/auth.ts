import { z } from 'zod';

import { AdminRole } from '../enums';
import { Email, Id, IsoDate, Phone } from '../primitives';

/**
 * Password policy.
 *
 * Length does more for resistance to guessing than character-class rules do, so the floor is
 * ten characters rather than eight with a symbol requirement. The upper bound exists because
 * Argon2id hashes whatever it is given: without a cap, a multi-megabyte "password" is a free
 * denial-of-service. The value is never trimmed — leading and trailing spaces are part of it.
 */
export const Password = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(128, 'Use at most 128 characters')
  .refine((value) => /[a-z]/i.test(value), 'Include at least one letter')
  .refine((value) => /\d/.test(value), 'Include at least one number');

export const RegisterInput = z
  .object({
    email: Email,
    password: Password,
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().min(1).max(80),
    phone: Phone.optional(),
    marketingOptIn: z.boolean().default(false),
  })
  .strict();
export type RegisterInput = z.infer<typeof RegisterInput>;

export const LoginInput = z
  .object({
    email: Email,
    // Not `Password`: an old account may predate a policy change, and validating the login
    // form against the policy would tell an attacker which passwords are worth trying.
    password: z.string().min(1).max(128),
  })
  .strict();
export type LoginInput = z.infer<typeof LoginInput>;

export const ChangePasswordInput = z
  .object({
    currentPassword: z.string().min(1).max(128),
    newPassword: Password,
  })
  .strict()
  .refine((value) => value.currentPassword !== value.newPassword, {
    message: 'The new password must differ from the current one',
    path: ['newPassword'],
  });
export type ChangePasswordInput = z.infer<typeof ChangePasswordInput>;

export const UpdateProfileInput = z
  .object({
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().min(1).max(80),
    phone: Phone.nullable(),
    marketingOptIn: z.boolean(),
  })
  .strict();
export type UpdateProfileInput = z.infer<typeof UpdateProfileInput>;

/** The signed-in customer, as returned by `/auth/register`, `/auth/login` and `/auth/me`. */
export const CustomerProfile = z.object({
  id: Id,
  email: Email,
  firstName: z.string(),
  lastName: z.string(),
  phone: z.string().nullable(),
  marketingOptIn: z.boolean(),
  emailVerified: z.boolean(),
  createdAt: IsoDate,
});
export type CustomerProfile = z.infer<typeof CustomerProfile>;

export const AdminProfile = z.object({
  id: Id,
  email: Email,
  name: z.string(),
  role: AdminRole,
  lastLoginAt: IsoDate.nullable(),
});
export type AdminProfile = z.infer<typeof AdminProfile>;

/**
 * What a successful authentication returns.
 *
 * The refresh token is deliberately absent: it is set as an httpOnly cookie and must never
 * be readable by JavaScript. The access token is short-lived and lives in memory on the
 * client, so it is returned in the body rather than as a second cookie.
 */
export const AuthResult = z.object({
  accessToken: z.string(),
  /** Seconds until the access token expires, so the client can refresh before it does. */
  expiresIn: z.number().int().positive(),
  customer: CustomerProfile,
});
export type AuthResult = z.infer<typeof AuthResult>;

export const AdminAuthResult = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int().positive(),
  admin: AdminProfile,
});
export type AdminAuthResult = z.infer<typeof AdminAuthResult>;

/** Refreshing returns a new access token; the rotated refresh token rides in the cookie. */
export const RefreshResult = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int().positive(),
});
export type RefreshResult = z.infer<typeof RefreshResult>;

/**
 * The decoded access-token payload.
 *
 * `sub` is the row id, `typ` names the contour. Both are checked on every guarded request:
 * a customer token presented to an admin route fails on `typ`, not on a role lookup, so the
 * two contours cannot be crossed even if a role is ever misconfigured.
 */
export const AccessTokenClaims = z.object({
  sub: Id,
  typ: z.enum(['customer', 'admin']),
  role: AdminRole.optional(),
  /** Session identity, so a single refresh-token family can be revoked wholesale. */
  sid: z.string(),
});
export type AccessTokenClaims = z.infer<typeof AccessTokenClaims>;
