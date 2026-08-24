import { defineConfig } from 'vitest/config';

// Integration tests arrive in Slice 2 (auth) and Slice 4 (ingestion).
// The config exists from Slice 0 so the slow gate has a stable entry point.
export default defineConfig({
  test: {
    include: ['src/**/*.integration.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    passWithNoTests: true,
  },
});
