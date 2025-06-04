module.exports = {
  root: true,
  rules: {
    'quotes': ['error', 'single', { avoidEscape: true }],
    'import/prefer-default-export': 0,
    'no-nested-ternary': 0,
    'class-methods-use-this': 0,
    'arrow-body-style': 0,
    'no-shadow': 0,
    'no-await-in-loop': 0,
    'no-restricted-syntax': ['error', 'ForInStatement', 'LabeledStatement', 'WithStatement'],
    '@typescript-eslint/explicit-function-return-type': 0,
    '@typescript-eslint/no-explicit-any': 0,
    '@typescript-eslint/ban-ts-ignore': 0,
    '@typescript-eslint/no-non-null-assertion': 0,
    '@typescript-eslint/no-unsafe-member-access': 0,
    '@typescript-eslint/no-unsafe-call': 0,
    '@typescript-eslint/no-unsafe-assignment': 0,
    '@typescript-eslint/no-unsafe-argument': 0,
    '@typescript-eslint/no-unsafe-return': 0,
    '@typescript-eslint/ban-ts-comment': 0,
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
  globals: {
    document: true,
    window: true,
    fetch: true,
    Headers: true,
  },
  env: {
    jest: true,
    node: true,
    es2022: true,
  },
  parserOptions: {
    project: './tsconfig.json',
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  extends: [
    'airbnb-typescript/base',
    'plugin:@typescript-eslint/eslint-recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-requiring-type-checking',
    'plugin:import/errors',
    'prettier',
  ],
};
