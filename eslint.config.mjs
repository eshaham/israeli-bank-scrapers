import globals from 'globals';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import-x';
import eslintConfigPrettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: ['lib/**', 'node_modules/**', '**/.eslintrc.js'],
  },

  // Main config for all TS source files
  {
    files: ['src/**/*.ts'],

    extends: [
      // Base ESLint recommended rules (with TS overrides)
      tseslint.configs.eslintRecommended,

      // TypeScript recommended + type-checked rules
      ...tseslint.configs.recommendedTypeChecked,

      // Import plugin: errors + TypeScript resolver
      importPlugin.flatConfigs.errors,
      importPlugin.flatConfigs.typescript,

      // Prettier: disable formatting rules (must be last)
      eslintConfigPrettier,
    ],

    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.jest,
        ...globals.browser,
      },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    settings: {
      'import-x/resolver': {
        typescript: true,
      },
    },
    rules: {
      // --- Rules carried over from airbnb-base ---
      'no-console': 'error',
      'no-param-reassign': ['error', { props: false }],
      'no-restricted-syntax': ['error', 'ForInStatement', 'LabeledStatement', 'WithStatement'],
      'prefer-const': 'error',
      'no-var': 'error',
      'eqeqeq': ['error', 'always', { null: 'ignore' }],
      'no-eval': 'error',
      'no-implied-eval': 'off',
      'no-throw-literal': 'off',
      'no-unused-expressions': 'off',
      'no-return-assign': ['error', 'always'],
      'prefer-template': 'error',
      'prefer-rest-params': 'error',
      'prefer-spread': 'error',

      // Import rules
      'import-x/prefer-default-export': 'off',
      'import-x/no-extraneous-dependencies': 'error',

      // --- Explicit overrides from original config ---
      'quotes': ['error', 'single', { avoidEscape: true }],
      'no-nested-ternary': 'off',
      'class-methods-use-this': 'off',
      'arrow-body-style': 'off',
      'no-shadow': 'off',
      'no-await-in-loop': 'off',

      // TypeScript rules
      '@typescript-eslint/no-shadow': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-unary-minus': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/prefer-promise-reject-errors': 'off',
      '@typescript-eslint/no-implied-eval': 'error',
      '@typescript-eslint/only-throw-error': 'error',
      '@typescript-eslint/no-unused-expressions': 'error',
      '@typescript-eslint/no-unused-vars': ['error', {
        ignoreRestSiblings: true,
        caughtErrors: 'none',
      }],
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        {
          allowNever: true,
        },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          fixStyle: 'inline-type-imports',
        },
      ],
    },
  },

  // Test file overrides
  {
    files: ['src/tests/**/*.ts'],
    rules: {
      'import-x/no-extraneous-dependencies': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      'no-console': 'off',
    },
  },
);
