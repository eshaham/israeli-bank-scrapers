import { CompanyTypes, SCRAPERS } from '../definitions';
import {
  exportTransactions, extendAsyncTimeout, getTestsConfig, maybeTestCompanyAPI,
} from '../tests/tests-utils';
import { LoginResults } from './base-scraper-with-browser';
import BehatsdaaScraper from './behatsdaa';

const testsConfig = getTestsConfig();

describe('Behatsdaa scraper', () => {
  beforeAll(() => {
    extendAsyncTimeout();
  });

  it('should expose login fields in scrapers constant', () => {
    expect(SCRAPERS[CompanyTypes.behatsdaa]).toBeDefined();
    expect(SCRAPERS[CompanyTypes.behatsdaa].loginFields).toContain('id');
    expect(SCRAPERS[CompanyTypes.behatsdaa].loginFields).toContain('password');
  });

  maybeTestCompanyAPI(CompanyTypes.behatsdaa, (config) => config.companyAPI.invalidPassword)('should fail on invalid user/password"', async () => {
    const scraper = new BehatsdaaScraper({
      ...testsConfig.options,
      companyId: CompanyTypes.behatsdaa,
    });

    const result = await scraper.scrape({ id: 'foofoofoo', password: 'barbarbar' });

    expect(result).toBeDefined();
    expect(result.success).toBeFalsy();
    expect(result.errorType).toBe(LoginResults.InvalidPassword);
  });

  maybeTestCompanyAPI(CompanyTypes.behatsdaa)('should scrape transactions', async () => {
    const scraper = new BehatsdaaScraper({
      ...testsConfig.options,
      companyId: CompanyTypes.behatsdaa,
    });

    const result = await scraper.scrape(testsConfig.credentials[CompanyTypes.behatsdaa]);
    expect(result).toBeDefined();
    expect(result.errorMessage).toBeFalsy();
    expect(result.errorType).toBeFalsy();
    expect(result.success).toBeTruthy();
    expect(result.accounts).toBeDefined();
    expect(result.accounts).toHaveLength(1);
    exportTransactions(CompanyTypes.behatsdaa, result.accounts || []);
  });
});
