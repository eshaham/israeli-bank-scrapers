import LeumiScraper from './leumi';
import {
  maybeTestCompanyAPI, extendAsyncTimeout, getTestsConfig, saveTransactionsAsCSV, getDistFolder,
} from '../../tests/tests-utils';
import { SCRAPERS } from '../definitions';

const COMPANY_ID = 'leumi';
const DATA_TYPE = 'legacy';
const testsConfig = getTestsConfig();

describe('Leumi legacy scraper', () => {
  beforeAll(() => {
    extendAsyncTimeout(); // The default timeout is 5 seconds per async test, this function extends the timeout value
  });

  test('should expose login fields in scrapers constant', () => {
    expect(SCRAPERS.leumi).toBeDefined();
    expect(SCRAPERS.leumi.loginFields).toContain('username');
    expect(SCRAPERS.leumi.loginFields).toContain('password');
  });

  maybeTestCompanyAPI(COMPANY_ID, DATA_TYPE)('should scrape transactions"', async () => {
    const options = {
      ...testsConfig.options,
      companyId: COMPANY_ID,
    };

    const scraper = new LeumiScraper(options);
    const result = await scraper.scrape(testsConfig.credentials.leumi);
    expect(result).toBeDefined();
    const error = `${result.errorType || ''} ${result.errorMessage || ''}`.trim();
    expect(error).toBe('');
    expect(result.success).toBeTruthy();

    const csvDistFolder = getDistFolder(DATA_TYPE);
    saveTransactionsAsCSV(csvDistFolder, COMPANY_ID, result.accounts || []);
  });
});
