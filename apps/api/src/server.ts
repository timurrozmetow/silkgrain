import { buildApp } from './app';
import { loadDotEnv } from './config/dotenv';
import { loadEnv } from './env';

const SHUTDOWN_TIMEOUT_MS = 10_000;

/**
 * Everything inside a function, and not one `await` at module scope.
 *
 * PM2's cluster container loads the entry with `require()`, and `require()` of an ES module is
 * fine on Node 22.12 and later - unless the module graph contains a top-level await, which makes
 * it `ERR_REQUIRE_ASYNC_MODULE`. This file had two of them, so `pm2 start ecosystem.config.cjs`
 * would have failed on the first deploy with an error that reads like a PM2 bug rather than ours.
 * Measured rather than reasoned: `require()` of the built `dist/server.js` throws that code, and
 * the same module with the awaits moved inside a function loads.
 *
 * The consequence is that nothing may `await` out here again, and that a future import which does
 * would reintroduce the failure from a file that looks unrelated to this one.
 */
async function main(): Promise<void> {
  loadDotEnv();
  const env = loadEnv();
  const app = await buildApp(env);

  /**
   * Graceful shutdown.
   *
   * `app.close()` runs the `onClose` hooks in reverse registration order, which drains the
   * MySQL pool and quits Redis after the server has stopped accepting connections. A hard
   * timeout sits behind it: if a request hangs, the process must still exit rather than sit
   * there holding a port that the next deploy needs.
   */
  let shuttingDown = false;

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      if (shuttingDown) return;
      shuttingDown = true;
      app.log.info({ signal }, 'shutting down');

      const forceExit = setTimeout(() => {
        app.log.error('shutdown timed out, exiting anyway');
        process.exit(1);
      }, SHUTDOWN_TIMEOUT_MS);
      forceExit.unref();

      void app.close().then(
        () => {
          process.exit(0);
        },
        (error: unknown) => {
          app.log.error({ err: error }, 'failed to shut down cleanly');
          process.exit(1);
        },
      );
    });
  }

  try {
    await app.listen({ host: env.API_HOST, port: env.API_PORT });
  } catch (error) {
    app.log.error({ err: error }, 'failed to start');
    process.exit(1);
  }
}

/**
 * No `await` on the call either, for the same reason - and a rejection handler, because an
 * unhandled one from a floating promise exits with a stack and no log line.
 */
void main().catch((error: unknown) => {
  // `?? error.message` because `stack` is optional on Error and an empty one here would print
  // "failed to start: undefined" during the one minute somebody needs the reason.
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`failed to start: ${detail}\n`);
  process.exit(1);
});
