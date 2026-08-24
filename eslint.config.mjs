import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

// Deliberately an explicit rule set rather than a broad preset stack.
// Rationale in docs/adr/2026-08-24-0001-monorepo-and-toolchain.md
export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', '**/.turbo/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      // complexity caps — the analogue of gocyclo.min-complexity
      complexity: ['error', 15],
      'max-depth': ['error', 4],
      'max-lines-per-function': ['error', { max: 80, skipBlankLines: true, skipComments: true }],

      // correctness
      eqeqeq: ['error', 'always'],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'no-return-await': 'error',
      'prefer-const': 'error',

      // typescript
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts'],
    rules: { 'max-lines-per-function': 'off' },
  },
  {
    // NestJS resolves constructor dependencies from `design:paramtypes` metadata emitted
    // at runtime. A class used only as a constructor parameter type looks type-only to
    // TypeScript, so this rule's autofix rewrites it to `import type` and silently breaks
    // dependency injection — the failure surfaces at boot, not at compile time.
    files: ['apps/api/**/*.ts'],
    rules: { '@typescript-eslint/consistent-type-imports': 'off' },
  },
);
