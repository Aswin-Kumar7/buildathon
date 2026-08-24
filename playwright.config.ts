import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against the real stack: the built web app, the real API, and the
 * real database. That matters more than it sounds — the unit suite passed while the dev
 * server was returning 500 on every auth route, because they used different transforms.
 * Only a test that boots the actual application catches that class of failure.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  globalSetup: './e2e/global-setup.ts',

  webServer: {
    command: 'pnpm dev',
    // The API, not the web app: Vite answers within a second while the API still has a
    // database connection and password hashing ahead of it. Waiting on the fast one and
    // then testing the slow one is how a green stack reports as broken.
    url: 'http://localhost:3001/api/health',
    // Forced onto embedded Postgres, overriding any .env. An exported empty value beats
    // `--env-file-if-exists`, which is what makes this work.
    //
    // Two reasons. It is the credential-free path a reviewer runs from a clean clone, so
    // proving it is worth more than proving a configured one. And a suite that shares a
    // database with development can be defeated by state it did not create: the demo
    // account was once locked out by a previous run's failed sign-ins, and five tests
    // reported an application bug that did not exist. Real-server behaviour is covered by
    // `pnpm test:integration` with INTEGRATION_DATABASE_URL set.
    env: { DATABASE_URL: '' },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
