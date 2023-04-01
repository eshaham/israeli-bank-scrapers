import IsracardScraper from './isracard';
import {
  maybeTestCompanyAPI, extendAsyncTimeout, getTestsConfig, exportTransactions,
} from '../tests/tests-utils';
import { SCRAPERS } from '../definitions';
import { LoginResults } from './base-scraper-with-browser';

const COMPANY_ID = 'isracard'; // TODO this property should be hard-coded in the provider
const testsConfig = getTestsConfig();

describe('Isracard legacy scraper', () => {
  beforeAll(() => {
    extendAsyncTimeout(); // The default timeout is 5 seconds per async test, this function extends the timeout value
  });

  test('should expose login fields in scrapers constant', () => {
    expect(SCRAPERS.isracard).toBeDefined();
    expect(SCRAPERS.isracard.loginFields).toContain('id');
    expect(SCRAPERS.isracard.loginFields).toContain('card6Digits');
    expect(SCRAPERS.isracard.loginFields).toContain('password');
  });

  maybeTestCompanyAPI(COMPANY_ID, (config) => config.companyAPI.invalidPassword)('should fail on invalid user/password"', async () => {
    const options = {
      ...testsConfig.options,
      companyId: COMPANY_ID,
    };

    const scraper = new IsracardScraper(options);

    const result = await scraper.scrape({ id: 'e10s12', password: '3f3ss3d', card6Digits: '123456' });

    expect(result).toBeDefined();
    expect(result.success).toBeFalsy();
    expect(result.errorType).toBe(LoginResults.InvalidPassword);
  });

  maybeTestCompanyAPI(COMPANY_ID)('should scrape transactions"', async () => {
    const options = {
      ...testsConfig.options,
      companyId: COMPANY_ID,
    };

    const scraper = new IsracardScraper(options);
    const result = await scraper.scrape(testsConfig.credentials.isracard);
    expect(result).toBeDefined();
    const error = `${result.errorType || ''} ${result.errorMessage || ''}`.trim();
    expect(error).toBe('');
    expect(result.success).toBeTruthy();

    exportTransactions(COMPANY_ID, result.accounts || []);
  });
});
