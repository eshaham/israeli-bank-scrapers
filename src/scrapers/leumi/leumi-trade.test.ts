import moment from 'moment';
import { type Page } from 'puppeteer';
import { DOLLAR_CURRENCY, EURO_CURRENCY, SHEKEL_CURRENCY } from '../../constants';
import { type ScraperOptions } from '../interface';
import { fetchLeumiTradeAccounts, mapTradeCurrency, mapTradeHolding, mapTradePortfolio } from './leumi-trade';

const rawHolding = {
  PaperId: 123456,
  PaperName: 'Test security',
  Symbol: 'TEST',
  AverageRate: 101.5,
  Amount: 20,
  PaperLastRateForStatement: 110,
  Value: 2200,
  ChangePercent: 1.2,
  ProfitPercent: 8.37,
  ProfitCash: 170,
  Percent: 12.5,
  PaperTypeName: 'Stock',
  RegionID: 2,
  CountryID: 1,
  CurrencyRate: 3.7,
};

describe('mapTradeCurrency', () => {
  test.each([
    ['₪', SHEKEL_CURRENCY],
    ['NIS', SHEKEL_CURRENCY],
    ['ILS', SHEKEL_CURRENCY],
    ['$', DOLLAR_CURRENCY],
    ['USD', DOLLAR_CURRENCY],
    ['€', EURO_CURRENCY],
    ['EUR', EURO_CURRENCY],
  ])('maps %s to %s', (input, expected) => {
    expect(mapTradeCurrency(input)).toBe(expected);
  });

  test('returns undefined for an unknown currency', () => {
    expect(mapTradeCurrency('GBP')).toBeUndefined();
  });
});

describe('mapTradeHolding', () => {
  test('maps the holdings fields returned by the statement endpoint', () => {
    expect(mapTradeHolding(rawHolding, SHEKEL_CURRENCY)).toEqual({
      identifier: 123456,
      name: 'Test security',
      symbol: 'TEST',
      quantity: 20,
      averagePrice: 101.5,
      lastPrice: 110,
      value: 2200,
      valueCurrency: SHEKEL_CURRENCY,
      profit: 170,
      profitCurrency: SHEKEL_CURRENCY,
      profitPercent: 8.37,
      dailyChangePercent: 1.2,
      portfolioPercent: 12.5,
      securityType: 'Stock',
      regionId: 2,
      countryId: 1,
      currencyRate: 3.7,
    });
  });

  test('includes the raw holding only when requested', () => {
    const withRaw = mapTradeHolding(rawHolding, SHEKEL_CURRENCY, {
      includeRawTransaction: true,
    } as ScraperOptions);
    const withoutRaw = mapTradeHolding(rawHolding, SHEKEL_CURRENCY, {
      includeRawTransaction: false,
    } as ScraperOptions);

    expect(withRaw.rawHolding).toEqual(rawHolding);
    expect(withoutRaw.rawHolding).toBeUndefined();
  });
});

describe('mapTradePortfolio', () => {
  test('creates an investment account containing its current holdings', () => {
    const account = mapTradePortfolio(
      { index: 7, PortfolioId: 'portfolio-1', name: 'My portfolio', real: true },
      {
        PortfolioValue: 2200,
        ReportDate: '2026-09-13',
        CurrencySymbol: '₪',
        DataSource: [rawHolding],
        PortfolioIndex: 7,
        CriticalError: false,
        CriticalTimeout: false,
        IsErrorMessage: false,
      },
    );

    expect(account.accountNumber).toBe('portfolio-1');
    expect(account.name).toBe('My portfolio');
    expect(account.balance).toBe(2200);
    expect(account.balanceDate).toBe(moment('2026-09-13', 'YYYY-MM-DD', true).milliseconds(0).toISOString());
    expect(account.currency).toBe(SHEKEL_CURRENCY);
    expect(account.investmentAccount).toBe(true);
    expect(account.holdings).toHaveLength(1);
    expect(account.txns).toEqual([]);
  });
});

describe('fetchLeumiTradeAccounts', () => {
  test('navigates to Leumi Trade and fetches every configured portfolio', async () => {
    const goto = jest.fn().mockResolvedValue(undefined);
    const evaluate = jest.fn().mockImplementation((_callback, url: string) => {
      if (url.endsWith('/api/config')) {
        return Promise.resolve([
          JSON.stringify({
            resultCode: 0,
            data: {
              user: {
                Portfolios: [
                  { index: 7, PortfolioId: 'portfolio-1', name: 'First', real: true },
                  { index: 8, PortfolioId: 'portfolio-2', name: 'Second', real: true },
                ],
              },
            },
          }),
          200,
        ]);
      }

      const requestUrl = new URL(url);
      const portfolioIndex = Number(requestUrl.searchParams.get('PortfolioIndex'));
      expect(requestUrl.pathname).toBe('/lti/lti-app/api/Trade/Statement');
      expect(requestUrl.searchParams.get('ViewID')).toBe('7');

      return Promise.resolve([
        JSON.stringify({
          resultCode: 0,
          data: {
            UserStatement: {
              PortfolioValue: portfolioIndex * 100,
              ReportDate: '2026-09-13',
              CurrencySymbol: '₪',
              DataSource: [rawHolding],
              PortfolioIndex: portfolioIndex,
              CriticalError: false,
              CriticalTimeout: false,
              IsErrorMessage: false,
            },
          },
        }),
        200,
      ]);
    });
    const page = { evaluate, goto } as unknown as Page;

    const accounts = await fetchLeumiTradeAccounts(page, {} as ScraperOptions);

    expect(goto).toHaveBeenCalledWith('https://hb2.bankleumi.co.il/lti/lti-app/home', {
      waitUntil: 'networkidle2',
    });
    expect(accounts.map(account => account.accountNumber)).toEqual(['portfolio-1', 'portfolio-2']);
    expect(accounts.map(account => account.balance)).toEqual([700, 800]);
    expect(accounts.every(account => account.holdings?.length === 1)).toBe(true);
  });

  test('does not fail regular Leumi scraping when Trade is unavailable', async () => {
    const page = {
      goto: jest.fn().mockRejectedValue(new Error('Trade is unavailable')),
    } as unknown as Page;

    await expect(fetchLeumiTradeAccounts(page, {} as ScraperOptions)).resolves.toEqual([]);
  });
});
