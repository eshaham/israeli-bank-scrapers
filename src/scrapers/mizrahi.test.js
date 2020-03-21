
import MizrahiScraper from './mizrahi';
import {
  maybeTestCompanyAPI, extendAsyncTimeout, getTestsConfig, saveTransactionsAsCSV, getDistFolder,
} from '../../tests/tests-utils';
import { SCRAPERS } from '../definitions';
import { LOGIN_RESULT } from '../constants';

const COMPANY_ID = 'mizrahi';
const DATA_TYPE = 'legacy';
const testsConfig = getTestsConfig();

describe('Mizrahi legacy scraper', () => {
  beforeAll(() => {
    extendAsyncTimeout(); // The default timeout is 5 seconds per async test, this function extends the timeout value
  });

  test('should expose login fields in scrapers constant', () => {
    expect(SCRAPERS.mizrahi).toBeDefined();
    expect(SCRAPERS.mizrahi.loginFields).toContain('username');
    expect(SCRAPERS.mizrahi.loginFields).toContain('password');
  });

  maybeTestCompanyAPI(COMPANY_ID, 'invalidLogin')('should fail on invalid user/password"', async () => {
    const options = {
      ...testsConfig.options,
      companyId: COMPANY_ID,
    };

    const scraper = new MizrahiScraper(options);

    const result = await scraper.scrape({ username: 'e10s12', password: '3f3ss3d' });

    expect(result).toBeDefined();
    expect(result.success).toBeFalsy();
    expect(result.errorType).toBe(LOGIN_RESULT.INVALID_PASSWORD);
  });

  maybeTestCompanyAPI(COMPANY_ID, DATA_TYPE)('should scrape transactions"', async () => {
    const options = {
      ...testsConfig.options,
      companyId: COMPANY_ID,
    };

    const scraper = new MizrahiScraper(options);
    const result = await scraper.scrape(testsConfig.credentials.mizrahi);
    expect(result).toBeDefined();
    const error = `${result.errorType || ''} ${result.errorMessage || ''}`.trim();
    expect(error).toBe('');
    expect(result.success).toBeTruthy();

    const csvDistFolder = getDistFolder(DATA_TYPE);
    saveTransactionsAsCSV(csvDistFolder, COMPANY_ID, result.accounts || []);
  });
});
