import { type ScraperOptions } from '../interface';
import { parseHoldingsResponse, parseOrderHistoryResponse, parsePortfoliosResponse } from './leumi-investments';

describe('parsePortfoliosResponse', () => {
  test('extracts portfolios from the config response', () => {
    const data = {
      data: {
        user: {
          Portfolios: [{ PortfolioId: '12345', PortfolioName: 'תיק מסחר' }],
        },
      },
    };

    expect(parsePortfoliosResponse(data)).toEqual([{ PortfolioId: '12345', PortfolioName: 'תיק מסחר' }]);
  });

  test('returns an empty array when the response has no portfolios', () => {
    expect(parsePortfoliosResponse({ data: { user: {} } })).toEqual([]);
    expect(parsePortfoliosResponse({})).toEqual([]);
    expect(parsePortfoliosResponse(null)).toEqual([]);
  });
});

describe('parseHoldingsResponse', () => {
  test('maps a holdings row to a Security', () => {
    const data = {
      data: {
        UserStatement: {
          DataSource: [{ PaperId: '662577', PaperName: 'טבע', Symbol: 'TEVA', Amount: '10', Value: '1234.5' }],
        },
      },
    };

    expect(parseHoldingsResponse(data)).toEqual([
      { name: 'טבע', symbol: 'TEVA', volume: 10, value: 1234.5, currency: 'ILS' },
    ]);
  });

  test('returns an empty array when there is no statement data', () => {
    expect(parseHoldingsResponse({ data: {} })).toEqual([]);
    expect(parseHoldingsResponse({})).toEqual([]);
  });
});

describe('parseOrderHistoryResponse', () => {
  const row = {
    PaperId: '662577',
    PaperName: 'טבע',
    Symbol: 'TEVA',
    Amount: '10',
    ExecutableTotal: '1234.5',
    ExecutablePrice: '123.45',
    ExecutionDate: '18.06.26',
  };

  test('maps an order row to a transaction', () => {
    const data = { data: { GetOrdersHistory: { ordersHistory: { records: [row] } } } };

    const [transaction] = parseOrderHistoryResponse(data);

    expect(transaction.originalAmount).toBe(1234.5);
    expect(transaction.chargedAmount).toBe(1234.5);
    expect(transaction.originalCurrency).toBe('ILS');
    expect(transaction.description).toBe('טבע TEVA');
  });

  test('falls back to a generic description when paper name and symbol are missing', () => {
    const data = {
      data: { GetOrdersHistory: { ordersHistory: { records: [{ ...row, PaperName: '', Symbol: '' }] } } },
    };

    const [transaction] = parseOrderHistoryResponse(data);

    expect(transaction.description).toBe('עסקה בתיק ניירות ערך');
  });

  test('returns an empty array when there is no order history', () => {
    expect(parseOrderHistoryResponse({ data: {} })).toEqual([]);
    expect(parseOrderHistoryResponse({})).toEqual([]);
  });

  test('includes the raw transaction only when requested', () => {
    const data = { data: { GetOrdersHistory: { ordersHistory: { records: [row] } } } };

    const withRaw = parseOrderHistoryResponse(data, { includeRawTransaction: true } as ScraperOptions);
    const withoutRaw = parseOrderHistoryResponse(data, { includeRawTransaction: false } as ScraperOptions);

    expect(withRaw[0].rawTransaction).toBeDefined();
    expect(withoutRaw[0].rawTransaction).toBeUndefined();
  });
});
