import Fastify, { type FastifyInstance } from 'fastify';

import type { Env } from './env';

/**
 * Builds the Fastify instance without listening, so tests can drive it via `inject()`.
 * Plugins, error handling and routes are layered on in Phase 2.
 */
export function buildApp(env: Env): FastifyInstance {
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
    },
    // Trust the reverse proxy in production so rate limiting sees the real client IP.
    trustProxy: env.NODE_ENV === 'production',
    bodyLimit: 1_048_576,
  });

  app.get('/health', () => ({ status: 'ok' as const }));

  return app;
}
