import BitsofGoldScraper from './bitsofgold';
import { maybeTestCompanyAPI, extendAsyncTimeout, getTestsConfig } from '../tests/tests-utils';
import { SCRAPERS, CompanyTypes } from '../definitions';

const COMPANY_ID = CompanyTypes.bitsofgold;
const testsConfig = getTestsConfig();

describe('BitsofGold scraper', () => {
  beforeAll(() => {
    extendAsyncTimeout(); // The default timeout is 5 seconds per async test, this function extends the timeout value
  });

  test('should expose login fields in scrapers constant', () => {
    expect(SCRAPERS.bitsofgold).toBeDefined();
    expect(SCRAPERS.bitsofgold.loginFields).toContain('username');
    expect(SCRAPERS.bitsofgold.loginFields).toContain('password');
  });

  maybeTestCompanyAPI(COMPANY_ID)('should scrape transactions and balance', async () => {
    const options = {
      ...testsConfig.options,
      companyId: COMPANY_ID,
    };

    const credentials = testsConfig.credentials.bitsofgold;
    const scraper = new BitsofGoldScraper(options);
    const result = await scraper.scrape(credentials);

    if (!result.success) {
      console.log('Scraper failed:', result);
    }

    expect(result.success).toBe(true);
    expect(result.accounts).toBeDefined();

    if (!result.accounts) {
      throw new Error('No accounts found');
    }

    expect(result.accounts.length).toBeGreaterThan(0);

    const account = result.accounts[0];
    expect(account.accountNumber).toBe('bitsofgold-crypto-wallet');
    expect(account.balance).toBeDefined();
    expect(typeof account.balance).toBe('number');
    expect(account.balance).toBeGreaterThan(0);

    // Log the balance for visibility
    console.log(`BitsofGold Balance: ${account.balance} ILS`);
    console.log(`Account: ${account.accountNumber}`);
  });
});
