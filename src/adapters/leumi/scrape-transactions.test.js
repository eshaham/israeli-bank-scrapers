import _ from 'lodash';
import {
  maybeTestCompanyAPI, extendAsyncTimeout, getTestsConfig,
  getDistFolder, saveAccountsAsCSV,
} from '../../../tests/tests-utils';
import { createBrowserAdapter, createBrowserPageAdapter, closeBrowserAdapter } from '../puppeteer';
import loginAdapter from './login';
import scrapeTransactionsAdapter from './scrape-transactions';
import runner from '../runner';

const COMPANY_ID = 'leumi';
const DATA_TYPE = 'transactions';
const testsConfig = getTestsConfig();

describe('Leumi scrape transactions', () => {
  beforeAll(() => {
    extendAsyncTimeout(); // The default timeout is 5 seconds per async test, this function extends the timeout value
  });

  maybeTestCompanyAPI(COMPANY_ID, DATA_TYPE)('should scrape transactions', async () => {
    const {
      startDate, verbose, showBrowser, onProgress,
    } = testsConfig.options;

    const runnerOptions = {
      onProgress,
    };

    const runnerAdapters = [
      createBrowserAdapter({
        verbose,
        showBrowser,
      }),
      createBrowserPageAdapter(),
      loginAdapter({
        credentials: testsConfig.credentials.leumi,
      }),
      scrapeTransactionsAdapter({
        startDate,
      }),
    ];

    const cleanupAdapters = [
      closeBrowserAdapter(),
    ];

    const result = await runner(runnerOptions, runnerAdapters, cleanupAdapters);

    if (!result.success) {
      throw new Error(result.errorMessage);
    }

    const resultDataProperty = `${COMPANY_ID}.${DATA_TYPE}`;
    const { accounts } = _.get(result.data, resultDataProperty, {});

    if (!accounts) {
      throw new Error(`result data is missing property '${resultDataProperty}'`);
    }

    const csvDistFolder = getDistFolder(DATA_TYPE);
    saveAccountsAsCSV(csvDistFolder, COMPANY_ID, accounts);
  });
});
