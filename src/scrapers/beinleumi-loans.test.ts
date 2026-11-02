import { type Frame, type Page } from 'puppeteer';
import { LoanInterestTypes, LoanTypes } from '../transactions';
import {
  fetchBeinleumiLoans,
  mapLoanRow,
  mapLoanRows,
  parseAmount,
  parseInterestRate,
  parseLoanNumber,
  parseScheduleArgs,
  parseScheduleUrl,
  type ScrapedLoanRow,
} from './beinleumi-loans';

// skip the delay between attempts to find the loans table
jest.mock('../helpers/waiting', () => ({ sleep: () => Promise.resolve() }));

const loanRow: ScrapedLoanRow = {
  cells: [
    'הלוואה לכל מטרה\n123-456',
    '50,000.00',
    '15/03/24',
    'P-0.50 %\n( 5.50% )',
    '32,345.67',
    '15/03/29',
    '1,012.34',
    '15/11/26',
    '',
  ],
  scheduleHref: 'javascript:luachSilukin(105,20240315,456);',
};

describe('parseInterestRate', () => {
  test('takes the current rate in parentheses for prime based loans', () => {
    expect(parseInterestRate('P-0.50 %\n( 5.50% )')).toEqual({
      interestRate: 5.5,
      interestType: LoanInterestTypes.Variable,
    });
  });

  test('parses a plain rate without guessing its type', () => {
    expect(parseInterestRate('4.25 %')).toEqual({ interestRate: 4.25, interestType: undefined });
  });

  test('returns an undefined rate for unparsable text', () => {
    expect(parseInterestRate('').interestRate).toBeUndefined();
  });

  test('does not report the prime spread as the rate when the current rate is missing', () => {
    expect(parseInterestRate('P-0.50 %')).toEqual({
      interestRate: undefined,
      interestType: LoanInterestTypes.Variable,
    });
  });
});

describe('parseAmount', () => {
  test('parses displayed numbers', () => {
    expect(parseAmount('32,345.67')).toBe(32345.67);
    expect(parseAmount(' 1,012.34 ')).toBe(1012.34);
    expect(parseAmount('5.50%')).toBe(5.5);
  });

  test('returns undefined rather than extracting a number from other text', () => {
    expect(parseAmount('P-0.50 % ( 5.50% )')).toBeUndefined();
    expect(parseAmount('')).toBeUndefined();
  });
});

describe('parseLoanNumber', () => {
  test('reads the loan number from the payment schedule link', () => {
    expect(parseLoanNumber('javascript:luachSilukin(105,20240315,456);')).toBe('456');
  });

  test('returns undefined for an unexpected link', () => {
    expect(parseLoanNumber('javascript:somethingElse();')).toBeUndefined();
  });
});

describe('parseScheduleArgs', () => {
  test('reads all the payment schedule link arguments', () => {
    expect(parseScheduleArgs('javascript:luachSilukin(105,20240315,456);')).toEqual({
      accountType: 105,
      loanDate: 20240315,
      loanNumber: '456',
    });
  });

  test('returns undefined for an unexpected link', () => {
    expect(parseScheduleArgs('javascript:luachSilukin(105);')).toBeUndefined();
  });
});

describe('parseScheduleUrl', () => {
  const baseUrl = 'https://online.example.co.il';
  const scheduleUrl = 'https://apps.example.co.il/Resources/loan-repayments?code=abc&X-FIBI-Transaction-ID=1';

  test('accepts a URL returned as a JSON string', () => {
    expect(parseScheduleUrl(JSON.stringify(scheduleUrl), baseUrl)).toBe(scheduleUrl);
  });

  test('accepts a URL returned as plain text', () => {
    expect(parseScheduleUrl(` ${scheduleUrl} `, baseUrl)).toBe(scheduleUrl);
  });

  test('rejects a URL without a code', () => {
    expect(parseScheduleUrl('https://apps.example.co.il/Resources/loan-repayments', baseUrl)).toBeUndefined();
  });

  test('rejects an error object or an empty response', () => {
    expect(parseScheduleUrl('{"error":"failed"}', baseUrl)).toBeUndefined();
    expect(parseScheduleUrl('', baseUrl)).toBeUndefined();
  });
});

describe('mapLoanRow', () => {
  test('maps a loans table row', () => {
    expect(mapLoanRow(loanRow, '123456')).toEqual({
      type: LoanTypes.Loan,
      accountNumber: '123456',
      loanId: '456',
      name: 'הלוואה לכל מטרה',
      currency: 'ILS',
      originalAmount: 50000,
      totalBalance: 32345.67,
      startDate: expect.stringMatching(/^2024-03-1[45]T/),
      endDate: expect.stringMatching(/^2029-03-1[45]T/),
      nextPaymentAmount: 1012.34,
      nextPaymentDate: expect.stringMatching(/^2026-11-1[45]T/),
      interestRate: 5.5,
      interestType: LoanInterestTypes.Variable,
    });
  });

  test('leaves the principal balance to the payment schedule, since the table only shows the total debt', () => {
    expect(mapLoanRow(loanRow, '123456')?.principalBalance).toBeUndefined();
  });

  test('returns null when the row has an unexpected number of cells', () => {
    expect(mapLoanRow({ ...loanRow, cells: loanRow.cells.slice(1) }, '123456')).toBeNull();
  });

  test('returns null when the loan number cannot be read', () => {
    expect(mapLoanRow({ ...loanRow, scheduleHref: '' }, '123456')).toBeNull();
  });
});

describe('mapLoanRows', () => {
  test('returns an empty list for a table without rows', () => {
    expect(mapLoanRows([], '123456')).toEqual([]);
  });

  test('returns undefined when any row cannot be mapped, rather than a partial list', () => {
    expect(mapLoanRows([loanRow, { ...loanRow, scheduleHref: '' }], '123456')).toBeUndefined();
  });
});

describe('fetchBeinleumiLoans', () => {
  const BASE_URL = 'https://online.example.co.il';
  const SCHEDULE_URL = 'https://apps.example.co.il/Resources/loan-repayments?code=abc';

  interface MockOptions {
    hasTable?: boolean;
    rows?: ScrapedLoanRow[];
    ssoResponse?: string | Error;
    navigation?: 'ok' | 'fails';
    repayments?: unknown;
  }

  function mockPage({
    hasTable = true,
    rows = [loanRow],
    ssoResponse = JSON.stringify(SCHEDULE_URL),
    navigation = 'ok',
    repayments = { loanNumber: 456, balance: 30000 },
  }: MockOptions = {}) {
    const rowElements = rows.map(row => ({
      querySelectorAll: () =>
        row.cells.map((text, index) => ({
          innerText: text,
          querySelector: () => (index === 8 ? { getAttribute: () => row.scheduleHref } : null),
        })),
    }));
    const frame = {
      $: jest.fn(() => Promise.resolve(hasTable ? {} : null)),
      $$eval: jest.fn((_selector: string, fn: (elements: unknown[], arg: unknown) => unknown, arg: unknown) =>
        Promise.resolve(fn(rowElements, arg)),
      ),
    } as unknown as Frame;

    const schedulePage = {
      setDefaultTimeout: jest.fn(),
      // like puppeteer, the response wait rejects once the page is closed
      waitForResponse: jest.fn(
        () =>
          new Promise((resolve, reject) => {
            if (navigation === 'ok') {
              resolve({ json: () => Promise.resolve(repayments) });
            } else {
              setTimeout(() => reject(new Error('Target closed')), 10);
            }
          }),
      ),
      goto: jest.fn(() =>
        navigation === 'ok' ? Promise.resolve(null) : Promise.reject(new Error(`net::ERR_FAILED at ${SCHEDULE_URL}`)),
      ),
      close: jest.fn(() => Promise.resolve()),
    };

    const page = {
      goto: jest.fn(() => Promise.resolve(null)),
      frames: () => [frame],
      getDefaultTimeout: () => 30000,
      evaluate: jest.fn(() =>
        ssoResponse instanceof Error ? Promise.reject(ssoResponse) : Promise.resolve(ssoResponse),
      ),
      browserContext: () => ({ newPage: () => Promise.resolve(schedulePage) }),
    } as unknown as Page;

    return { page, schedulePage };
  }

  const getAccountNumber = () => Promise.resolve('123456');

  test('maps the loans table and adds the principal from the payment schedule', async () => {
    const { page, schedulePage } = mockPage();
    const loans = await fetchBeinleumiLoans(page, BASE_URL, getAccountNumber);
    expect(loans).toHaveLength(1);
    expect(loans?.[0]).toMatchObject({ loanId: '456', accountNumber: '123456', principalBalance: 30000 });
    expect(schedulePage.close).toHaveBeenCalled();
  });

  test('returns undefined when the loans table is not found', async () => {
    const { page } = mockPage({ hasTable: false });
    expect(await fetchBeinleumiLoans(page, BASE_URL, getAccountNumber)).toBeUndefined();
  });

  test('returns undefined when a row cannot be mapped, rather than a partial list', async () => {
    const { page } = mockPage({ rows: [loanRow, { ...loanRow, scheduleHref: '' }] });
    expect(await fetchBeinleumiLoans(page, BASE_URL, getAccountNumber)).toBeUndefined();
  });

  test('keeps the loan without a principal when the SSO response is not a schedule URL', async () => {
    const { page } = mockPage({ ssoResponse: '{"error":"failed"}' });
    const loans = await fetchBeinleumiLoans(page, BASE_URL, getAccountNumber);
    expect(loans).toHaveLength(1);
    expect(loans?.[0].principalBalance).toBeUndefined();
  });

  test('keeps the loan without a principal when the SSO request fails', async () => {
    const { page } = mockPage({ ssoResponse: new Error('network') });
    expect((await fetchBeinleumiLoans(page, BASE_URL, getAccountNumber))?.[0].principalBalance).toBeUndefined();
  });

  test('keeps the loan, without crashing, when the schedule page fails to load', async () => {
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const { page, schedulePage } = mockPage({ navigation: 'fails' });
      const loans = await fetchBeinleumiLoans(page, BASE_URL, getAccountNumber);
      expect(loans?.[0].principalBalance).toBeUndefined();
      expect(schedulePage.close).toHaveBeenCalled();
      // let the pending response wait reject after the page was closed
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  test('ignores a schedule response for another loan or without a numeric balance', async () => {
    const otherLoan = mockPage({ repayments: { loanNumber: 789, balance: 30000 } });
    expect(
      (await fetchBeinleumiLoans(otherLoan.page, BASE_URL, getAccountNumber))?.[0].principalBalance,
    ).toBeUndefined();
    const noBalance = mockPage({ repayments: { loanNumber: 456, balance: '30000' } });
    expect(
      (await fetchBeinleumiLoans(noBalance.page, BASE_URL, getAccountNumber))?.[0].principalBalance,
    ).toBeUndefined();
  });

  test('returns undefined when reading the page throws', async () => {
    const { page } = mockPage();
    const failing = { ...page, goto: () => Promise.reject(new Error('timeout')) } as unknown as Page;
    expect(await fetchBeinleumiLoans(failing, BASE_URL, getAccountNumber)).toBeUndefined();
  });
});
