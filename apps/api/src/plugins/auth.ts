import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import {
  AccessTokenClaims,
  type AdminPermission,
  type AdminRole,
  type SubjectType,
  can,
} from '@silkgrain/contracts';
import { and, eq } from 'drizzle-orm';
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  onRequestAsyncHookHandler,
} from 'fastify';
import fp from 'fastify-plugin';

import { adminUsers } from '../db/schema';
import type { Env } from '../env';
import { parseDuration } from '../env';
import { forbidden, unauthorized } from '../lib/errors';
import { AUDIENCE, ISSUER, REFRESH_COOKIE } from '../modules/auth/tokens';

import { requestContext } from './request-context';

declare module 'fastify' {
  interface FastifyInstance {
    /**
     * Guards, typed as Fastify's own async hook so they can be handed straight to
     * `onRequest` without the route options widening to the callback form.
     */
    requireCustomer: onRequestAsyncHookHandler;
    /**
     * Identifies the customer if a valid token was sent, and does nothing if not.
     *
     * For routes a guest is entitled to use but that behave differently for someone signed in -
     * the cart quote, whose per-customer promo limit can only be checked against an identity.
     * Never a substitute for `requireCustomer`: it grants nothing.
     */
    optionalCustomer: onRequestAsyncHookHandler;
    /** Rejects anything that is not a signed-in administrator. */
    requireAdmin: onRequestAsyncHookHandler;
    /**
     * Rejects an administrator whose role does not carry the named permission.
     *
     * The role comes from the JWT and no database is read, which is the bargain a short-lived
     * stateless token exists to make: a demotion takes effect when the fifteen-minute access
     * token next refreshes, and `/auth/admin/refresh` re-reads the row to make sure it does.
     */
    requirePermission: (permission: AdminPermission) => onRequestAsyncHookHandler;
    /**
     * The same, but re-reading `admin_users` so the window is zero.
     *
     * Only for `team:manage`. Every other permission merely delays inside that window;
     * `team:manage` can mint a permanent replacement in it - a demoted owner creates a second
     * owner account and the demotion is undone. Decision D-32.
     */
    requireFreshPermission: (permission: AdminPermission) => onRequestAsyncHookHandler;
    signAccessToken: (claims: AccessTokenClaims) => string;
    accessTokenTtl: number;
    refreshTokenTtl: number;
    /** HMAC key for refresh-token storage. Never the JWT signing secret. */
    refreshSecret: string;
    setRefreshCookie: (reply: FastifyReply, subject: SubjectType, token: string) => void;
    clearRefreshCookie: (reply: FastifyReply, subject: SubjectType) => void;
  }

  interface FastifyRequest {
    /** Present only after a guard has run. */
    auth?: AccessTokenClaims;
  }
}

export interface AuthOptions {
  env: Env;
}

/**
 * The refresh cookie is scoped to `/api/auth`.
 *
 * A cookie sent on every request is a cookie that can be replayed from every request. Scoped
 * to the four routes that actually need it, a CSRF attempt against `/api/checkout` carries no
 * session material at all, and `SameSite=Lax` covers the rest.
 */
function cookieOptions(env: Env, maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax' as const,
    path: '/api/auth',
    maxAge: maxAgeSeconds,
    ...(env.COOKIE_DOMAIN === 'localhost' ? {} : { domain: env.COOKIE_DOMAIN }),
  };
}

function bearerToken(request: FastifyRequest): string {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw unauthorized('Missing bearer token');
  }
  return header.slice('Bearer '.length).trim();
}

export const authPlugin = fp<AuthOptions>(
  async function auth(app: FastifyInstance, { env }) {
    const accessTtl = parseDuration(env.JWT_ACCESS_TTL);
    const refreshTtl = parseDuration(env.JWT_REFRESH_TTL);

    await app.register(cookie, { secret: env.JWT_REFRESH_SECRET });

    await app.register(jwt, {
      secret: env.JWT_ACCESS_SECRET,
      sign: { iss: ISSUER, expiresIn: env.JWT_ACCESS_TTL },
      verify: { allowedIss: ISSUER },
    });

    app.decorate('accessTokenTtl', accessTtl);
    app.decorate('refreshTokenTtl', refreshTtl);
    app.decorate('refreshSecret', env.JWT_REFRESH_SECRET);

    app.decorate('signAccessToken', (claims: AccessTokenClaims): string =>
      app.jwt.sign(claims, { aud: AUDIENCE[claims.typ] }),
    );

    app.decorate(
      'setRefreshCookie',
      (reply: FastifyReply, subject: SubjectType, token: string): void => {
        reply.setCookie(REFRESH_COOKIE[subject], token, cookieOptions(env, refreshTtl));
      },
    );

    app.decorate('clearRefreshCookie', (reply: FastifyReply, subject: SubjectType): void => {
      reply.clearCookie(REFRESH_COOKIE[subject], { ...cookieOptions(env, 0), maxAge: 0 });
    });

    /**
     * Verifies a token and pins it to one contour.
     *
     * The audience is checked by the library and the `typ` claim by us. Two independent
     * checks because crossing the contours is the failure that matters most here: a customer
     * token that satisfied an admin guard would be a full compromise of the back office.
     */
    function verifyFor(subjectType: 'customer' | 'admin') {
      return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
        const token = bearerToken(request);
        let payload: unknown;
        try {
          // Synchronous overload: no callback is passed, so `verify` returns the payload
          // rather than a promise.
          payload = app.jwt.verify(token, { allowedAud: AUDIENCE[subjectType] });
        } catch {
          throw unauthorized('Session expired or invalid');
        }

        const claims = AccessTokenClaims.safeParse(payload);
        if (!claims.success || claims.data.typ !== subjectType) {
          throw unauthorized('Token is not valid for this endpoint');
        }

        request.auth = claims.data;
        requestContext.set('subjectType', claims.data.typ);
        requestContext.set('subjectId', claims.data.sub);
      };
    }

    app.decorate('requireCustomer', verifyFor('customer'));
    app.decorate('requireAdmin', verifyFor('admin'));

    const identifyCustomer = verifyFor('customer');
    app.decorate(
      'optionalCustomer',
      async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
        if (!request.headers.authorization) return;
        try {
          await identifyCustomer(request, reply);
        } catch {
          // A guest with a stale token is still a guest. Rejecting the request would log
          // somebody out of their cart because a fifteen-minute access token expired.
        }
      },
    );

    /**
     * The role on the request, or a 401.
     *
     * `AccessTokenClaims` is a discriminated union, so an admin token always carries a role and
     * this narrow is total. The `typ` check is what `verifyFor('admin')` already guarantees; it is
     * repeated here only to satisfy the compiler at the narrow.
     */
    function adminRole(request: FastifyRequest): AdminRole {
      const auth = request.auth;
      if (auth?.typ !== 'admin') throw unauthorized('No administrator');
      return auth.role;
    }

    app.decorate('requirePermission', (permission: AdminPermission) => {
      const requireAdmin = verifyFor('admin');
      return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
        await requireAdmin(request, reply);
        if (!can(adminRole(request), permission)) {
          throw forbidden('Your role does not allow this action');
        }
      };
    });

    app.decorate('requireFreshPermission', (permission: AdminPermission) => {
      const requireAdmin = verifyFor('admin');
      return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
        await requireAdmin(request, reply);

        // The token's role is checked first, so an account with no business here never reaches
        // the database at all.
        const claimed = adminRole(request);
        if (!can(claimed, permission)) throw forbidden('Your role does not allow this action');

        const [row] = await app.db
          .select({ role: adminUsers.role })
          .from(adminUsers)
          .where(and(eq(adminUsers.id, request.auth?.sub ?? 0), eq(adminUsers.isActive, true)));
        // Deactivated between minting and now, or demoted: the token says one thing and the row
        // says another, and for this permission the row wins immediately.
        if (!row || !can(row.role, permission)) {
          throw forbidden('Your role does not allow this action');
        }
      };
    });
  },
  { name: 'silkgrain-auth', dependencies: ['silkgrain-request-context'] },
);
