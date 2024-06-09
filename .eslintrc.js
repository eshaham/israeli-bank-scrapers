module.exports = {
  root: true,
  'rules': {
    'import/prefer-default-export': 0,
    'no-multiple-empty-lines':0,
    'no-nested-ternary': 0,
    'class-methods-use-this': 0,
    'arrow-body-style': 0,
    'no-shadow': 0,
    'no-await-in-loop': 0,
    'no-restricted-syntax': [
      'error',
      'ForInStatement',
      'LabeledStatement',
      'WithStatement',
    ],
    'operator-linebreak': ['error', 'after'],
    'max-len': ['error', 120, 2, {
      'ignoreUrls': true,
      'ignoreComments': true,
      'ignoreRegExpLiterals': true,
      'ignoreStrings': true,
      'ignoreTemplateLiterals': true,
      'ignorePattern': '^(async )?function ',
    }],
    'linebreak-style': process.platform === 'win32' ? 0 : 2,
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
    '@typescript-eslint/member-delimiter-style': [ 'error', {
      multiline: {
        delimiter: 'semi',
        requireLast: true,
      },
      singleline: {
        delimiter: 'comma',
        requireLast: false,
      },
    }],
  },
  'globals': {
    'document': true,
    'window': true,
    'fetch': true,
    'Headers': true,
  },
  'env': {
    'jest': true,
  },
  parserOptions:  {
    project: './tsconfig.json',
    ecmaVersion:  2018,  // Allows for the parsing of modern ECMAScript features
    sourceType:  'module',  // Allows for the use of imports
  },
  extends: ['airbnb-typescript/base',
    'plugin:@typescript-eslint/eslint-recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-requiring-type-checking',
    'plugin:import/errors',
  ],
    
};
