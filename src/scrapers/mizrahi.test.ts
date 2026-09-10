import MizrahiScraper, { parseAmount, scrapeAccounts, convertPendingRow } from './mizrahi';
import { maybeTestCompanyAPI, extendAsyncTimeout, getTestsConfig, exportTransactions } from '../tests/tests-utils';
import { SCRAPERS } from '../definitions';
import { ISO_DATE_REGEX } from '../constants';
import { LoginResults } from './base-scraper-with-browser';
import { type TransactionsAccount } from '../transactions';
import debug from 'debug';
import { type ScraperOptions } from './interface';

debug.enable('israeli-bank-scrapers:mizrahi');

const COMPANY_ID = 'mizrahi'; // TODO this property should be hard-coded in the provider
const testsConfig = getTestsConfig();

describe('Mizrahi scraper', () => {
  beforeAll(() => {
    extendAsyncTimeout(); // The default timeout is 5 seconds per async test, this function extends the timeout value
  });

  test('should expose login fields in scrapers constant', () => {
    expect(SCRAPERS.mizrahi).toBeDefined();
    expect(SCRAPERS.mizrahi.loginFields).toContain('username');
    expect(SCRAPERS.mizrahi.loginFields).toContain('password');
  });

  maybeTestCompanyAPI(COMPANY_ID, config => config.companyAPI.invalidPassword)(
    'should fail on invalid user/password',
    async () => {
      const options = {
        ...testsConfig.options,
        companyId: COMPANY_ID,
      };

      const scraper = new MizrahiScraper(options);

      const result = await scraper.scrape({ username: 'e10s12', password: '3f3ss3d' });

      expect(result).toBeDefined();
      expect(result.success).toBeFalsy();
      expect(result.errorType).toBe(LoginResults.InvalidPassword);
    },
  );

  maybeTestCompanyAPI(COMPANY_ID)('should scrape transactions', async () => {
    const options: ScraperOptions = {
      ...testsConfig.options,
      optInFeatures: [
        'mizrahi:pendingIfHasGenericDescription',
        'mizrahi:pendingIfHasGenericDescriptionWithDate',
        'mizrahi:pendingIfTodayTransaction',
      ],
      companyId: COMPANY_ID,
    };

    const scraper = new MizrahiScraper(options);
    const result = await scraper.scrape(testsConfig.credentials.mizrahi);
    expect(result).toBeDefined();
    const error = `${result.errorType || ''} ${result.errorMessage || ''}`.trim();
    expect(error).toBe('');
    expect(result.success).toBeTruthy();
    expect(result.accounts).toBeDefined();
    expect((result.accounts as any).length).toBeGreaterThan(0);
    const account: TransactionsAccount = (result as any).accounts[0];
    expect(account.accountNumber).not.toBe('');
    expect(account.txns[0].date).toMatch(ISO_DATE_REGEX);

    exportTransactions(COMPANY_ID, result.accounts || []);
  });
});

describe('parseAmount', () => {
  test('parses an integer string', () => {
    expect(parseAmount('12345')).toBe(12345);
  });

  test('parses a string with thousands separators', () => {
    expect(parseAmount('12,345.67')).toBe(12345.67);
  });

  test('parses a negative value', () => {
    expect(parseAmount('-1,234.5')).toBe(-1234.5);
  });

  test('strips a leading currency symbol', () => {
    expect(parseAmount('₪1,234.5')).toBe(1234.5);
  });

  test('strips a trailing currency symbol', () => {
    expect(parseAmount('1,234.5 ₪')).toBe(1234.5);
  });

  test('returns undefined for an empty string', () => {
    expect(parseAmount('')).toBeUndefined();
  });

  test('returns undefined for undefined', () => {
    expect(parseAmount(undefined)).toBeUndefined();
  });

  test('returns undefined for null', () => {
    expect(parseAmount(null)).toBeUndefined();
  });

  test('returns undefined for garbage input', () => {
    expect(parseAmount('abc')).toBeUndefined();
  });

  test('applies the sign for a trailing minus', () => {
    expect(parseAmount('1,234.56-')).toBe(-1234.56);
  });

  test('applies the sign for parenthesized negatives', () => {
    expect(parseAmount('(1,234.56)')).toBe(-1234.56);
  });

  test('applies the sign for a leading minus with a thousands separator', () => {
    expect(parseAmount('-1,234.56')).toBe(-1234.56);
  });

  test('strips bidi marks around the amount', () => {
    expect(parseAmount('‏1,234.56‎')).toBe(1234.56);
  });

  test('returns undefined for a lone minus sign', () => {
    expect(parseAmount('-')).toBeUndefined();
  });

  test('returns undefined for whitespace-only input', () => {
    expect(parseAmount('   ')).toBeUndefined();
  });

  test('returns undefined for a minus sign embedded in letters', () => {
    expect(parseAmount('abc-5')).toBeUndefined();
  });

  test('returns undefined for a minus sign embedded between digits', () => {
    expect(parseAmount('12-34')).toBeUndefined();
  });

  test('returns undefined for a value with multiple decimal points', () => {
    expect(parseAmount('1.2.3')).toBeUndefined();
  });

  test('returns undefined for exponential notation', () => {
    expect(parseAmount('1e5')).toBeUndefined();
  });

  test('parses a leading-dot decimal', () => {
    expect(parseAmount('.5')).toBe(0.5);
  });

  test('parses a realistic Yitra-like balance string', () => {
    expect(parseAmount('12,345.67 ₪')).toBe(12345.67);
  });

  test('strips a leading currency symbol with a leading minus', () => {
    expect(parseAmount('₪ -12')).toBe(-12);
  });

  test('strips a trailing currency symbol with a trailing minus', () => {
    expect(parseAmount('12- ₪')).toBe(-12);
  });

  test('maps a unicode minus sign after the amount', () => {
    expect(parseAmount('1,234.56−')).toBe(-1234.56);
  });

  test('returns undefined for Hebrew text preceding the amount', () => {
    expect(parseAmount('יתרת חובה 1,234.56')).toBeUndefined();
  });

  test('returns undefined for Hebrew text following the amount', () => {
    expect(parseAmount('1,234.56 חובה')).toBeUndefined();
  });

  test('returns undefined for multiple parenthesized groups', () => {
    expect(parseAmount('(1)+(2)')).toBeUndefined();
  });
});

describe('convertPendingRow', () => {
  test('parses a debit row as a negative amount', () => {
    const txn = convertPendingRow(['15/09/26', 'חיוב ויזה כאל עתידי', "ש''ח", '', '6,883.17', '1', '002', '']);
    expect(txn?.chargedAmount).toBe(-6883.17);
    expect(txn?.status).toBe('pending');
  });

  test('parses a credit row as a positive amount', () => {
    const txn = convertPendingRow(['10/09/26', 'desc', "ש''ח", '250.00', '', '1', '001', '']);
    expect(txn?.chargedAmount).toBe(250);
  });

  test('returns undefined for a row with an empty date', () => {
    const txn = convertPendingRow(['', 'desc', "ש''ח", '', '6,883.17', '1', '002', '']);
    expect(txn).toBeUndefined();
  });

  test('returns undefined for a row with no parsable amount', () => {
    const txn = convertPendingRow(['15/09/26', 'desc', "ש''ח", '', '', '1', '002', '']);
    expect(txn).toBeUndefined();
  });
});

describe('scrapeAccounts', () => {
  function makeAccount(accountNumber: string): TransactionsAccount {
    return { accountNumber, txns: [] };
  }

  test('keeps the accounts that succeed when one account throws', async () => {
    const selectAccount = jest.fn().mockResolvedValue(undefined);
    const fetchAccount = jest.fn().mockImplementation((index: number) => {
      if (index === 1) {
        return Promise.reject(new Error('boom'));
      }
      return Promise.resolve(makeAccount(`acc-${index}`));
    });

    const { accounts, errors } = await scrapeAccounts(3, selectAccount, fetchAccount);

    expect(accounts).toEqual([makeAccount('acc-0'), makeAccount('acc-2')]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('boom');
    expect(selectAccount).toHaveBeenCalledTimes(3);
  });

  test('returns an error message for every account when all of them throw', async () => {
    const selectAccount = jest.fn().mockResolvedValue(undefined);
    const fetchAccount = jest
      .fn()
      .mockRejectedValueOnce(new Error('first failure'))
      .mockRejectedValueOnce(new Error('second failure'));

    const { accounts, errors } = await scrapeAccounts(2, selectAccount, fetchAccount);

    expect(accounts).toEqual([]);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain('first failure');
    expect(errors[1]).toContain('second failure');
  });

  test('unwraps AggregateError into readable per-error messages', async () => {
    const selectAccount = jest.fn().mockResolvedValue(undefined);
    const aggregate = new AggregateError([new Error('inner one'), new Error('inner two')], 'all promises rejected');
    const fetchAccount = jest.fn().mockRejectedValue(aggregate);

    const { accounts, errors } = await scrapeAccounts(1, selectAccount, fetchAccount);

    expect(accounts).toEqual([]);
    expect(errors[0]).toContain('inner one');
    expect(errors[0]).toContain('inner two');
  });

  test('recurses into a nested AggregateError', async () => {
    const selectAccount = jest.fn().mockResolvedValue(undefined);
    const inner = new AggregateError([new Error('deep one'), new Error('deep two')], 'inner aggregate');
    const outer = new AggregateError([inner, new Error('shallow')], 'outer aggregate');
    const fetchAccount = jest.fn().mockRejectedValue(outer);

    const { errors } = await scrapeAccounts(1, selectAccount, fetchAccount);

    expect(errors[0]).toContain('deep one');
    expect(errors[0]).toContain('deep two');
    expect(errors[0]).toContain('shallow');
  });

  test('falls back to the error itself for an empty AggregateError', async () => {
    const selectAccount = jest.fn().mockResolvedValue(undefined);
    const aggregate = new AggregateError([], 'nothing succeeded');
    const fetchAccount = jest.fn().mockRejectedValue(aggregate);

    const { accounts, errors } = await scrapeAccounts(1, selectAccount, fetchAccount);

    expect(accounts).toEqual([]);
    expect(errors[0]).toBe(`account #1: ${String(aggregate)}`);
    expect(errors[0]).not.toMatch(/account #1: $/);
  });
});
