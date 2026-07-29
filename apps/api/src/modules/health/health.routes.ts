import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

const Liveness = z.object({
  status: z.literal('ok'),
  uptimeSeconds: z.number(),
});

const Readiness = z.object({
  status: z.enum(['ready', 'degraded']),
  checks: z.object({
    database: z.object({ ok: z.boolean(), latencyMs: z.number(), error: z.string().optional() }),
    redis: z.object({ ok: z.boolean(), latencyMs: z.number(), error: z.string().optional() }),
  }),
});

async function timed(probe: () => Promise<unknown>): Promise<{
  ok: boolean;
  latencyMs: number;
  error?: string;
}> {
  const started = performance.now();
  try {
    await probe();
    return { ok: true, latencyMs: Math.round(performance.now() - started) };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - started),
      error: error instanceof Error ? error.message : 'unknown error',
    };
  }
}

/**
 * Two endpoints, because they answer two different questions.
 *
 * `/health` is liveness: is this process running. It touches nothing external, so a database
 * outage cannot make the orchestrator kill an otherwise healthy process and start a restart
 * loop that makes the outage worse.
 *
 * `/ready` is readiness: can this process serve traffic. It probes MySQL and Redis and takes
 * itself out of the load balancer when they are gone.
 */
// eslint-disable-next-line @typescript-eslint/require-await -- Fastify plugins are async by contract
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  const routes = app.withTypeProvider<ZodTypeProvider>();

  routes.get(
    '/health',
    {
      // A liveness probe hitting the global limit would be reported as an outage.
      config: { rateLimit: false },
      schema: {
        tags: ['system'],
        summary: 'Liveness probe',
        response: { 200: Liveness },
      },
    },
    () => ({ status: 'ok' as const, uptimeSeconds: Math.round(process.uptime()) }),
  );

  routes.get(
    '/ready',
    {
      config: { rateLimit: false },
      schema: {
        tags: ['system'],
        summary: 'Readiness probe: MySQL and Redis',
        response: { 200: Readiness, 503: Readiness },
      },
    },
    async (_request, reply) => {
      const [database, redis] = await Promise.all([
        timed(() => app.db.execute(sql`SELECT 1`)),
        timed(() => app.redis.ping()),
      ]);

      const ready = database.ok && redis.ok;
      return reply.status(ready ? 200 : 503).send({
        status: ready ? ('ready' as const) : ('degraded' as const),
        checks: { database, redis },
      });
    },
  );
}
