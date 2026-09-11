import { SCRAPERS } from '../definitions';
import { exportTransactions, extendAsyncTimeout, getTestsConfig, maybeTestCompanyAPI } from '../tests/tests-utils';
import { TransactionStatuses, TransactionTypes, type Transaction } from '../transactions';
import { LoginResults } from './base-scraper-with-browser';
import VisaCalScraper, { dedupePendingTransactions } from './visa-cal';

const COMPANY_ID = 'visaCal'; // TODO this property should be hard-coded in the provider
const testsConfig = getTestsConfig();

function makeTransaction(overrides: Partial<Transaction>): Transaction {
  return {
    type: TransactionTypes.Normal,
    date: '2024-05-10T07:00:00.000Z',
    processedDate: '2024-05-10T07:00:00.000Z',
    originalAmount: -100,
    originalCurrency: '₪',
    chargedAmount: -100,
    description: 'Test Merchant',
    status: TransactionStatuses.Completed,
    ...overrides,
  };
}

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

describe('dedupePendingTransactions', () => {
  test('drops a pending transaction once an identical completed counterpart exists', () => {
    const transactions = [
      makeTransaction({ status: TransactionStatuses.Pending, date: '2024-05-10T07:20:05.000Z', chargedAmount: -450 }),
      makeTransaction({
        status: TransactionStatuses.Completed,
        date: '2024-05-10T07:20:05.000Z',
        chargedAmount: -450,
        identifier: 'abc123',
      }),
    ];

    const result = dedupePendingTransactions(transactions);

    expect(result).toHaveLength(1);
    expect(result[0].status).toBe(TransactionStatuses.Completed);
    expect(result[0].identifier).toBe('abc123');
  });

  test('drops the pending side even when the amount differs (e.g. a gas-station pending hold)', () => {
    const transactions = [
      makeTransaction({
        status: TransactionStatuses.Pending,
        date: '2024-05-10T05:09:27.000Z',
        chargedAmount: -299, // placeholder hold amount
      }),
      makeTransaction({
        status: TransactionStatuses.Completed,
        date: '2024-05-10T05:12:18.000Z', // a few minutes later, once the pump total is known
        chargedAmount: -152.72,
        identifier: 'abc456',
      }),
    ];

    const result = dedupePendingTransactions(transactions);

    expect(result).toHaveLength(1);
    expect(result[0].status).toBe(TransactionStatuses.Completed);
    expect(result[0].chargedAmount).toBe(-152.72);
  });

  test('drops the pending side when the amount differs by a small settlement adjustment', () => {
    const transactions = [
      makeTransaction({ status: TransactionStatuses.Pending, date: '2024-05-10T07:29:25.000Z', chargedAmount: -250.3 }),
      makeTransaction({
        status: TransactionStatuses.Completed,
        date: '2024-05-10T07:29:25.000Z',
        chargedAmount: -251,
        identifier: 'abc789',
      }),
    ];

    const result = dedupePendingTransactions(transactions);

    expect(result).toHaveLength(1);
    expect(result[0].chargedAmount).toBe(-251);
  });

  test('keeps a pending transaction with no completed counterpart', () => {
    const transactions = [
      makeTransaction({
        status: TransactionStatuses.Pending,
        date: '2024-05-11T09:00:00.000Z',
        description: 'Coffee Shop',
      }),
    ];

    const result = dedupePendingTransactions(transactions);

    expect(result).toHaveLength(1);
    expect(result[0].status).toBe(TransactionStatuses.Pending);
  });

  test('pairs two same-day pending transactions at the same merchant with their own closest completed counterpart', () => {
    const transactions = [
      makeTransaction({
        status: TransactionStatuses.Pending,
        date: '2024-05-05T08:00:00.000Z',
        description: 'Supermarket',
        chargedAmount: -50,
      }),
      makeTransaction({
        status: TransactionStatuses.Pending,
        date: '2024-05-05T18:00:00.000Z',
        description: 'Supermarket',
        chargedAmount: -80,
      }),
      makeTransaction({
        status: TransactionStatuses.Completed,
        date: '2024-05-05T08:00:05.000Z',
        description: 'Supermarket',
        chargedAmount: -50,
        identifier: 'morning',
      }),
      makeTransaction({
        status: TransactionStatuses.Completed,
        date: '2024-05-05T18:00:10.000Z',
        description: 'Supermarket',
        chargedAmount: -80,
        identifier: 'evening',
      }),
    ];

    const result = dedupePendingTransactions(transactions);

    expect(result).toHaveLength(2);
    expect(result.map(t => t.identifier).sort()).toEqual(['evening', 'morning']);
  });

  test('does not match pending and completed transactions on different days', () => {
    const transactions = [
      makeTransaction({ status: TransactionStatuses.Pending, date: '2024-05-10T23:59:00.000Z', chargedAmount: -50 }),
      makeTransaction({
        status: TransactionStatuses.Completed,
        date: '2024-05-11T00:01:00.000Z',
        chargedAmount: -50,
        identifier: 'nextday',
      }),
    ];

    const result = dedupePendingTransactions(transactions);

    expect(result).toHaveLength(2);
  });
});
