import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

/**
 * Fixed, obviously-fake values. Tests must not depend on a developer's .env, and a suite
 * that silently reads real credentials is a suite that behaves differently on every
 * machine.
 *
 * `DATABASE_URL` is pinned empty rather than merely left unset. This block is merged over
 * the ambient environment, so an empty string is what actually stops an exported
 * DATABASE_URL from redirecting the suite at a real server — and that is not theoretical:
 * an earlier run reached the hosted database, created its fixture users there, and left
 * demo seeding permanently skipped because the user table was no longer empty.
 */
export const TEST_ENV = {
  NODE_ENV: 'test',
  DATABASE_URL: '',
  PSEUDONYM_KEY_V1: 'test-only-pseudonym-key-0000000000000000000000000000',
  PSEUDONYM_KEY_VERSION: '1',
} as const;

// Vitest transforms with esbuild, which does not emit decorator metadata, so Nest's
// constructor injection resolves to undefined. SWC emits it and keeps the DI idiomatic.
export const swcPlugin = swc.vite({ module: { type: 'es6' } });

export default defineConfig({
  plugins: [swcPlugin],
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    env: { ...TEST_ENV },
  },
});
