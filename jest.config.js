// For a detailed explanation regarding each configuration property, visit:
// https://jestjs.io/docs/en/configuration.html

module.exports = {
  clearMocks: true,
  coverageDirectory: 'coverage',
  rootDir: './src',
  setupFiles: [
    '../jest-setup.js',
  ],
  testEnvironment: 'node',
};
