import { fileURLToPath } from 'node:url';

import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// drizzle-kit runs outside the Fastify boot, so it loads the repo-root .env itself.
config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), override: false });

const url = process.env['DATABASE_URL'];
if (!url) {
  throw new Error('DATABASE_URL is not set. Copy .env.example to .env before running drizzle-kit.');
}

export default defineConfig({
  dialect: 'mysql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dbCredentials: { url },
  verbose: true,
  strict: true,
});
