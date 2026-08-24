import { defineConfig } from 'vitest/config';
import { TEST_ENV, swcPlugin } from './vitest.config.js';

/**
 * The same integration specs, optionally against a real Postgres server.
 *
 * They already run under the default config on embedded Postgres, which is the fast gate.
 * This one exists to re-run them against a managed instance before deploying, where
 * behaviour can differ — connection pooling, timezone handling, permissions on the
 * `sentinel` schema.
 *
 * Pointing at that server requires setting INTEGRATION_DATABASE_URL explicitly. It
 * deliberately does not read DATABASE_URL: the whole point is that running the suite must
 * never be able to write into the database the application is using by accident.
 *
 * Whatever it points at gets fixture users and login attempts written into it. Use a
 * throwaway database.
 */
export default defineConfig({
  plugins: [swcPlugin],
  test: {
    include: ['src/**/*.integration.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    passWithNoTests: true,
    env: {
      ...TEST_ENV,
      DATABASE_URL: process.env.INTEGRATION_DATABASE_URL ?? '',
    },
  },
});
