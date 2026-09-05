import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

// Deliberately an explicit rule set rather than a broad preset stack.
// Rationale in docs/DECISIONS.md
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
    // These two caps were adopted as the analogue of gocyclo — they are about how much LOGIC a
    // function carries. Applied to a component that returns JSX they measure something else: every
    // line of markup counts toward the length, and every `cond && <El/>` counts as a branch. A view
    // that renders fifteen fields conditionally is data-driven, not complex, and splitting it purely
    // to satisfy a line count buys prop-drilling and indirection rather than clarity.
    //
    // So they are scoped off for the console's components only. They stay in force for every .ts
    // file in this repo, including all of apps/web's hooks, helpers and API clients, and for every
    // other package — which is where logic complexity actually lives and actually matters.
    files: ['apps/web/src/**/*.tsx'],
    rules: { 'max-lines-per-function': 'off', complexity: 'off' },
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
