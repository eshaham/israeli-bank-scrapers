import {
  type BankSecurity,
  parseForeignCurrencyBalances,
  parseSecuritiesPortfolio,
  attachAssets,
} from './beinleumi-assets';

const security = (changes = {}) => ({
  number: '1234567',
  isin: '',
  symbol: '',
  name: 'Sample fund',
  type: 'MutualFund',
  amount: 10,
  lastKnownRate: 12300,
  adjustedCostRate: 10000,
  holdingValue: 1230,
  holdingValueInNis: 1230,
  currencyISOCode: 'ILS',
  nonRevaluation: false,
  ...changes,
});
const page = (results: BankSecurity[], changes = {}) => ({
  pagedResult: {
    cacheId: 'fixture',
    pageNumber: 1,
    totalNumberOfPages: 1,
    totalNumberOfRecords: results.length,
    results,
    ...changes,
  },
});
const summary = { currencyISOCode: 'ILS', portfolioValue: 1230 };

describe('Beinleumi asset snapshots', () => {
  test('keeps FX balances separate from cash subsets and ILS valuations', () => {
    expect(
      parseForeignCurrencyBalances([
        {
          currencyLabel: 'פרוט למטבע פרנק שויצר',
          rows: [
            ['Action', 'Current', '4', '100', '400', '80', '320'],
            ['Action', 'Current', '4', '-25', '-100', '-20', '-80'],
          ],
        },
      ]),
    ).toEqual([{ currency: 'CHF', balance: 75, valueInILS: 300 }]);
  });
  test('rejects unknown currencies and incomplete amounts', () => {
    expect(() => parseForeignCurrencyBalances([{ currencyLabel: 'unknown', rows: [] }])).toThrow();
    expect(() =>
      parseForeignCurrencyBalances([{ currencyLabel: 'CHF', rows: [['', '', '4', '--', '0', '0', '0']] }]),
    ).toThrow();
  });
  test('returns quantities and prices in currency units after reconciling the portfolio', () => {
    const result = parseSecuritiesPortfolio([page([security()])], summary);
    expect(result).toEqual({
      currency: 'ILS',
      value: 1230,
      holdings: [
        {
          securityNumber: '1234567',
          name: 'Sample fund',
          type: 'MutualFund',
          currency: 'ILS',
          quantity: 10,
          marketValue: 1230,
          valueInILS: 1230,
          unitPrice: 123,
          adjustedCostPrice: 100,
        },
      ],
    });
  });
  test('supports multi-page portfolios and rejects incomplete or mismatched snapshots', () => {
    const pages = [
      page([security()], { totalNumberOfPages: 2, totalNumberOfRecords: 2 }),
      page([security({ number: '7654321' })], { pageNumber: 2, totalNumberOfPages: 2, totalNumberOfRecords: 2 }),
    ];
    expect(parseSecuritiesPortfolio(pages, { ...summary, portfolioValue: 2460 }).holdings).toHaveLength(2);
    expect(() => parseSecuritiesPortfolio(pages.slice(0, 1), summary)).toThrow();
    expect(() => parseSecuritiesPortfolio([page([security()])], { ...summary, portfolioValue: 1231 })).toThrow();
    expect(() => parseSecuritiesPortfolio([page([security({ nonRevaluation: true })])], summary)).toThrow();
    expect(parseSecuritiesPortfolio([page([])], { ...summary, portfolioValue: 0 }).holdings).toEqual([]);
  });
  test('attaches assets only to the matching account without altering ILS balances', () => {
    const accounts = [
      { accountNumber: '001234', balance: 1000, txns: [] },
      { accountNumber: '005678', balance: 500, txns: [] },
    ];
    const snapshot = {
      accountNumber: '001234',
      fx: {
        accountNumber: '001234',
        sections: [{ currencyLabel: 'CHF', rows: [['', 'Current', '4', '100', '400', '80', '320']] }],
      },
      securities: {
        pages: [page([security()])],
        summary,
        accountDetails: [{ accounts: [{ mch: '001234', snif: '127' }] }],
      },
    };
    const result = attachAssets(accounts, snapshot, '2026-10-04');
    expect(result[0]).toMatchObject({
      balance: 1000,
      foreignCurrencyBalances: [{ currency: 'CHF', balance: 100, valueInILS: 400 }],
      securitiesPortfolio: { value: 1230 },
      assetsDate: '2026-10-04',
    });
    expect(result[1]).toEqual(accounts[1]);
    expect(() => attachAssets([{ accountNumber: '9999', txns: [] }], snapshot, '2026-10-04')).toThrow(/scope/);
    expect(() =>
      attachAssets(
        accounts,
        {
          ...snapshot,
          securities: {
            ...snapshot.securities,
            accountDetails: [{ accounts: [{ mch: '001234' }, { mch: '005678' }] }],
          },
        },
        '2026-10-04',
      ),
    ).toThrow(/scope/);
  });
});

// The financial parsers above use real payloads; only browser I/O is replaced here.
jest.mock('./beinleumi-assets-browser', () => ({ readAssets: jest.fn() }));
import BeinleumiScraper from './beinleumi';
import BeinleumiGroupBaseScraper from './base-beinleumi-group';
import { readAssets } from './beinleumi-assets-browser';
import { CompanyTypes } from '../definitions';

describe('Beinleumi assets opt-in', () => {
  afterEach(() => jest.restoreAllMocks());
  test('does not visit asset screens by default', async () => {
    const history = { success: true, accounts: [{ accountNumber: '1234', txns: [] }] };
    jest.spyOn(BeinleumiGroupBaseScraper.prototype, 'fetchData').mockResolvedValue(history);
    const scraper = new BeinleumiScraper({ companyId: CompanyTypes.beinleumi, startDate: new Date() });
    expect(await scraper.fetchData()).toEqual(history);
    expect(readAssets).not.toHaveBeenCalled();
  });
  test('adds a reconciled snapshot when opted in', async () => {
    jest
      .spyOn(BeinleumiGroupBaseScraper.prototype, 'fetchData')
      .mockResolvedValue({ success: true, accounts: [{ accountNumber: '1234', txns: [] }] });
    jest.mocked(readAssets).mockResolvedValue({
      accountNumber: '1234',
      securities: { pages: [page([security()])], summary, accountDetails: [{ accounts: [{ mch: '1234' }] }] },
    });
    const scraper = new BeinleumiScraper({
      companyId: CompanyTypes.beinleumi,
      startDate: new Date(),
      optInFeatures: ['beinleumi:assets'],
    });
    expect((await scraper.fetchData()).accounts?.[0]).toMatchObject({ securitiesPortfolio: { value: 1230 } });
  });
});

test('rejects a securities application that defaults to a different dashboard account', () => {
  const accounts = [
    { accountNumber: '1234', txns: [] },
    { accountNumber: '5678', txns: [] },
  ];
  const snapshot = {
    accountNumber: '1234',
    securities: {
      pages: [page([security()])],
      summary,
      accountDetails: [{ accounts: [{ mch: '5678', snif: '127' }] }],
    },
  };
  expect(() => attachAssets(accounts, snapshot, '2026-10-04')).toThrow(/selected account/);
});
