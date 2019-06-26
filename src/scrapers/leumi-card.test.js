import LeumiCardScraper from './leumi-card';
import testConfig from '../../tests/tests-config';
import { maybeTestCompanyAPI, extendAsyncTimeout } from '../../tests/tests-utils';
import { SCRAPERS } from '../definitions';
import { LOGIN_RESULT } from '../constants';

const COMPANY_ID = 'leumiCard'; // TODO this property should be hard-coded in the provider

describe('Leumi card legacy scraper', () => {
  beforeAll(() => {
    extendAsyncTimeout(); // The default timeout is 5 seconds per async test, this function extends the timeout value
  });

  test('should expose login fields in scrapers constant', () => {
    expect(SCRAPERS.leumi).toBeDefined();
    expect(SCRAPERS.leumi.loginFields).toContain('username');
    expect(SCRAPERS.leumi.loginFields).toContain('password');
  });

  maybeTestCompanyAPI(COMPANY_ID, config => config.companyAPI.invalidPassword)('should fail on invalid user/password"', async () => {
    const options = {
      ...testConfig.options,
      companyId: COMPANY_ID,
    };

    const scraper = new LeumiCardScraper(options);

    const result = await scraper.scrape({ username: 'e10s12', password: '3f3ss3d' });

    expect(result).toBeDefined();
    expect(result.success).toBeFalsy();
    expect(result.errorType).toBe(LOGIN_RESULT.INVALID_PASSWORD);
  });

  maybeTestCompanyAPI(COMPANY_ID)('should scrape transactions"', async () => {
    const options = {
      ...testConfig.options,
      companyId: COMPANY_ID,
    };

    const scraper = new LeumiCardScraper(options);
    const result = await scraper.scrape(testConfig.credentials.leumiCard);
    expect(result).toBeDefined();
    expect(result.success).toBeTruthy();
  });
});
