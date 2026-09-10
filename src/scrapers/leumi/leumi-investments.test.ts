import moment from 'moment';
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
  // Real rows observed on a live account's order history (a fund switch: sell one money-market
  // fund, buy another). The response body is a plain array of rows, no wrapper object.
  const sellRow = {
    PaperName: 'ברק כספית',
    Symbol: '',
    TypeOfOperation: 2,
    TypeOfOperationDesc: 'מכירה',
    ExecutableTotal: -20023.91,
    ExecutionDate: '2026-08-07 00:00',
    DateOfFinancialVal: '2026-08-09 00:00',
    TaxSum: -5.86,
    BasicReferenceNo: 68096048524,
    CurrencyACode: 'ILS',
  };
  const buyRow = {
    PaperName: 'ברק כספית',
    Symbol: '',
    TypeOfOperation: 1,
    TypeOfOperationDesc: 'קניה',
    ExecutableTotal: 20000.48,
    ExecutionDate: '2026-07-14 00:00',
    DateOfFinancialVal: '2026-07-15 00:00',
    TaxSum: 0,
    BasicReferenceNo: 68096043916,
    CurrencyACode: 'ILS',
  };

  test('maps a sell to a positive (credit) amount using its own sign, not the raw field sign', () => {
    const [transaction] = parseOrderHistoryResponse([sellRow]);

    // ExecutableTotal is itself negative for a sell (it tracks quantity direction), so the
    // magnitude is what matters here - the sign comes from TypeOfOperation.
    expect(transaction.originalAmount).toBe(20023.91);
    expect(transaction.chargedAmount).toBe(20023.91);
    expect(transaction.originalCurrency).toBe('ILS');
    expect(transaction.identifier).toBe(68096048524);
  });

  test('maps a buy to a negative (debit) amount', () => {
    const [transaction] = parseOrderHistoryResponse([buyRow]);

    expect(transaction.originalAmount).toBe(-20000.48);
    expect(transaction.chargedAmount).toBe(-20000.48);
  });

  test('uses the execution date and the value date separately', () => {
    const [transaction] = parseOrderHistoryResponse([sellRow]);

    expect(transaction.date).toBe(moment('2026-08-07 00:00', 'YYYY-MM-DD HH:mm').milliseconds(0).toISOString());
    expect(transaction.processedDate).toBe(
      moment('2026-08-09 00:00', 'YYYY-MM-DD HH:mm').milliseconds(0).toISOString(),
    );
  });

  test('describes the transaction using the paper name', () => {
    const [transaction] = parseOrderHistoryResponse([sellRow]);

    expect(transaction.description).toBe('ברק כספית');
  });

  test('falls back to a generic description when paper name and symbol are missing', () => {
    const [transaction] = parseOrderHistoryResponse([{ ...sellRow, PaperName: '', Symbol: '' }]);

    expect(transaction.description).toBe('עסקה בתיק ניירות ערך');
  });

  test('notes a non-zero tax charge in the memo', () => {
    const [transaction] = parseOrderHistoryResponse([sellRow]);

    expect(transaction.memo).toBe('מס: 5.86 ₪');
  });

  test('omits the memo when there is no tax charge', () => {
    const [transaction] = parseOrderHistoryResponse([buyRow]);

    expect(transaction.memo).toBeUndefined();
  });

  test('returns an empty array when the response is not an array', () => {
    expect(parseOrderHistoryResponse({})).toEqual([]);
    expect(parseOrderHistoryResponse(null)).toEqual([]);
  });

  test('includes the raw transaction only when requested', () => {
    const withRaw = parseOrderHistoryResponse([sellRow], { includeRawTransaction: true } as ScraperOptions);
    const withoutRaw = parseOrderHistoryResponse([sellRow], { includeRawTransaction: false } as ScraperOptions);

    expect(withRaw[0].rawTransaction).toBeDefined();
    expect(withoutRaw[0].rawTransaction).toBeUndefined();
  });
});
