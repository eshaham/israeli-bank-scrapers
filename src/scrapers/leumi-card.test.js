import LeumiCardScraper from './leumi-card';
import {
  maybeTestCompanyAPI, extendAsyncTimeout, getTestsConfig, saveTransactionsAsCSV, getDistFolder,
} from '../../tests/tests-utils';
import { SCRAPERS } from '../definitions';
import { LOGIN_RESULT } from '../constants';

const COMPANY_ID = 'leumiCard';
const testsConfig = getTestsConfig();

describe('Leumi Card legacy scraper', () => {
  beforeAll(() => {
    extendAsyncTimeout(); // The default timeout is 5 seconds per async test, this function extends the timeout value
  });

  test('should expose login fields in scrapers constant', () => {
    expect(SCRAPERS.leumiCard).toBeDefined();
    expect(SCRAPERS.leumiCard.loginFields).toContain('username');
    expect(SCRAPERS.leumiCard.loginFields).toContain('password');
  });

  maybeTestCompanyAPI(COMPANY_ID, 'invalidLogin')('should fail on invalid user/password"', async () => {
    const options = {
      ...testsConfig.options,
      companyId: COMPANY_ID,
    };

    const scraper = new LeumiCardScraper(options);

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

    const scraper = new LeumiCardScraper(options);
    const result = await scraper.scrape(testsConfig.credentials.leumiCard);
    expect(result).toBeDefined();
    const error = `${result.errorType || ''} ${result.errorMessage || ''}`.trim();
    expect(error).toBe('');
    expect(result.success).toBeTruthy();

    const csvDistFolder = getDistFolder('transactions');
    saveTransactionsAsCSV(csvDistFolder, COMPANY_ID, result.accounts || []);
  });
});
