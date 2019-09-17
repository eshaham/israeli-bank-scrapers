import { getBrowser, getBrowserPage } from '../../helpers/scraping';
import login from './login';
import {
  maybeTestCompanyAPI, extendAsyncTimeout, getTestsConfig,
} from '../../../tests/tests-utils';
import scrapeChecks from './scrape-checks';
import { getDistFolder } from '../../../tests/tests-utils';

const COMPANY_ID = 'hapoalim';
const testsConfig = getTestsConfig();

describe('Hapoalim scrape checks', () => {
  beforeAll(() => {
    extendAsyncTimeout(); // The default timeout is 5 seconds per async test, this function extends the timeout value
  });

  maybeTestCompanyAPI(COMPANY_ID, config => config.companyAPI.checks.enabled)('should scrape checks', async () => {
    // TODO use separated module
    const browser = await getBrowser({
      verbose: true, // optional
      showBrowser: true, // optional
    });
    const page = await getBrowserPage(browser);

    const loginResult = await login(page, {
      credentials: testsConfig.credentials.hapoalim,
    });

    expect(loginResult).toBeDefined();
    expect(loginResult.success).toBeTruthy();

    const checksDistFolder = getDistFolder('checks');

    const checks = await scrapeChecks({
      userOptions: testsConfig.options,
      page,
      imagesPath: checksDistFolder,
    });

    const bla = '';
  });
});
