import JerusalemScraper from './jerusalem';
import { maybeTestCompanyAPI, extendAsyncTimeout, getTestsConfig, exportTransactions } from '../tests/tests-utils';
import { SCRAPERS } from '../definitions';
import { LoginResults } from './base-scraper-with-browser';

const COMPANY_ID = 'jerusalem';
const testsConfig = getTestsConfig();

describe('Bank Jerusalem scraper', () => {
  beforeAll(() => {
    extendAsyncTimeout(); // The default timeout is 5 seconds per async test, this function extends the timeout value
  });

  test('should expose login fields in scrapers constant', () => {
    expect(SCRAPERS.jerusalem).toBeDefined();
    expect(SCRAPERS.jerusalem.loginFields).toContain('username');
    expect(SCRAPERS.jerusalem.loginFields).toContain('password');
  });

  test('should fail on invalid user/password', async () => {
    const options = {
      ...testsConfig.options,
      companyId: COMPANY_ID,
    };

    const scraper = new JerusalemScraper(options);

    const result = await scraper.scrape({ username: 'invalid', password: 'invalid123' });

    expect(result).toBeDefined();
    expect(result.success).toBeFalsy();
    expect(result.errorType).toBe(LoginResults.InvalidPassword);
  });

  maybeTestCompanyAPI(COMPANY_ID)('should scrape transactions', async () => {
    const options = {
      ...testsConfig.options,
      companyId: COMPANY_ID,
    };

    const scraper = new JerusalemScraper(options);
    const result = await scraper.scrape(testsConfig.credentials.jerusalem);
    expect(result).toBeDefined();
    const error = `${result.errorType || ''} ${result.errorMessage || ''}`.trim();
    expect(error).toBe('');
    expect(result.success).toBeTruthy();

    exportTransactions(COMPANY_ID, result.accounts || []);
  });

  maybeTestCompanyAPI(COMPANY_ID)('should include savings accounts', async () => {
    const options = {
      ...testsConfig.options,
      companyId: COMPANY_ID,
    };

    const scraper = new JerusalemScraper(options);
    const result = await scraper.scrape(testsConfig.credentials.jerusalem);

    expect(result).toBeDefined();
    expect(result.success).toBeTruthy();
    expect(result.accounts).toBeDefined();

    // Check if any savings accounts are present
    const savingsAccounts = result.accounts?.filter(account => account.savingsAccount === true);

    console.log('Total accounts:', result.accounts?.length);
    console.log('Savings accounts found:', savingsAccounts?.length);

    if (savingsAccounts && savingsAccounts.length > 0) {
      console.log('Savings account details:');
      savingsAccounts.forEach(account => {
        console.log(`  - Account: ${account.accountNumber}, Balance: ${account.balance}`);
      });

      // Verify savings account properties
      savingsAccounts.forEach(account => {
        expect(account.savingsAccount).toBe(true);
        expect(account.accountNumber).toMatch(/^[0-9-]+$/);
        expect(account.balance).toBeDefined();
        expect(account.txns).toBeDefined();
      });
    } else {
      console.log('No savings accounts found - this may be expected if the test account has no deposits');
    }
  });

  maybeTestCompanyAPI(COMPANY_ID)('should handle transactions with empty reference IDs', async () => {
    const options = {
      ...testsConfig.options,
      companyId: COMPANY_ID,
    };

    const scraper = new JerusalemScraper(options);
    const result = await scraper.scrape(testsConfig.credentials.jerusalem);

    expect(result).toBeDefined();
    expect(result.success).toBeTruthy();

    // Check that all transactions have identifiers (defaulting to '0' if empty)
    const regularAccounts = result.accounts?.filter(account => !account.savingsAccount);
    if (regularAccounts && regularAccounts.length > 0) {
      regularAccounts.forEach(account => {
        account.txns.forEach(txn => {
          expect(txn.identifier).toBeDefined();
          // Identifier should be a string (either actual reference or '0')
          expect(typeof txn.identifier).toBe('string');
        });
      });
    }
  });

  maybeTestCompanyAPI(COMPANY_ID)('should extract correct account number format', async () => {
    const options = {
      ...testsConfig.options,
      companyId: COMPANY_ID,
    };

    const scraper = new JerusalemScraper(options);
    const result = await scraper.scrape(testsConfig.credentials.jerusalem);

    expect(result).toBeDefined();
    expect(result.success).toBeTruthy();
    expect(result.accounts).toBeDefined();
    expect(result.accounts!.length).toBeGreaterThan(0);

    // Regular accounts should have account numbers without special characters (except hyphens)
    const regularAccounts = result.accounts?.filter(account => !account.savingsAccount);
    if (regularAccounts && regularAccounts.length > 0) {
      regularAccounts.forEach(account => {
        expect(account.accountNumber).toMatch(/^[0-9-]+$/);
        expect(account.accountNumber).not.toBe('00000');
      });
    }
  });
});
