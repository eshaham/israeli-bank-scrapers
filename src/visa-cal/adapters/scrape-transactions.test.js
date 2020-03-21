import _ from 'lodash';
import {
  maybeTestCompanyAPI, extendAsyncTimeout, getTestsConfig,
  getDistFolder, saveTransactionsAsCSV,
} from '../../../tests/tests-utils';
import loginAdapter from './login';
import scrapeTransactionsAdapter from './scrape-transactions';
import runner from '../../runner';

const COMPANY_ID = 'visaCal';
const DATA_TYPE = 'transactions';
const testsConfig = getTestsConfig();

describe('VisaCal scrape transactions', () => {
  beforeAll(() => {
    extendAsyncTimeout(); // The default timeout is 5 seconds per async test, this function extends the timeout value
  });

  maybeTestCompanyAPI(COMPANY_ID, DATA_TYPE)('should scrape transactions', async () => {
    const {
      startDate, onProgress,
    } = testsConfig.options;

    const runnerOptions = {
      onProgress,
    };

    const runnerAdapters = [
      loginAdapter({
        credentials: testsConfig.credentials.visaCal,
      }),
      scrapeTransactionsAdapter({
        startDate,
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

    const csvDistFolder = getDistFolder(DATA_TYPE);
    saveTransactionsAsCSV(csvDistFolder, COMPANY_ID, accounts);
  });
});
