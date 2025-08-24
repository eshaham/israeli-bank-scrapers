import MaxScraper, { getMemo } from './max';
import { maybeTestCompanyAPI, extendAsyncTimeout, getTestsConfig, exportTransactions } from '../tests/tests-utils';
import { SCRAPERS } from '../definitions';
import { LoginResults } from './base-scraper-with-browser';

const COMPANY_ID = 'max'; // TODO this property should be hard-coded in the provider
const testsConfig = getTestsConfig();

describe('Max scraper', () => {
  beforeAll(() => {
    extendAsyncTimeout(); // The default timeout is 5 seconds per async test, this function extends the timeout value
  });

  test('should expose login fields in scrapers constant', () => {
    expect(SCRAPERS.max).toBeDefined();
    expect(SCRAPERS.max.loginFields).toContain('username');
    expect(SCRAPERS.max.loginFields).toContain('password');
  });

  maybeTestCompanyAPI(COMPANY_ID, config => config.companyAPI.invalidPassword)(
    'should fail on invalid user/password"',
    async () => {
      const options = {
        ...testsConfig.options,
        companyId: COMPANY_ID,
      };

      const scraper = new MaxScraper(options);

      const result = await scraper.scrape({ username: 'e10s12', password: '3f3ss3d' });

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

    const scraper = new MaxScraper(options);
    const result = await scraper.scrape(testsConfig.credentials.max);
    expect(result).toBeDefined();
    const error = `${result.errorType || ''} ${result.errorMessage || ''}`.trim();
    expect(error).toBe('');
    expect(result.success).toBeTruthy();

    exportTransactions(COMPANY_ID, result.accounts || []);
  });

  maybeTestCompanyAPI(COMPANY_ID)('should scrape more transactions with futureMonthsToScrape option', async () => {
    // First scrape without futureMonthsToScrape
    const baseOptions = {
      ...testsConfig.options,
      companyId: COMPANY_ID,
    };

    const baseScraper = new MaxScraper(baseOptions);
    const baseResult = await baseScraper.scrape(testsConfig.credentials.max);
    expect(baseResult).toBeDefined();
    expect(baseResult.success).toBeTruthy();
    expect(baseResult.accounts).toBeDefined();

    const baseTotalTransactions = (baseResult.accounts || []).reduce((total, account) => total + account.txns.length, 0);

    // Then scrape with futureMonthsToScrape
    const futureOptions = {
      ...testsConfig.options,
      companyId: COMPANY_ID,
      futureMonthsToScrape: 2, // Test the shotef+30/60 scenario
    };

    const futureScraper = new MaxScraper(futureOptions);
    const futureResult = await futureScraper.scrape(testsConfig.credentials.max);
    expect(futureResult).toBeDefined();
    const error = `${futureResult.errorType || ''} ${futureResult.errorMessage || ''}`.trim();
    expect(error).toBe('');
    expect(futureResult.success).toBeTruthy();
    expect(futureResult.accounts).toBeDefined();

    const futureTotalTransactions = (futureResult.accounts || []).reduce((total, account) => total + account.txns.length, 0);

    // Validate that futureMonthsToScrape returns same or more transactions
    expect(futureTotalTransactions).toBeGreaterThanOrEqual(baseTotalTransactions);

    // Check if we have transactions in future months (beyond current month)
    const currentMonth = new Date();
    const futureMonthThreshold = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1);
    
    const futureTransactions = (futureResult.accounts || []).flatMap(account => 
      account.txns.filter(txn => new Date(txn.date) >= futureMonthThreshold)
    );

    console.log(`Base transactions: ${baseTotalTransactions}, Future transactions: ${futureTotalTransactions}, Future month transactions: ${futureTransactions.length}`);

    exportTransactions(`${COMPANY_ID}-base`, baseResult.accounts || []);
    exportTransactions(`${COMPANY_ID}-future-months`, futureResult.accounts || []);
  });
});

describe('getMemo', () => {
  type TransactionForMemoTest = Parameters<typeof getMemo>[0];
  test.each<[TransactionForMemoTest, string]>([
    [{ comments: '' }, ''],
    [{ comments: 'comment without funds' }, 'comment without funds'],
    [{ comments: '', fundsTransferReceiverOrTransfer: 'Daniel H' }, 'Daniel H'],
    [{ comments: '', fundsTransferReceiverOrTransfer: 'Daniel', fundsTransferComment: 'Foo bar' }, 'Daniel: Foo bar'],
  ])('%o should create memo: %s', (transaction, expected) => {
    const memo = getMemo(transaction);
    expect(memo).toBe(expected);
  });
});
