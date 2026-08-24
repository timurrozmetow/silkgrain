import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    /**
     * Coverage over the three files here that hold logic, not over the package.
     *
     * The rest of `packages/contracts` is Zod schema declarations, and they are exercised by the
     * API's suite rather than by this one - measuring the whole package would report twelve per
     * cent and mean nothing. These three are different: `money.ts` is the only place currency
     * arithmetic happens, `pagination.ts` is the arithmetic behind every list footer in the
     * system, and `rbac.ts` is the permission matrix. All three are pure, so a hundred per cent
     * is both reachable and the right bar.
     */
    coverage: {
      provider: 'v8',
      include: ['src/money.ts', 'src/pagination.ts', 'src/rbac.ts'],
      thresholds: { statements: 100, branches: 95, functions: 100, lines: 100 },
    },
  },
});
