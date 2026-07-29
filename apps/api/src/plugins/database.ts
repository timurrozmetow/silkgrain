import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import { createDatabase, type Database, type DatabaseHandle } from '../db/client';

declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
    dbHandle: DatabaseHandle;
  }
}

export interface DatabaseOptions {
  url: string;
  poolSize: number;
}

/**
 * Opens the pool at boot and closes it on shutdown.
 *
 * `onClose` rather than a signal handler: Fastify already sequences shutdown, so the pool is
 * drained after the server stops accepting connections and before the process exits, which
 * is what keeps an in-flight checkout from losing its transaction.
 */
export const databasePlugin = fp<DatabaseOptions>(
  // eslint-disable-next-line @typescript-eslint/require-await -- fastify-plugin expects a promise
  async function database(app: FastifyInstance, { url, poolSize }) {
    const handle = createDatabase(url, poolSize);

    app.decorate('db', handle.db);
    app.decorate('dbHandle', handle);

    app.addHook('onClose', async () => {
      await handle.close();
    });
  },
  { name: 'silkgrain-database' },
);
