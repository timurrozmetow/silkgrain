import compress from '@fastify/compress';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { Redis } from 'ioredis';

import type { Env } from '../env';

export interface SecurityOptions {
  env: Env;
  /** Shared store, so a limit of 300/min is 300 across every PM2 worker, not 300 per worker. */
  redis?: Redis | undefined;
}

export const securityPlugin = fp<SecurityOptions>(
  async function security(app: FastifyInstance, { env, redis }) {
    await app.register(sensible);

    await app.register(helmet, {
      // An API returns JSON and loads nothing. Swagger UI opts out for its own prefix via
      // `staticCSP`, which is why this can stay this strict.
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
      // Nothing here is meant to be framed or sniffed.
      referrerPolicy: { policy: 'no-referrer' },
      hsts: env.NODE_ENV === 'production' ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    });

    await app.register(cors, {
      // A whitelist rather than a reflector: the refresh cookie makes every request
      // credentialed, and `credentials: true` with a reflected origin is an open door.
      origin: env.CORS_ORIGINS,
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      maxAge: 86_400,
    });

    await app.register(compress, {
      global: true,
      // Below a kilobyte the compression overhead costs more than the bytes it saves.
      threshold: 1024,
      encodings: ['br', 'gzip', 'deflate'],
    });

    await app.register(rateLimit, {
      global: true,
      max: 300,
      timeWindow: '1 minute',
      ...(redis ? { redis } : {}),
      // Tests drive the app through `inject()`, which has no socket and therefore no IP.
      keyGenerator: (request) => request.ip || 'unknown',
      // No `errorResponseBuilder`: the plugin *throws* whatever that returns, so returning a
      // plain object produces a non-Error that the error handler cannot classify and reports
      // as a 500. The default throws a real `Error` carrying `statusCode: 429`, which the
      // handler already translates into `RATE_LIMITED` in the platform's shape.
    });
  },
  { name: 'silkgrain-security' },
);
