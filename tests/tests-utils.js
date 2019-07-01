let testsConfig = null;
let configurationLoaded = false;

const MISSING_ERROR_MESSAGE = 'Missing environment test configuration. To troubleshot this issue open CONTRIBUTING.md file and read section "F.A.Q regarding the tests".';

export function getTestsConfig() {
  if (configurationLoaded) {
    if (!testsConfig) {
      throw new Error(MISSING_ERROR_MESSAGE);
    }

    return testsConfig;
  }

  configurationLoaded = true;

  try {
    const environmentConfig = process.env.TESTS_CONFIG;
    if (environmentConfig) {
      testsConfig = JSON.parse(environmentConfig);
      return testsConfig;
    }
  } catch (e) {
    throw new Error(`failed to parse environment variable 'TESTS_CONFIG' with error '${e.message}'`);
  }

  try {
    testsConfig = require('./.tests-config').default;
    return process.env;
  } catch (e) {
    throw new Error(MISSING_ERROR_MESSAGE);
  }
}

export function maybeTestCompanyAPI(scraperId, filter) {

  if (!configurationLoaded) {
    getTestsConfig();
  }
  return testsConfig && testsConfig.companyAPI.enabled &&
  testsConfig.credentials[scraperId] &&
  (!filter || filter(testsConfig)) ? test : test.skip;
}

export function extendAsyncTimeout(timeout = 120000) {
  jest.setTimeout(timeout);
}
