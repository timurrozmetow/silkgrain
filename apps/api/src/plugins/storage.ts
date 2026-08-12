import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import type { Env } from '../env';
import { Storage } from '../modules/media/storage.service';

declare module 'fastify' {
  interface FastifyInstance {
    storage: Storage;
  }
}

export interface StorageOptions {
  env: Env;
}

/**
 * The object-storage client, decorated once.
 *
 * The bucket is provisioned lazily on the first upload rather than here at boot: the storefront and
 * the whole customer contour never touch it, and a boot that failed because MinIO was down would
 * take the shop offline over a feature only three admins use.
 */
// eslint-disable-next-line @typescript-eslint/require-await -- Fastify plugins are async by contract
async function storagePlugin(app: FastifyInstance, options: StorageOptions): Promise<void> {
  app.decorate('storage', new Storage(options.env));
}

export const storagePluginFp = fp(storagePlugin, { name: 'storage' });
