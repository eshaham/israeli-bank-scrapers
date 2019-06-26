import testConfig from './tests-config';

export function maybeTestCompanyAPI(scraperId, filter) {
  return testConfig && testConfig.companyAPI.enabled &&
  testConfig.credentials[scraperId] &&
  (!filter || filter(testConfig)) ? test : test.skip;
}

export function extendAsyncTimeout(timeout = 120000) {
  jest.setTimeout(timeout);
}
