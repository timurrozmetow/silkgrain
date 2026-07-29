import { buildApp } from './app';
import { loadDotEnv } from './config/dotenv';
import { loadEnv } from './env';

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
const SHUTDOWN_TIMEOUT_MS = 10_000;
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
