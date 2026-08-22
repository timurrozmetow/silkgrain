import { randomUUID } from 'node:crypto';

import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';

import type { Env } from './env';
import { adminRoutes } from './modules/admin/admin.routes';
import { authRoutes } from './modules/auth/auth.routes';
import { cartRoutes } from './modules/cart/cart.routes';
import { catalogRoutes } from './modules/catalog/catalog.routes';
import { contentRoutes } from './modules/content/content.routes';
import { healthRoutes } from './modules/health/health.routes';
import { orderRoutes } from './modules/orders/orders.routes';
import { stripeWebhookRoutes } from './modules/webhooks/stripe.webhook';
import { wholesaleRoutes } from './modules/wholesale/wholesale.routes';
import { authPlugin } from './plugins/auth';
import { databasePlugin } from './plugins/database';
import { errorHandlerPlugin } from './plugins/error-handler';
import { mailPlugin } from './plugins/mail';
import { redisPlugin } from './plugins/redis';
import { requestContextPlugin } from './plugins/request-context';
import { securityPlugin } from './plugins/security';
import { storagePluginFp } from './plugins/storage';
import { swaggerPlugin } from './plugins/swagger';

/**
 * Builds the application without listening, so tests can drive it through `inject()` and the
 * process entry point stays a thin wrapper around `listen`.
 *
 * Registration order is load-bearing: the error handler goes on first so a failure inside any
 * later plugin is still reported in the platform's shape; request context precedes auth
 * because the guards write into the store; Swagger goes last so it sees every route.
 */
export async function buildApp(env: Env): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      ...(env.NODE_ENV === 'development'
        ? {
            transport: {
              target: 'pino-pretty',
              options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
            },
          }
        : {}),
      redact: {
        // These reach the logger through the request serialiser and must never be persisted.
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'res.headers["set-cookie"]',
          'body.password',
          'body.newPassword',
          'body.currentPassword',
        ],
        censor: '[redacted]',
      },
    },
    // A UUID rather than Fastify's per-process counter: with several PM2 workers the counters
    // collide, and a request id that is not unique is worse than none.
    genReqId: () => randomUUID(),
    requestIdHeader: 'x-request-id',
    /**
     * Trust the reverse proxy in production so rate limiting sees the real client IP.
     *
     * A hop count, not `true`. `true` compiles to trust-everything, which makes `request.ip` the
     * leftmost `X-Forwarded-For` entry - a value the client writes. Every limiter keys on that
     * (`plugins/security.ts`), so a rotating header would hand out a fresh bucket per request and
     * defeat all of them at once, including the 10-per-15-minutes on the sign-in routes that is
     * the only online-guessing defence the back office has. Trusting exactly one hop discards
     * everything to the left of what our own proxy appended.
     */
    trustProxy: env.NODE_ENV === 'production' ? 1 : false,
    bodyLimit: 1_048_576,
    ajv: { customOptions: { removeAdditional: false } },
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(errorHandlerPlugin);
  await app.register(requestContextPlugin);
  await app.register(databasePlugin, {
    url: env.DATABASE_URL,
    poolSize: env.DATABASE_POOL_SIZE,
  });
  await app.register(redisPlugin, { url: env.REDIS_URL });
  await app.register(securityPlugin, {
    env,
    // Tests use the in-process store: a shared Redis would carry counters between runs and
    // turn "the eleventh login attempt is rejected" into a test that passes once.
    redis: env.NODE_ENV === 'test' ? undefined : app.redis,
  });
  await app.register(authPlugin, { env });
  // After the database and Redis, which the worker and the queue both need.
  await app.register(mailPlugin, { env });
  await app.register(storagePluginFp, { env });

  // Swagger goes on before the routes, not after: it collects the document through an
  // `onRoute` hook, and a route registered earlier is a route it never sees.
  await app.register(swaggerPlugin, { env });

  await app.register(healthRoutes);
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(catalogRoutes, { prefix: '/api' });
  await app.register(cartRoutes, { prefix: '/api/cart' });
  await app.register(orderRoutes, { prefix: '/api' });
  await app.register(contentRoutes, { prefix: '/api' });
  await app.register(wholesaleRoutes, { prefix: '/api' });
  await app.register(adminRoutes, { prefix: '/api/admin' });
  // Registered last and in its own scope: it replaces the JSON parser with a raw-bytes one,
  // and that substitution must not escape into any other route.
  //
  // Not registered at all when payments are off, which is the whole of D-51. Signature
  // verification is local HMAC against `STRIPE_WEBHOOK_SECRET`, so a route mounted without a
  // real secret is a route that accepts whatever anyone signs with the published placeholder.
  // And with `POST /api/checkout/intent` unwritten (D-27) no PaymentIntent exists to report on,
  // so every event such a route could receive would be a forgery. An absent route answers 404
  // through the ordinary not-found handler and gives an attacker nothing to work against.
  if (env.PAYMENTS_ENABLED) {
    await app.register(stripeWebhookRoutes, { prefix: '/api/webhooks', env });
  }

  return app;
}
