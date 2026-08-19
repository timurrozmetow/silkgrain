import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against the built apps.
 *
 * Against `preview`, not `dev`: the dev server serves unbundled modules and a different module
 * graph, so a passing dev run says nothing about what a visitor downloads. These drive the same
 * artefact `pnpm build` produces and `bundle:budget` measures.
 *
 * The API is not started here. It needs MySQL, Redis and a seeded database, which
 * `pnpm setup:services` and `pnpm db:seed` own, and a webServer entry that quietly started one
 * would hide a missing service behind a timeout. The tests fail loudly if it is absent.
 */
export default defineConfig({
  testDir: './e2e',
  // The suite drives a shared, seeded database. Two workers adding to two carts is fine; two
  // workers registering the same email is not, and the isolation is not worth the wall clock.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] === undefined ? 0 : 1,
  reporter: process.env['CI'] === undefined ? 'list' : [['list'], ['html', { open: 'never' }]],

  use: {
    /**
     * `localhost`, not `127.0.0.1`.
     *
     * Vite's preview server binds to the hostname, and on this machine `localhost` resolves to
     * `::1` first - so a literal IPv4 address never connects and the webServer wait times out
     * after two minutes with no useful message. Cost me one run to find.
     */
    baseURL: 'http://localhost:4173',
    // A trace only on the first retry: enough to diagnose a flake, not enough to fill the disk.
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    // The responsive layer is a real deliverable (D-19), and the mobile nav is a different
    // component rather than the same one narrowed - so it needs its own pass.
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],

  webServer: {
    command: 'pnpm --filter @silkgrain/web preview',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
