import AMEXScraper from './amex';
import {
  maybeTestCompanyAPI, extendAsyncTimeout, getTestsConfig, saveAccountsAsCSV, getDistFolder,
} from '../../tests/tests-utils';
import { SCRAPERS } from '../definitions';
import { LOGIN_RESULT } from '../constants';

const COMPANY_ID = 'amex';
const testsConfig = getTestsConfig();

describe('AMEX legacy scraper', () => {
  beforeAll(() => {
    extendAsyncTimeout(); // The default timeout is 5 seconds per async test, this function extends the timeout value
  });

  test('should expose login fields in scrapers constant', () => {
    expect(SCRAPERS.amex).toBeDefined();
    expect(SCRAPERS.amex.loginFields).toContain('id');
    expect(SCRAPERS.amex.loginFields).toContain('card6Digits');
    expect(SCRAPERS.amex.loginFields).toContain('password');
  });

  maybeTestCompanyAPI(COMPANY_ID, 'invalidLogin')('should fail on invalid user/password"', async () => {
    const options = {
      ...testsConfig.options,
      companyId: COMPANY_ID,
    };

    const scraper = new AMEXScraper(options);

    const result = await scraper.scrape({ username: 'e10s12', password: '3f3ss3d' });

    expect(result).toBeDefined();
    expect(result.success).toBeFalsy();
    expect(result.errorType).toBe(LOGIN_RESULT.INVALID_PASSWORD);
  });

  maybeTestCompanyAPI(COMPANY_ID, 'legacy')('should scrape transactions"', async () => {
    const options = {
      ...testsConfig.options,
      companyId: COMPANY_ID,
    };

    const scraper = new AMEXScraper(options);
    const result = await scraper.scrape(testsConfig.credentials.amex);
    expect(result).toBeDefined();
    const error = `${result.errorType || ''} ${result.errorMessage || ''}`.trim();
    expect(error).toBe('');
    expect(result.success).toBeTruthy();

    const csvDistFolder = getDistFolder('transactions');
    saveAccountsAsCSV(csvDistFolder, COMPANY_ID, result.accounts || []);
  });
});
