import { maybeTestCompanyAPI, extendAsyncTimeout, getTestsConfig, exportTransactions } from '../tests/tests-utils';
import { SCRAPERS } from '../definitions';
import * as fetchHelpers from '../helpers/fetch';
import { LoginResults } from './base-scraper-with-browser';
import { ScraperErrorTypes } from './errors';
import OneZeroScraper from './one-zero';

const COMPANY_ID = 'oneZero'; // TODO this property should be hard-coded in the provider
const testsConfig = getTestsConfig();

function makeFakeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.signature`;
}

describe('OneZero scraper', () => {
  beforeAll(() => {
    extendAsyncTimeout(); // The default timeout is 5 seconds per async test, this function extends the timeout value
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('should expose login fields in scrapers constant', () => {
    expect(SCRAPERS.oneZero).toBeDefined();
    expect(SCRAPERS.oneZero.loginFields).toContain('email');
    expect(SCRAPERS.oneZero.loginFields).toContain('password');
    expect(SCRAPERS.oneZero.loginFields).toContain('otpCodeRetriever');
    expect(SCRAPERS.oneZero.loginFields).toContain('phoneNumber');
    expect(SCRAPERS.oneZero.loginFields).toContain('otpLongTermToken');
    expect(SCRAPERS.oneZero.loginFields).toContain('idToken');
  });

  test('login() exchanges otpToken for idToken and returns idToken as persistentOtpToken', async () => {
    const fakeOtpToken = makeFakeJwt({ tokenType: 'otpToken' });
    const fakeIdToken = makeFakeJwt({ tokenType: 'idToken' });
    const fetchPostSpy = jest
      .spyOn(fetchHelpers, 'fetchPost')
      .mockResolvedValueOnce({ resultData: { idToken: fakeIdToken } })
      .mockResolvedValueOnce({ resultData: { accessToken: 'fake-access-token' } });

    const scraper = new OneZeroScraper({ ...testsConfig.options, companyId: COMPANY_ID });
    const loginResult = await scraper.login({
      email: 'e10s12@gmail.com',
      password: 'some-password',
      otpLongTermToken: fakeOtpToken,
    });

    expect(loginResult).toEqual({
      success: true,
      persistentOtpToken: fakeIdToken,
    });
    expect(fetchPostSpy).toHaveBeenCalledTimes(2);
    expect(fetchPostSpy).toHaveBeenNthCalledWith(
      1,
      'https://identity.tfd-bank.com/v1/getIdToken',
      expect.objectContaining({ otpSmsToken: fakeOtpToken }),
      expect.objectContaining({ 'User-Agent': expect.stringContaining('ONEZEROIL') }),
      expect.objectContaining({ cert: expect.any(String), key: expect.any(String) }),
    );
    expect(fetchPostSpy).toHaveBeenNthCalledWith(
      2,
      'https://identity.tfd-bank.com/v1/sessions/token',
      expect.objectContaining({ idToken: fakeIdToken }),
      expect.objectContaining({ 'User-Agent': expect.stringContaining('ONEZEROIL') }),
      expect.objectContaining({ cert: expect.any(String), key: expect.any(String) }),
    );
  });

  test('login() with a saved idToken in otpLongTermToken skips getIdToken and calls sessions/token directly', async () => {
    const fakeIdToken = makeFakeJwt({ tokenType: 'idToken' });
    const fetchPostSpy = jest
      .spyOn(fetchHelpers, 'fetchPost')
      .mockResolvedValueOnce({ resultData: { accessToken: 'fake-access-token' } });

    const scraper = new OneZeroScraper({ ...testsConfig.options, companyId: COMPANY_ID });
    const loginResult = await scraper.login({
      email: 'e10s12@gmail.com',
      password: 'some-password',
      otpLongTermToken: fakeIdToken,
    });

    expect(loginResult).toEqual({
      success: true,
      persistentOtpToken: fakeIdToken,
    });
    expect(fetchPostSpy).toHaveBeenCalledTimes(1);
    expect(fetchPostSpy).toHaveBeenCalledWith(
      'https://identity.tfd-bank.com/v1/sessions/token',
      expect.objectContaining({ idToken: fakeIdToken }),
      expect.objectContaining({ 'User-Agent': expect.stringContaining('ONEZEROIL') }),
      expect.objectContaining({ cert: expect.any(String), key: expect.any(String) }),
    );
  });

  test('login() with credentials.idToken skips SMS verification and goes straight to sessions/token', async () => {
    const fetchPostSpy = jest
      .spyOn(fetchHelpers, 'fetchPost')
      .mockResolvedValueOnce({ resultData: { accessToken: 'fake-access-token' } });

    const scraper = new OneZeroScraper({ ...testsConfig.options, companyId: COMPANY_ID });
    const loginResult = await scraper.login({
      email: 'e10s12@gmail.com',
      password: 'some-password',
      idToken: 'saved-id-token',
    });

    expect(loginResult).toEqual({
      success: true,
      persistentOtpToken: 'saved-id-token',
    });
    expect(scraper.idToken).toBe('saved-id-token');
    expect(fetchPostSpy).toHaveBeenCalledTimes(1);
    expect(fetchPostSpy).toHaveBeenCalledWith(
      'https://identity.tfd-bank.com/v1/sessions/token',
      expect.objectContaining({ idToken: 'saved-id-token' }),
      expect.objectContaining({ 'User-Agent': expect.stringContaining('ONEZEROIL') }),
      expect.objectContaining({ cert: expect.any(String), key: expect.any(String) }),
    );
  });

  test('login() returns TwoFactorRetrieverMissing when a saved JWT otpLongTermToken is expired or rejected', async () => {
    const expiredOtpJwt = makeFakeJwt({ tokenType: 'otpToken', exp: 1000 });
    jest.spyOn(fetchHelpers, 'fetchPost').mockResolvedValueOnce({ errorResponse: { type: 'ErrorInvalidToken' } });

    const scraper = new OneZeroScraper({ ...testsConfig.options, companyId: COMPANY_ID });
    const loginResult = await scraper.login({
      email: 'e10s12@gmail.com',
      password: 'some-password',
      otpLongTermToken: expiredOtpJwt,
    });

    expect(loginResult).toEqual({
      success: false,
      errorType: ScraperErrorTypes.TwoFactorRetrieverMissing,
      errorMessage: expect.stringContaining('SMS OTP verification is required'),
    });
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
