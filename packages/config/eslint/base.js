import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import importX from 'eslint-plugin-import-x';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Base config shared by every workspace package.
 *
 * Type-aware rules are scoped to `.ts`/`.tsx` only. Config files (`*.config.js`,
 * `eslint.config.js`) are plain JS outside every tsconfig program, so pointing
 * type-aware rules at them would fail to resolve a project.
 *
 * `strictTypeChecked` is deliberate: the spec forbids `any` and `@ts-ignore` in new code,
 * and only the type-aware rules can actually enforce that.
 *
 * @param {{ tsconfigRootDir: string }} options
 * @returns {import('typescript-eslint').ConfigArray}
 */
export function baseConfig({ tsconfigRootDir }) {
  return tseslint.config(
    {
      ignores: [
        '**/dist/**',
        '**/build/**',
        '**/coverage/**',
        '**/storybook-static/**',
        '**/playwright-report/**',
        '**/.turbo/**',
        '**/node_modules/**',
        'silkgrain-design-prompt/**',
      ],
    },
    js.configs.recommended,
    {
      files: ['**/*.ts', '**/*.tsx'],
      extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
      languageOptions: {
        parserOptions: {
          projectService: true,
          tsconfigRootDir,
        },
      },
      plugins: {
        'import-x': importX,
      },
      rules: {
        // --- correctness ---
        '@typescript-eslint/no-explicit-any': 'error',
        '@typescript-eslint/ban-ts-comment': [
          'error',
          { 'ts-expect-error': 'allow-with-description', 'ts-ignore': true, 'ts-nocheck': true },
        ],
        '@typescript-eslint/no-floating-promises': 'error',
        '@typescript-eslint/no-misused-promises': 'error',
        '@typescript-eslint/switch-exhaustiveness-check': 'error',
        '@typescript-eslint/no-unnecessary-condition': 'warn',
        'no-console': ['error', { allow: ['warn', 'error'] }],
        eqeqeq: ['error', 'always', { null: 'ignore' }],

        // --- money safety: currency formatting lives in exactly one place ---
        'no-restricted-syntax': [
          'error',
          {
            selector:
              "NewExpression[callee.object.name='Intl'][callee.property.name='NumberFormat']",
            message: 'Format money through Money.format() so currency handling stays in one place.',
          },
        ],

        // --- style ---
        '@typescript-eslint/consistent-type-imports': [
          'error',
          { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
        ],
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
        ],
        'import-x/order': [
          'error',
          {
            groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index', 'type'],
            pathGroups: [{ pattern: '@silkgrain/**', group: 'internal', position: 'before' }],
            'newlines-between': 'always',
            alphabetize: { order: 'asc', caseInsensitive: true },
          },
        ],
        'import-x/no-duplicates': 'error',
      },
    },
    {
      // Build and tooling config files: plain JS, no type information available.
      files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
      languageOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        globals: { ...globals.node },
      },
      rules: {
        'no-console': 'off',
      },
    },
    {
      files: ['**/*.test.ts', '**/*.test.tsx', '**/tests/**/*.ts'],
      rules: {
        '@typescript-eslint/no-non-null-assertion': 'off',
        '@typescript-eslint/no-unsafe-assignment': 'off',
      },
    },
    prettier,
  );
}

export default baseConfig;
