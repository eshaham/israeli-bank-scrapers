// Focused offline mapper tests: the default setup loads credential configuration.
module.exports = {
  ...require('./jest.config'),
  setupFilesAfterEnv: [],
  testMatch: ['<rootDir>/scrapers/visa-cal.transactions.test.ts'],
};
