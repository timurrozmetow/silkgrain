import { fileURLToPath } from 'node:url';

import { config } from 'dotenv';

/**
 * Loads the repository-root `.env` into `process.env`.
 *
 * One file at the root rather than one per app: the same database URL and the same secrets
 * are read by the API, by `drizzle-kit` and by the seed scripts, and three copies of a
 * credential is three chances for them to disagree.
 *
 * Existing environment variables always win, so a value exported by CI or by PM2 is never
 * overwritten by a stray developer `.env` that happened to be deployed with the code.
 */
export function loadDotEnv(): void {
  config({ path: fileURLToPath(new URL('../../../../.env', import.meta.url)), override: false });
}
