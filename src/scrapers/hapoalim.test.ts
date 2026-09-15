import HapoalimScraper from './hapoalim';
import { maybeTestCompanyAPI, extendAsyncTimeout, getTestsConfig, exportTransactions } from '../tests/tests-utils';
import { CompanyTypes, SCRAPERS } from '../definitions';
import { BaseScraperWithBrowser, LoginResults } from './base-scraper-with-browser';
import { ScraperErrorTypes } from './errors';
import { type ScraperOptions } from './interface';

const COMPANY_ID = 'hapoalim'; // TODO this property should be hard-coded in the provider
const testsConfig = getTestsConfig();

function buildScraper(): HapoalimScraper {
  return new HapoalimScraper({ companyId: CompanyTypes.hapoalim, startDate: new Date() } as unknown as ScraperOptions);
}

describe('Hapoalim legacy scraper', () => {
  beforeAll(() => {
    extendAsyncTimeout(); // The default timeout is 5 seconds per async test, this function extends the timeout value
  });

  test('should expose login fields in scrapers constant', () => {
    expect(SCRAPERS.hapoalim).toBeDefined();
    expect(SCRAPERS.hapoalim.loginFields).toContain('userCode');
    expect(SCRAPERS.hapoalim.loginFields).toContain('password');
  });

  maybeTestCompanyAPI(COMPANY_ID, config => config.companyAPI.invalidPassword)(
    'should fail on invalid user/password"',
    async () => {
      const options = {
        ...testsConfig.options,
        companyId: COMPANY_ID,
      };

      const scraper = new HapoalimScraper(options);

      const result = await scraper.scrape({ userCode: 'e10s12', password: '3f3ss3d' });

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

    const scraper = new HapoalimScraper(options);
    const result = await scraper.scrape(testsConfig.credentials.hapoalim);
    expect(result).toBeDefined();
    const error = `${result.errorType || ''} ${result.errorMessage || ''}`.trim();
    expect(error).toBe('');
    expect(result.success).toBeTruthy();

    exportTransactions(COMPANY_ID, result.accounts || []);
  });
});

describe('Hapoalim 2FA (OTP)', () => {
  describe('OTP-form detection', () => {
    function getOtpDetector() {
      const loginOptions = buildScraper().getLoginOptions({ userCode: 'x', password: 'y' });
      const conditions = loginOptions.possibleResults[LoginResults.TwoFactorRetrieverMissing];
      expect(Array.isArray(conditions)).toBe(true);
      const detector = conditions![0];
      expect(typeof detector).toBe('function');
      return detector as (options?: { page?: any }) => Promise<boolean>;
    }

    test('detects the OTP form by selector', async () => {
      const detector = getOtpDetector();
      const page = { $: jest.fn().mockResolvedValue({}) };

      await expect(detector({ page })).resolves.toBe(true);
      expect(page.$).toHaveBeenCalledWith('form.auth-otp-login');
    });

    test('returns false when the OTP form is absent', async () => {
      const detector = getOtpDetector();
      const page = { $: jest.fn().mockResolvedValue(null) };

      await expect(detector({ page })).resolves.toBe(false);
    });

    test('returns false when no page is available', async () => {
      const detector = getOtpDetector();

      await expect(detector({})).resolves.toBe(false);
      await expect(detector(undefined)).resolves.toBe(false);
    });
  });

  describe('login override', () => {
    let superLogin: jest.SpyInstance;

    beforeEach(() => {
      superLogin = jest.spyOn(BaseScraperWithBrowser.prototype, 'login');
    });

    afterEach(() => {
      superLogin.mockRestore();
    });

    test('fails with TwoFactorRetrieverMissing when 2FA is required but no otpCodeRetriever is provided', async () => {
      superLogin.mockResolvedValue({ success: false, errorType: ScraperErrorTypes.TwoFactorRetrieverMissing });

      const result = await buildScraper().login({ userCode: 'x', password: 'y' });

      expect(result.success).toBe(false);
      expect(result.errorType).toBe(ScraperErrorTypes.TwoFactorRetrieverMissing);
      expect(result.errorMessage).toMatch(/OTP code retriever/i);
    });

    test('passes a successful login through unchanged', async () => {
      superLogin.mockResolvedValue({ success: true });

      const result = await buildScraper().login({ userCode: 'x', password: 'y' });

      expect(result.success).toBe(true);
    });

    test('does not start the OTP flow for non-2FA login errors', async () => {
      superLogin.mockResolvedValue({ success: false, errorType: ScraperErrorTypes.InvalidPassword });
      const otpCodeRetriever = jest.fn().mockResolvedValue('123456');

      const result = await buildScraper().login({ userCode: 'x', password: 'y', otpCodeRetriever });

      expect(result.errorType).toBe(ScraperErrorTypes.InvalidPassword);
      expect(otpCodeRetriever).not.toHaveBeenCalled();
    });
  });
});
