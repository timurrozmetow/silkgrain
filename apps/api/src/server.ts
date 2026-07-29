import { buildApp } from './app';
import { loadEnv } from './env';

const env = loadEnv();
const app = buildApp(env);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    app.log.info({ signal }, 'shutting down');
    void app.close().then(
      () => {
        process.exit(0);
      },
      (error: unknown) => {
        app.log.error({ error }, 'failed to shut down cleanly');
        process.exit(1);
      },
    );
  });
}

try {
  await app.listen({ host: env.API_HOST, port: env.API_PORT });
} catch (error) {
  app.log.error({ error }, 'failed to start');
  process.exit(1);
}
