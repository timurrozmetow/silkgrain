import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
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
 *
 * ## Why this searches rather than counting `../`
 *
 * It used to be `new URL('../../../../.env', import.meta.url)`, which is four levels up from
 * `apps/api/src/config/` and lands exactly on the repository root - in development. The built
 * entry point is `apps/api/dist/server.js`, one directory shallower, so the same four levels land
 * one directory ABOVE the deployment root: with releases at `/srv/silkgrain/releases/<stamp>/`
 * it reads `/srv/silkgrain/releases/.env`, which does not exist. Node also resolves the symlink
 * on the main module, so `current/` never appears in the path to count from either.
 *
 * The symptom would have been the API refusing to boot on the very first deploy, with `loadEnv`
 * naming a missing `DATABASE_URL` rather than a missing file - a fifteen-minute confusion during
 * the one operation where nobody has fifteen minutes. Walking up for the file is immune to how
 * deep the caller happens to be, which is the property that was actually wanted all along.
 */

/** An explicit override, for a layout that is neither of the two below. */
const OVERRIDE = 'DOTENV_PATH';

/** Far more than any real layout needs; a bound rather than a `while (true)`. */
const MAX_DEPTH = 10;

function findEnvFile(): string | undefined {
  const override = process.env[OVERRIDE];
  if (override !== undefined && override !== '') return override;

  let directory = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
    const candidate = join(directory, '.env');
    if (existsSync(candidate)) return candidate;

    const parent = dirname(directory);
    if (parent === directory) break; // filesystem root
    directory = parent;
  }
  return undefined;
}

export function loadDotEnv(): void {
  const path = findEnvFile();
  // Absent is not an error. In production PM2 and the systemd unit may supply the whole
  // environment directly, and `loadEnv` is the thing that decides whether what arrived is
  // sufficient - failing here would just be a worse-worded version of the same message.
  if (path === undefined) return;

  config({ path, override: false });
}
