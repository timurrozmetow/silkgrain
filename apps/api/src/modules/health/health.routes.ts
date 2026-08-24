import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

const Liveness = z.object({
  status: z.literal('ok'),
  uptimeSeconds: z.number(),
});

/**
 * What a probe is allowed to say on the wire: whether it worked and how long it took.
 *
 * Deliberately no `error`. This is the one route that bypasses the scrubbing `error-handler.ts`
 * does for every 5xx, and it is unauthenticated and unthrottled by design - so during an incident
 * an anonymous poller would otherwise read `connect ECONNREFUSED 127.0.0.1:3307` or
 * `Access denied for user 'silkgrain'@'...'` straight from the driver. The operator still gets the
 * text; it goes to the log, where the audience is already inside the machine.
 */
const Readiness = z.object({
  status: z.enum(['ready', 'degraded']),
  checks: z.object({
    database: z.object({ ok: z.boolean(), latencyMs: z.number() }),
    redis: z.object({ ok: z.boolean(), latencyMs: z.number() }),
  }),
});

interface ProbeResult {
  ok: boolean;
  latencyMs: number;
  /** Stripped before the response is built. See `Readiness`. */
  error?: string;
}

/**
 * A readiness probe has to answer, and both of ours could fail to.
 *
 * `plugins/redis.ts` sets `maxRetriesPerRequest: null` with ioredis's offline queue left on, which
 * is right for BullMQ - a job must not be dropped because Redis blinked - and wrong here: a
 * `ping()` issued while Redis is down is queued rather than rejected, so the probe never settles
 * and the route hangs instead of reporting `degraded`. A load balancer reads a hang as a timeout
 * and pulls the node, which is the correct outcome by accident and an unreadable one. MySQL can
 * stall the same way while the TCP connect times out.
 */
const PROBE_TIMEOUT_MS = 2000;

async function timed(probe: () => Promise<unknown>): Promise<ProbeResult> {
  const started = performance.now();
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      probe(),
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`probe did not answer within ${String(PROBE_TIMEOUT_MS)}ms`));
        }, PROBE_TIMEOUT_MS);
      }),
    ]);
    return { ok: true, latencyMs: Math.round(performance.now() - started) };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - started),
      error: error instanceof Error ? error.message : 'unknown error',
    };
  } finally {
    // Or the losing timer keeps the event loop alive for two seconds after every healthy probe.
    if (timer) clearTimeout(timer);
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
    async (request, reply) => {
      const [database, redis] = await Promise.all([
        timed(() => app.db.execute(sql`SELECT 1`)),
        timed(() => app.redis.ping()),
      ]);

      // The cause goes to the log, where reading it already requires being inside the machine.
      for (const [name, result] of [
        ['database', database],
        ['redis', redis],
      ] as const) {
        if (!result.ok)
          request.log.warn({ probe: name, err: result.error }, 'readiness probe failed');
      }

      const ready = database.ok && redis.ok;
      return reply.status(ready ? 200 : 503).send({
        status: ready ? ('ready' as const) : ('degraded' as const),
        checks: {
          database: { ok: database.ok, latencyMs: database.latencyMs },
          redis: { ok: redis.ok, latencyMs: redis.latencyMs },
        },
      });
    },
  );
}
