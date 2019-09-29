import moment from 'moment';
import path from 'path';
import { getBrowser, getBrowserPage } from '../puppeteer';
import login from './login';
import {
  maybeTestCompanyAPI, extendAsyncTimeout, getTestsConfig,
  getDistFolder, saveAccountsAsCSV,
} from '../../../tests/tests-utils';
import scrapeChecks from './scrape-checks';


const COMPANY_ID = 'hapoalim';
const testsConfig = getTestsConfig();

describe('Hapoalim scrape checks', () => {
  beforeAll(() => {
    extendAsyncTimeout(); // The default timeout is 5 seconds per async test, this function extends the timeout value
  });

  maybeTestCompanyAPI(COMPANY_ID, 'checks')('should scrape checks', async () => {
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

    const subFolder = path.resolve('checks', moment().format('YYYYMMDD-HHmmss'));
    const dist = getDistFolder(subFolder);

    const result = await scrapeChecks({
      startDate: testsConfig.options.startDate,
      page,
      imagesPath: dist,
    });


    saveAccountsAsCSV(dist, COMPANY_ID, result.accounts || []);
  });
});
