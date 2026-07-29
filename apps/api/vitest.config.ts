import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The integration tests share one MySQL database and truncate between cases, so two files
    // running at once would delete each other's fixtures. Correctness over wall-clock here.
    fileParallelism: false,
    // Argon2id at 19 MiB is deliberately slow; a registration plus a login is comfortably
    // past Vitest's 5-second default on a cold cache.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
