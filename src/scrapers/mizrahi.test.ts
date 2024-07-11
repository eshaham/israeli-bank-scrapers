import MizrahiScraper from './mizrahi';
import {
  maybeTestCompanyAPI, extendAsyncTimeout, getTestsConfig, exportTransactions,
} from '../tests/tests-utils';
import { SCRAPERS } from '../definitions';
import { ISO_DATE_REGEX } from '../constants';
import { LoginResults } from './base-scraper-with-browser';
import { type TransactionsAccount } from '../transactions';

const COMPANY_ID = 'mizrahi'; // TODO this property should be hard-coded in the provider
const testsConfig = getTestsConfig();

describe('Mizrahi scraper', () => {
  beforeAll(() => {
    extendAsyncTimeout(); // The default timeout is 5 seconds per async test, this function extends the timeout value
  });

  test('should expose login fields in scrapers constant', () => {
    expect(SCRAPERS.mizrahi).toBeDefined();
    expect(SCRAPERS.mizrahi.loginFields).toContain('username');
    expect(SCRAPERS.mizrahi.loginFields).toContain('password');
  });

  maybeTestCompanyAPI(COMPANY_ID, (config) => config.companyAPI.invalidPassword)('should fail on invalid user/password', async () => {
    const options = {
      ...testsConfig.options,
      companyId: COMPANY_ID,
    };

    const scraper = new MizrahiScraper(options);

    const result = await scraper.scrape({ username: 'e10s12', password: '3f3ss3d' });

    expect(result).toBeDefined();
    expect(result.success).toBeFalsy();
    expect(result.errorType).toBe(LoginResults.InvalidPassword);
  });

  maybeTestCompanyAPI(COMPANY_ID)('should scrape transactions', async () => {
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
    expect(result.accounts).toBeDefined();
    expect((result.accounts as any).length).toBeGreaterThan(0);
    const account: TransactionsAccount = (result as any).accounts[0];
    expect(account.accountNumber).not.toBe('');
    expect(account.txns[0].date).toMatch(ISO_DATE_REGEX);

    exportTransactions(COMPANY_ID, result.accounts || []);
  });
});
