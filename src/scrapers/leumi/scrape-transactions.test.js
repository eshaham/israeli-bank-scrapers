import { getBrowser, getBrowserPage } from '../../helpers/scraping';
import login from './login';
import {
  maybeTestCompanyAPI, extendAsyncTimeout, getTestsConfig,
  getDistFolder, saveAccountsAsCSV
} from '../../../tests/tests-utils';
import scrapeTransactions from './scrape-transactions';


const COMPANY_ID = 'leumi';
const testsConfig = getTestsConfig();
const category = 'transactions';


describe('Leumi scrape transactions', () => {
  beforeAll(() => {
    extendAsyncTimeout(); // The default timeout is 5 seconds per async test, this function extends the timeout value
  });

  maybeTestCompanyAPI(COMPANY_ID, category)('should scrape transactions', async () => {
    // TODO use separated module
    const browser = await getBrowser({
      verbose: true, // optional
      showBrowser: true, // optional
    });
    const page = await getBrowserPage(browser);

    const loginResult = await login(page, {
      credentials: testsConfig.credentials.leumi,
    });

    expect(loginResult).toBeDefined();
    expect(loginResult.success).toBeTruthy();

    const result = await scrapeTransactions({
      startDate: testsConfig.options.startDate,
      page,
    });

    const csvDistFolder = getDistFolder(category);
    saveAccountsAsCSV(csvDistFolder, COMPANY_ID, result.accounts || []);
  });
});
