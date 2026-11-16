import MizrahiScraper, { getTransactionIdentifier } from './mizrahi';
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

describe('getTransactionIdentifier', () => {
  type ScrapedTransactionForIdentifierTest = Parameters<typeof getTransactionIdentifier>[0];

  // Every value here is invented, no real account data is used.
  function createRow(
    overrides: Partial<ScrapedTransactionForIdentifierTest> = {},
  ): ScrapedTransactionForIdentifierTest {
    return {
      RecTypeSpecified: true,
      MC02PeulaTaaEZ: '2026-03-01T00:00:00',
      MC02ErehTaaEZ: '2026-03-01T00:00:00',
      MC02SchumEZ: -100.5,
      MC02AsmahtaMekoritEZ: '90000001',
      MC02TnuaTeurEZ: 'invented transfer description',
      IsTodayTransaction: false,
      MC02KodGoremEZ: 12,
      MC02SugTnuaKaspitEZ: 34,
      MC02AgidEZ: 56,
      MC02SeifMaralEZ: 78,
      MC02NoseMaralEZ: 90,
      TransactionNumber: null,
      ...overrides,
    };
  }

  test('should return undefined when the bank sends no asmachta', () => {
    expect(getTransactionIdentifier(createRow({ MC02AsmahtaMekoritEZ: '' }))).toBeUndefined();
  });

  test('should compose the identifier from the asmachta, transaction number, date and amount', () => {
    const identifier = getTransactionIdentifier(
      createRow({ TransactionNumber: 2, MC02PeulaTaaEZ: '2026-03-01T00:00:00', MC02SchumEZ: -100.5 }),
    );

    expect(identifier).toBe('90000001_2_20260301000000_-100.5');
  });

  test('should distinguish two transactions sharing an asmachta with no transaction number', () => {
    const first = createRow({ MC02PeulaTaaEZ: '2026-03-01T00:00:00', MC02SchumEZ: -100.5 });
    const second = createRow({ MC02PeulaTaaEZ: '2026-03-04T00:00:00', MC02SchumEZ: -250.75 });

    expect(getTransactionIdentifier(first)).not.toBe(getTransactionIdentifier(second));
  });

  test('should distinguish two transactions sharing an asmachta and transaction number 1', () => {
    const first = createRow({ TransactionNumber: 1, MC02SchumEZ: -100.5 });
    const second = createRow({ TransactionNumber: 1, MC02SchumEZ: -250.75 });

    expect(getTransactionIdentifier(first)).not.toBe(getTransactionIdentifier(second));
  });

  test('should distinguish two transactions sharing an asmachta and a repeated transaction number', () => {
    const first = createRow({ TransactionNumber: 7, MC02PeulaTaaEZ: '2026-03-01T00:00:00' });
    const second = createRow({ TransactionNumber: 7, MC02PeulaTaaEZ: '2026-03-09T00:00:00' });

    expect(getTransactionIdentifier(first)).not.toBe(getTransactionIdentifier(second));
  });

  test('should derive the same identifier twice for the same transaction', () => {
    expect(getTransactionIdentifier(createRow({ TransactionNumber: 3 }))).toBe(
      getTransactionIdentifier(createRow({ TransactionNumber: 3 })),
    );
  });

  test('should not depend on IsTodayTransaction, which changes between scrapes', () => {
    expect(getTransactionIdentifier(createRow({ IsTodayTransaction: true }))).toBe(
      getTransactionIdentifier(createRow({ IsTodayTransaction: false })),
    );
  });
});
