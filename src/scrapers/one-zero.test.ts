import { maybeTestCompanyAPI, extendAsyncTimeout, getTestsConfig, exportTransactions } from '../tests/tests-utils';
import { SCRAPERS } from '../definitions';
import { fetchPost } from '../helpers/fetch';
import { LoginResults } from './base-scraper-with-browser';
import OneZeroScraper from './one-zero';

jest.mock('../helpers/fetch');

const COMPANY_ID = 'oneZero'; // TODO this property should be hard-coded in the provider
const testsConfig = getTestsConfig();

describe('OneZero scraper', () => {
  beforeAll(() => {
    extendAsyncTimeout(); // The default timeout is 5 seconds per async test, this function extends the timeout value
  });

  test('should expose login fields in scrapers constant', () => {
    expect(SCRAPERS.oneZero).toBeDefined();
    expect(SCRAPERS.oneZero.loginFields).toContain('email');
    expect(SCRAPERS.oneZero.loginFields).toContain('password');
    expect(SCRAPERS.oneZero.loginFields).toContain('otpCodeRetriever');
    expect(SCRAPERS.oneZero.loginFields).toContain('phoneNumber');
    expect(SCRAPERS.oneZero.loginFields).toContain('otpLongTermToken');
  });

  test('login() with a saved idToken skips SMS verification and goes straight to sessions/token', async () => {
    const options = {
      ...testsConfig.options,
      companyId: COMPANY_ID,
    };

    (fetchPost as jest.Mock).mockResolvedValue({
      resultData: { accessToken: 'fake-access-token' },
    });

    const scraper = new OneZeroScraper(options);
    const loginResult = await scraper.login({
      email: 'e10s12@gmail.com',
      password: 'some-password',
      idToken: 'saved-id-token',
    });

    expect(loginResult.success).toBeTruthy();
    expect(scraper.idToken).toBe('saved-id-token');
    // Only sessions/token should be called — devices/token, otp/prepare,
    // otp/verify and getIdToken must all be skipped.
    expect(fetchPost).toHaveBeenCalledTimes(1);
    expect(fetchPost).toHaveBeenCalledWith(
      expect.stringContaining('/sessions/token'),
      expect.objectContaining({ idToken: 'saved-id-token' }),
      expect.anything(),
      expect.anything(),
    );
  });

  maybeTestCompanyAPI(COMPANY_ID, config => config.companyAPI.invalidPassword)(
    'should fail on invalid user/password"',
    async () => {
      const options = {
        ...testsConfig.options,
        companyId: COMPANY_ID,
      };

      const scraper = new OneZeroScraper(options);

      const result = await scraper.scrape({
        email: 'e10s12@gmail.com',
        password: '3f3ss3d',
        otpLongTermToken: '11111',
      });

      expect(result).toBeDefined();
      expect(result.success).toBeFalsy();
      expect(result.errorType).toBe(LoginResults.InvalidPassword);
    },
  );

  maybeTestCompanyAPI(COMPANY_ID)('should scrape transactions"', async () => {
    const options = {
      ...testsConfig.options,
      companyId: COMPANY_ID,
    };

    const scraper = new OneZeroScraper(options);
    const result = await scraper.scrape(testsConfig.credentials.oneZero);
    expect(result).toBeDefined();
    const error = `${result.errorType || ''} ${result.errorMessage || ''}`.trim();
    expect(error).toBe('');
    expect(result.success).toBeTruthy();

    exportTransactions(COMPANY_ID, result.accounts || []);
  });
});
