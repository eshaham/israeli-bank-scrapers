import _ from 'lodash';
import {
  maybeTestCompanyAPI, extendAsyncTimeout, getTestsConfig,
  getUniqueDistFolder, saveAccountsAsCSV,
} from '../../../tests/tests-utils';
import { createBrowser, createBrowserPage } from '../puppeteer';
import loginAdapter from './login';
import scrapeChecksAdapter from './scrape-checks';
import runner from '../runner';

const COMPANY_ID = 'hapoalim';
const DATA_TYPE = 'checks';
const testsConfig = getTestsConfig();

describe('Hapoalim scrape checks', () => {
  beforeAll(() => {
    extendAsyncTimeout(); // The default timeout is 5 seconds per async test, this function extends the timeout value
  });

  maybeTestCompanyAPI(COMPANY_ID, DATA_TYPE)('should scrape transactions', async () => {
    const {
      startDate, verbose, showBrowser, onProgress,
    } = testsConfig.options;

    const dist = getUniqueDistFolder(DATA_TYPE);

    const runnerOptions = {
      onProgress,
    };

    const runnerAdapters = [
      createBrowser({
        verbose,
        showBrowser,
      }),
      createBrowserPage(),
      loginAdapter({
        credentials: testsConfig.credentials.hapoalim,
      }),
      scrapeChecksAdapter({
        startDate,
        imagesPath: dist,
      }),
    ];

    const result = await runner(runnerOptions, runnerAdapters);

    if (!result.success) {
      throw new Error(result.errorMessage);
    }

    const resultDataProperty = `${COMPANY_ID}.${DATA_TYPE}`;
    const { accounts } = _.get(result.data, resultDataProperty, {});

    if (!accounts) {
      throw new Error(`result data is missing property '${resultDataProperty}'`);
    }

    saveAccountsAsCSV(dist, COMPANY_ID, accounts);
  });
});
