import { createBrowser, createBrowserPage } from '../puppeteer';
import loginAdapter from './login';
import {
  maybeTestCompanyAPI, extendAsyncTimeout, getTestsConfig,
  getDistFolder, saveAccountsAsCSV,
} from '../../../tests/tests-utils';
import scrapeTransactionsAdapter from './scrape-transactions';
import runner from '../runner';

const COMPANY_ID = 'hapoalim';
const DATA_TYPE = 'transactions';
const testsConfig = getTestsConfig();

describe('Hapoalim scrape transactions', () => {
  beforeAll(() => {
    extendAsyncTimeout(); // The default timeout is 5 seconds per async test, this function extends the timeout value
  });

  maybeTestCompanyAPI(COMPANY_ID, DATA_TYPE)('should scrape transactions', async () => {
    const { startDate, verbose, showBrowser, onProgress } = testsConfig.options;

    const options = {
      onProgress,
    };

    const result = await runner(options,
      [
        createBrowser({
          verbose,
          showBrowser,
        }),
        createBrowserPage(),
        loginAdapter({
          credentials: testsConfig.credentials.hapoalim,
        }),
        scrapeTransactionsAdapter({
          startDate,
        }),
      ]);


    if (!result.success) {
      throw new Error(result.errorMessage);
    }
    const csvDistFolder = getDistFolder(DATA_TYPE);
    saveAccountsAsCSV(csvDistFolder, COMPANY_ID, result.data.hapoalim.transactions.accounts || []);
  });
});
