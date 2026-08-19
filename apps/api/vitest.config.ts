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

    /**
     * Coverage, with thresholds a few points under what the suite currently reaches.
     *
     * The bar in `PLAN.md` is 80% of the business logic; the suite is well past it, so the
     * thresholds are set just below today's numbers rather than at the target. A threshold at the
     * target would let coverage fall sixteen points before anybody noticed - the point of a floor
     * is to catch the next regression, not to certify the last one.
     *
     * The seed, the migration runner and the test harness are excluded: they are exercised by
     * `pnpm db:reset` and by every test respectively, and counting them would measure how much of
     * the seed a test happened to touch.
     */
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/test/**', 'src/db/seed/**', 'src/db/migrate.ts'],
      thresholds: { statements: 95, branches: 82, functions: 85, lines: 95 },
    },
  },
});
