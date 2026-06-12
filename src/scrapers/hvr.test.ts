import { CompanyTypes, SCRAPERS } from '../definitions';
import { exportTransactions, extendAsyncTimeout, getTestsConfig, maybeTestCompanyAPI } from '../tests/tests-utils';
import { LoginResults } from './base-scraper-with-browser';
import HvrScraper from './hvr';

const testsConfig = getTestsConfig();

describe('HVR scraper', () => {
  beforeAll(() => {
    extendAsyncTimeout();
  });

  it('should expose login fields in scrapers constant', () => {
    expect(SCRAPERS[CompanyTypes.hvr]).toBeDefined();
    expect(SCRAPERS[CompanyTypes.hvr].loginFields).toContain('id');
    expect(SCRAPERS[CompanyTypes.hvr].loginFields).toContain('password');
  });

  maybeTestCompanyAPI(CompanyTypes.hvr, config => config.companyAPI.invalidPassword)(
    'should fail on invalid user/password"',
    async () => {
      const scraper = new HvrScraper({
        ...testsConfig.options,
        companyId: CompanyTypes.hvr,
      });

      const result = await scraper.scrape({ id: 'foofoofoo', password: 'barbarbar' });

      expect(result).toBeDefined();
      expect(result.success).toBeFalsy();
      expect(result.errorType).toBe(LoginResults.InvalidPassword);
    },
  );

  maybeTestCompanyAPI(CompanyTypes.hvr)('should scrape transactions', async () => {
    const scraper = new HvrScraper({
      ...testsConfig.options,
      companyId: CompanyTypes.hvr,
    });

    const result = await scraper.scrape(testsConfig.credentials[CompanyTypes.hvr]);
    expect(result).toBeDefined();
    expect(result.errorMessage).toBeFalsy();
    expect(result.errorType).toBeFalsy();
    expect(result.success).toBeTruthy();
    expect(result.accounts).toBeDefined();
    expect(result.accounts).toHaveLength(1);
    const txns = result.accounts![0].txns;
    console.log(`Found ${txns.length} transactions for HVR`);
    exportTransactions(CompanyTypes.hvr, result.accounts || []);
  });
});
