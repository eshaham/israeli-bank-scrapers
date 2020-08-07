// For a detailed explanation regarding each configuration property, visit:
// https://jestjs.io/docs/en/configuration.html

module.exports = {
  clearMocks: true,
  coverageDirectory: 'coverage',
  rootDir: './src',
  transform: {
    '^.+\\.ts$': 'ts-jest'
  },
  setupFiles: [
    './tests/jest-setup.ts',
  ],
  testEnvironment: 'node',
};
