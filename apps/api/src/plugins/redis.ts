import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import IORedis, { type Redis } from 'ioredis';

declare module 'fastify' {
  interface FastifyInstance {
    redis: Redis;
  }
}

export interface RedisOptions {
  url: string;
}

/**
 * The shared Redis connection: distributed rate limiting now, BullMQ queues from Phase 4.
 *
 * `maxRetriesPerRequest: null` is what BullMQ requires - with a retry cap, a blocking `BRPOP`
 * that outlives the cap is aborted and a worker silently stops consuming. The same connection
 * is configured that way from the start so the queue layer does not need a second one.
 *
 * `lazyConnect` keeps `buildApp()` synchronous-ish and testable: nothing dials Redis until
 * the first command, so a unit test that never touches it never needs it running.
 */
export const redisPlugin = fp<RedisOptions>(
  // eslint-disable-next-line @typescript-eslint/require-await -- fastify-plugin expects a promise
  async function redis(app: FastifyInstance, { url }) {
    const client = new IORedis(url, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      lazyConnect: true,
    });

    client.on('error', (error: Error) => {
      app.log.error({ err: error }, 'redis connection error');
    });

    app.decorate('redis', client);

    app.addHook('onClose', async () => {
      await client.quit().catch(() => {
        client.disconnect();
      });
    });
  },
  { name: 'silkgrain-redis' },
);
