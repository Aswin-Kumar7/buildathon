import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

// Vitest transforms with esbuild, which does not emit decorator metadata, so Nest's
// constructor injection resolves to undefined. SWC emits it and keeps the DI idiomatic.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
