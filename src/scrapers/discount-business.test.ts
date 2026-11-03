import DiscountBusinessScraper from './discount-business';
import { maybeTestCompanyAPI, extendAsyncTimeout, getTestsConfig, exportTransactions } from '../tests/tests-utils';
import { SCRAPERS } from '../definitions';

const COMPANY_ID = 'discountBusiness';
const testsConfig = getTestsConfig();

describe('Discount business scraper', () => {
  beforeAll(() => {
    extendAsyncTimeout();
  });

  test('should expose login fields in scrapers constant', () => {
    expect(SCRAPERS.discountBusiness).toBeDefined();
    expect(SCRAPERS.discountBusiness.loginFields).toEqual(['id', 'password']);
  });

  maybeTestCompanyAPI(COMPANY_ID)('should scrape transactions', async () => {
    const options = { ...testsConfig.options, companyId: COMPANY_ID };
    const scraper = new DiscountBusinessScraper(options);
    const result = await scraper.scrape(testsConfig.credentials.discountBusiness);
    expect(result).toBeDefined();
    const error = `${result.errorType || ''} ${result.errorMessage || ''}`.trim();
    expect(error).toBe('');
    expect(result.success).toBeTruthy();
    exportTransactions(COMPANY_ID, result.accounts || []);
  });
});
