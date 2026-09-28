import { SCRAPERS } from '../definitions';
import { exportTransactions, extendAsyncTimeout, getTestsConfig, maybeTestCompanyAPI } from '../tests/tests-utils';
import { LoginResults } from './base-scraper-with-browser';
import VisaCalScraper, { isInvalidPasswordErrorUrl } from './visa-cal';

const COMPANY_ID = 'visaCal'; // TODO this property should be hard-coded in the provider
const testsConfig = getTestsConfig();

describe('VisaCal legacy scraper', () => {
  beforeAll(() => {
    extendAsyncTimeout(); // The default timeout is 5 seconds per async test, this function extends the timeout value
  });

  test('should expose login fields in scrapers constant', () => {
    expect(SCRAPERS.visaCal).toBeDefined();
    expect(SCRAPERS.visaCal.loginFields).toContain('username');
    expect(SCRAPERS.visaCal.loginFields).toContain('password');
  });

  maybeTestCompanyAPI(COMPANY_ID, config => config.companyAPI.invalidPassword)(
    'should fail on invalid user/password"',
    async () => {
      const options = {
        ...testsConfig.options,
        companyId: COMPANY_ID,
      };

      const scraper = new VisaCalScraper(options);

      const result = await scraper.scrape({ username: '971sddksmsl', password: '3f3ssdkSD3d' });

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

    const scraper = new VisaCalScraper(options);
    const result = await scraper.scrape(testsConfig.credentials.visaCal);
    expect(result).toBeDefined();
    const error = `${result.errorType || ''} ${result.errorMessage || ''}`.trim();
    expect(error).toBe('');
    expect(result.success).toBeTruthy();
    // uncomment to test multiple accounts
    // expect(result?.accounts?.length).toEqual(2)
    exportTransactions(COMPANY_ID, result.accounts || []);
  });
});

describe('isInvalidPasswordErrorUrl', () => {
  // The login iframe URL cal-online shows after rejecting the credentials (captured 2026-09-28)
  const errorUrl = (message: string) =>
    'https://digital-web.cal-online.co.il/calconnect/error;headers=%5Bobject%20Object%5D;status=400;statusText=OK;' +
    'url=https:%2F%2Fconnect.cal-online.co.il%2Fcol-rest%2Fcalconnect%2Fauthentication%2Flogin;ok=false;' +
    `name=HttpErrorResponse;message=Http%20failure%20response;error=${encodeURIComponent(message)}`;

  test('detects the invalid-password error route', () => {
    expect(isInvalidPasswordErrorUrl(errorUrl('שם המשתמש או הסיסמה שהוזנו שגויים'))).toBe(true);
  });

  test('ignores other errors and other routes', () => {
    expect(isInvalidPasswordErrorUrl(errorUrl('שגיאה כללית'))).toBe(false);
    expect(isInvalidPasswordErrorUrl('https://digital-web.cal-online.co.il/calconnect/index.html')).toBe(false);
    expect(isInvalidPasswordErrorUrl('https://digital-web.cal-online.co.il/dashboard')).toBe(false);
  });

  test('does not throw on a malformed escape', () => {
    expect(isInvalidPasswordErrorUrl('https://digital-web.cal-online.co.il/calconnect/error;error=%E0%A4%A')).toBe(
      false,
    );
  });
});
