// For a detailed explanation regarding each configuration property, visit:
// https://jestjs.io/docs/en/configuration.html

module.exports = {
  clearMocks: true,
  coverageDirectory: 'coverage',
  rootDir: './src',
  "moduleNameMapper": {
    "^@core/constants$": "<rootDir>/constants",
    "^@core/definitions": "<rootDir>/definitions",
    "^@core/runner": "<rootDir>/runner",
    "@core/helpers/(.*)$": "<rootDir>/helpers/$1",
  },
  transform: {
    '^.+\\.ts$': 'ts-jest'
  },
  setupFiles: [
    './tests/jest-setup.ts',
  ],
  testEnvironment: 'node',
};
