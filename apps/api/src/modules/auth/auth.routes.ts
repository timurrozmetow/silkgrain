import {
  AdminAuthResult,
  ApiError,
  AuthResult,
  CustomerProfile,
  LoginInput,
  RefreshResult,
  RegisterInput,
} from '@silkgrain/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { unauthorized } from '../../lib/errors';

import {
  type AuthDeps,
  findAdminById,
  findCustomerById,
  loginAdmin,
  loginCustomer,
  logout,
  registerCustomer,
  rotateRefreshToken,
  toAdminProfile,
  toCustomerProfile,
} from './auth.service';
import { accessClaims, issueRefreshToken, REFRESH_COOKIE } from './tokens';

/**
 * Credential endpoints get their own limit on top of the global one.
 *
 * 300 requests a minute is right for browsing a catalogue and far too generous for guessing
 * a password: ten attempts per quarter hour is what actually makes online guessing useless
 * while staying invisible to someone who mistyped their password twice.
 */
const CREDENTIAL_LIMIT = { rateLimit: { max: 10, timeWindow: '15 minutes' } };
const REFRESH_LIMIT = { rateLimit: { max: 60, timeWindow: '15 minutes' } };

function clientContext(request: FastifyRequest) {
  return { userAgent: request.headers['user-agent'], ip: request.ip };
}

// eslint-disable-next-line @typescript-eslint/require-await -- Fastify plugins are async by contract
export async function authRoutes(app: FastifyInstance): Promise<void> {
  const routes = app.withTypeProvider<ZodTypeProvider>();
  // `refreshSecret` is not the JWT secret: that one signs access tokens, this one keys the
  // HMAC that refresh tokens are stored under. They are required to differ at boot.
  const deps: AuthDeps = {
    db: app.db,
    refreshSecret: app.refreshSecret,
    refreshTtlSeconds: app.refreshTokenTtl,
  };

  async function completeCustomerSession(
    reply: FastifyReply,
    request: FastifyRequest,
    customer: Awaited<ReturnType<typeof loginCustomer>>,
  ) {
    const issued = await issueRefreshToken(app.db, {
      subjectType: 'customer',
      subjectId: customer.id,
      ttlSeconds: app.refreshTokenTtl,
      secret: app.refreshSecret,
      context: clientContext(request),
    });
    app.setRefreshCookie(reply, 'customer', issued.token);

    return {
      accessToken: app.signAccessToken(accessClaims('customer', customer.id, issued.familyId)),
      expiresIn: app.accessTokenTtl,
      customer: toCustomerProfile(customer),
    };
  }

  routes.post(
    '/register',
    {
      config: CREDENTIAL_LIMIT,
      schema: {
        tags: ['auth'],
        summary: 'Create a customer account',
        body: RegisterInput,
        response: { 201: AuthResult, 409: ApiError, 422: ApiError, 429: ApiError },
      },
    },
    async (request, reply) => {
      const customer = await registerCustomer(deps, request.body);
      const result = await completeCustomerSession(reply, request, customer);
      return reply.status(201).send(result);
    },
  );

  routes.post(
    '/login',
    {
      config: CREDENTIAL_LIMIT,
      schema: {
        tags: ['auth'],
        summary: 'Sign in as a customer',
        body: LoginInput,
        response: { 200: AuthResult, 401: ApiError, 403: ApiError, 429: ApiError },
      },
    },
    async (request, reply) => {
      const customer = await loginCustomer(deps, request.body);
      return completeCustomerSession(reply, request, customer);
    },
  );

  routes.post(
    '/refresh',
    {
      config: REFRESH_LIMIT,
      schema: {
        tags: ['auth'],
        summary: 'Exchange the refresh cookie for a new access token',
        description:
          'The refresh token is rotated on every use. Presenting one that has already been ' +
          'rotated revokes the whole session family.',
        response: { 200: RefreshResult, 401: ApiError, 429: ApiError },
      },
    },
    async (request, reply) => {
      const presented = request.cookies[REFRESH_COOKIE.customer];
      if (!presented) throw unauthorized('No session');

      const rotated = await rotateRefreshToken(deps, presented, clientContext(request));
      if (rotated.subjectType !== 'customer') throw unauthorized('No session');

      app.setRefreshCookie(reply, 'customer', rotated.issued.token);
      return {
        accessToken: app.signAccessToken(
          accessClaims('customer', rotated.subjectId, rotated.issued.familyId),
        ),
        expiresIn: app.accessTokenTtl,
      };
    },
  );

  routes.post(
    '/logout',
    {
      schema: {
        tags: ['auth'],
        summary: 'End the current session',
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      await logout(deps, request.cookies[REFRESH_COOKIE.customer]);
      app.clearRefreshCookie(reply, 'customer');
      return reply.status(204).send();
    },
  );

  routes.get(
    '/me',
    {
      onRequest: app.requireCustomer,
      schema: {
        tags: ['auth'],
        summary: 'The signed-in customer',
        security: [{ bearerAuth: [] }],
        response: { 200: CustomerProfile, 401: ApiError },
      },
    },
    async (request) => {
      const id = request.auth?.sub;
      const customer = id === undefined ? undefined : await findCustomerById(deps, id);
      if (!customer) throw unauthorized('Session expired or invalid');
      return toCustomerProfile(customer);
    },
  );

  // ------------------------------------------------------------------------------------
  // Back office. Separate table, separate cookie, separate audience.
  // ------------------------------------------------------------------------------------

  routes.post(
    '/admin/login',
    {
      config: CREDENTIAL_LIMIT,
      schema: {
        tags: ['auth'],
        summary: 'Sign in to the admin panel',
        body: LoginInput,
        response: { 200: AdminAuthResult, 401: ApiError, 403: ApiError, 429: ApiError },
      },
    },
    async (request, reply) => {
      const admin = await loginAdmin(deps, request.body);
      const issued = await issueRefreshToken(app.db, {
        subjectType: 'admin',
        subjectId: admin.id,
        ttlSeconds: app.refreshTokenTtl,
        secret: app.refreshSecret,
        context: clientContext(request),
      });
      app.setRefreshCookie(reply, 'admin', issued.token);

      return {
        accessToken: app.signAccessToken(
          accessClaims('admin', admin.id, issued.familyId, admin.role),
        ),
        expiresIn: app.accessTokenTtl,
        admin: toAdminProfile(admin),
      };
    },
  );

  routes.post(
    '/admin/refresh',
    {
      config: REFRESH_LIMIT,
      schema: {
        tags: ['auth'],
        summary: 'Exchange the admin refresh cookie for a new access token',
        response: { 200: RefreshResult, 401: ApiError, 429: ApiError },
      },
    },
    async (request, reply) => {
      const presented = request.cookies[REFRESH_COOKIE.admin];
      if (!presented) throw unauthorized('No session');

      const rotated = await rotateRefreshToken(deps, presented, clientContext(request));
      if (rotated.subjectType !== 'admin') throw unauthorized('No session');

      // The role is re-read rather than carried over: a demotion has to take effect at the
      // next refresh, not thirty days later when the session finally expires.
      const admin = await findAdminById(deps, rotated.subjectId);
      if (!admin) throw unauthorized('This account is no longer active');

      app.setRefreshCookie(reply, 'admin', rotated.issued.token);
      return {
        accessToken: app.signAccessToken(
          accessClaims('admin', admin.id, rotated.issued.familyId, admin.role),
        ),
        expiresIn: app.accessTokenTtl,
      };
    },
  );

  routes.post(
    '/admin/logout',
    {
      schema: { tags: ['auth'], summary: 'End the admin session', response: { 204: z.null() } },
    },
    async (request, reply) => {
      await logout(deps, request.cookies[REFRESH_COOKIE.admin]);
      app.clearRefreshCookie(reply, 'admin');
      return reply.status(204).send();
    },
  );

  routes.get(
    '/admin/me',
    {
      onRequest: app.requireAdmin,
      schema: {
        tags: ['auth'],
        summary: 'The signed-in administrator',
        security: [{ bearerAuth: [] }],
        response: { 200: AdminAuthResult.shape.admin, 401: ApiError },
      },
    },
    async (request) => {
      const id = request.auth?.sub;
      const admin = id === undefined ? undefined : await findAdminById(deps, id);
      if (!admin) throw unauthorized('Session expired or invalid');
      return toAdminProfile(admin);
    },
  );
}
