// For a detailed explanation regarding each configuration property, visit:
// https://jestjs.io/docs/en/configuration.html
/** @type {import('jest').Config} */
const config= {
  preset: 'ts-jest/presets/js-with-babel',
  clearMocks: true,
  coverageDirectory: 'coverage',
  rootDir: './src',
  transform: {
    '^.+\\.ts$': 'ts-jest'
  },
  setupFilesAfterEnv: [
    './tests/jest-setup.ts',
  ],
  testEnvironment: 'node',
  globals: {
    'ts-jest': {
      babelConfig: true,
    }
  },
};

module.exports = config;