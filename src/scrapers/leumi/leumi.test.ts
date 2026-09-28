import { LoginResults } from '../base-scraper-with-browser';
import LeumiScraper from './leumi';
import { SHEKEL_CURRENCY } from '../../constants';
import { SCRAPERS } from '../../definitions';
import { getDebug } from '../../helpers/debug';
import { exportTransactions, extendAsyncTimeout, getTestsConfig, maybeTestCompanyAPI } from '../../tests/tests-utils';

const COMPANY_ID = 'leumi'; // TODO this property should be hard-coded in the provider
const testsConfig = getTestsConfig();
const debug = getDebug('leumi-test');

describe('Leumi legacy scraper', () => {
  beforeAll(() => {
    extendAsyncTimeout(); // The default timeout is 5 seconds per async test, this function extends the timeout value
  });

  test('should expose login fields in scrapers constant', () => {
    expect(SCRAPERS.leumi).toBeDefined();
    expect(SCRAPERS.leumi.loginFields).toContain('username');
    expect(SCRAPERS.leumi.loginFields).toContain('password');
  });

  maybeTestCompanyAPI(COMPANY_ID, config => config.companyAPI.invalidPassword)(
    'should fail on invalid user/password"',
    async () => {
      const options = {
        ...testsConfig.options,
        companyId: COMPANY_ID,
      };

      const scraper = new LeumiScraper(options);

      const result = await scraper.scrape({ username: 'e10s12', password: '3f3ss3d' });

      expect(result).toBeDefined();
      expect(result.success).toBeFalsy();
      expect(result.errorType).toBe(LoginResults.InvalidPassword);
    },
  );

  maybeTestCompanyAPI(COMPANY_ID)('should scrape transactions', async () => {
    const options = {
      ...testsConfig.options,
      companyId: COMPANY_ID,
    };

    const scraper = new LeumiScraper(options);
    const result = await scraper.scrape(testsConfig.credentials.leumi);
    expect(result).toBeDefined();
    const error = `${result.errorType || ''} ${result.errorMessage || ''}`.trim();
    expect(error).toBe('');
    expect(result.success).toBeTruthy();

    exportTransactions(COMPANY_ID, result.accounts || []);

    // Validate savings accounts if they exist
    expect(result.accounts).toBeDefined();
    const savingsAccounts = result.accounts?.filter(account => account.savingsAccount === true);

    debug('Total accounts:', result.accounts?.length);
    debug('Savings accounts found:', savingsAccounts?.length);

    if (savingsAccounts && savingsAccounts.length > 0) {
      debug('Savings account details:');
      savingsAccounts.forEach(account => {
        debug(`  - Account: ${account.accountNumber}, Balance: ${account.balance}`);
      });

      // Verify savings account properties
      savingsAccounts.forEach(account => {
        expect(account.savingsAccount).toBe(true);
        expect(account.accountNumber).toMatch(/ID/);
        expect(account.balance).toBeDefined();
        expect(account.txns).toBeDefined();
      });
    } else {
      debug('No savings accounts found - this may be expected if the test account has no deposits');
    }

    // Validate foreign currency accounts if they exist
    const foreignCurrencyAccounts = result.accounts?.filter(
      account => !!account.currency && account.currency !== SHEKEL_CURRENCY,
    );

    debug('Foreign currency accounts found:', foreignCurrencyAccounts?.length);

    if (foreignCurrencyAccounts && foreignCurrencyAccounts.length > 0) {
      debug('Foreign currency account details:');
      foreignCurrencyAccounts.forEach(account => {
        debug(
          `  - Account: ${account.accountNumber}, Currency: ${account.currency}, Balance: ${account.balance}, Transactions: ${account.txns.length}`,
        );
      });

      foreignCurrencyAccounts.forEach(account => {
        expect(account.accountNumber).toMatch(new RegExp(`-${account.currency}$`));
        expect(account.balance).toBeDefined();
        expect(account.txns).toBeDefined();

        account.txns.forEach(txn => {
          expect(txn.originalCurrency).toBe(account.currency);
          expect(txn.chargedCurrency).toBe(account.currency);
          expect(txn.date).toBeDefined();
          expect(Number.isNaN(txn.originalAmount)).toBe(false);
        });
      });
    } else {
      debug('No foreign currency accounts found - this may be expected if the test account has none');
    }
  });
});
