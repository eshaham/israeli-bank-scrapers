import { type Page } from 'puppeteer';
import { LoanInterestTypes, LoanLinkageTypes, LoanTypes } from '../../transactions';
import {
  fetchLeumiLoans,
  hasRegularLoans,
  mapInterestType,
  mapLinkage,
  mapLoanPageFields,
  mapMortgage,
  mapMortgageTrack,
  mapPortfolioAccountNumber,
  parseAmount,
  type LeumiMortgageDetail,
  type LeumiMortgageTrack,
} from './leumi-loans';

const fixedTrack: LeumiMortgageTrack = {
  loanId: '111',
  productName: 'ריבית קבועה לא צמודה',
  currencyLeumi: '080',
  loanAmount: 300000,
  fundBalance: 250000,
  clearingBalance: 251000,
  annualInterestPercent: 4.5,
  interestType: 'FIXED',
  linkageBase: 'לא',
  loanCreditDate: '15.03.22',
  calculateEndDate: '10.03.47',
  lastPaymentAmount: 1500,
  // like the real response, every track repeats the whole mortgage's payments
  paymentItems: [
    { paymentDate: '10.2026', paymentAmount: 2500 },
    { paymentDate: '09.2026', paymentAmount: 2480 },
  ],
};

const primeTrack: LeumiMortgageTrack = {
  ...fixedTrack,
  loanId: '222',
  productName: 'ריבית פריים',
  loanAmount: 200000,
  fundBalance: 150000,
  clearingBalance: 150500,
  annualInterestPercent: 5.25,
  interestType: 'VARIABLE',
  lastPaymentAmount: 1000,
};

const mortgageDetail: LeumiMortgageDetail = {
  mortgageKey: '1234567890123',
  currencyLeumi: '080',
  clearingBalance: 401500,
  mortgageAmount: 500000,
  lastPaymentAmount: 2500,
  bookingDate: '15.03.22',
  mortgageEndDate: '10.03.47',
  mortgagePurpose: 'לווה פרטי-מגורים',
  portfolioAccountsItems: [{ portfolioAccountNum: '10-123-4567890' }],
  balanceItems: [{ fundBalance: 400000, clearingBalance: 401500 }],
};

describe('mapPortfolioAccountNumber', () => {
  test('converts the portfolio format to the transactions account number format', () => {
    expect(mapPortfolioAccountNumber('10-123-4567890')).toBe('123-45678_90');
  });

  test('returns the input unchanged when it does not match the expected format', () => {
    expect(mapPortfolioAccountNumber('unexpected')).toBe('unexpected');
  });
});

describe('mapLinkage', () => {
  test('maps the "no linkage" label', () => {
    expect(mapLinkage('לא')).toBe(LoanLinkageTypes.None);
  });

  test('maps CPI linkage', () => {
    expect(mapLinkage('100% הצמדה למדד')).toBe(LoanLinkageTypes.Cpi);
  });

  test('returns undefined for unknown or missing labels', () => {
    expect(mapLinkage('הצמדה לדולר')).toBeUndefined();
    expect(mapLinkage(null)).toBeUndefined();
  });
});

describe('mapInterestType', () => {
  test('maps known interest types', () => {
    expect(mapInterestType('FIXED')).toBe(LoanInterestTypes.Fixed);
    expect(mapInterestType('VARIABLE')).toBe(LoanInterestTypes.Variable);
  });

  test('returns undefined for unknown types', () => {
    expect(mapInterestType('OTHER')).toBeUndefined();
    expect(mapInterestType(undefined)).toBeUndefined();
  });
});

describe('parseAmount', () => {
  test('parses displayed numbers', () => {
    expect(parseAmount('1,234.56')).toBe(1234.56);
    expect(parseAmount(' ₪ 1,234,567.89')).toBe(1234567.89);
    expect(parseAmount('4.5%')).toBe(4.5);
    expect(parseAmount('-12')).toBe(-12);
  });

  test('returns undefined rather than extracting a number from other text', () => {
    expect(parseAmount('פריים+1.5%')).toBeUndefined();
    expect(parseAmount('1.2.3')).toBeUndefined();
    expect(parseAmount('12,34')).toBeUndefined();
    expect(parseAmount('')).toBeUndefined();
  });
});

describe('mapMortgageTrack', () => {
  test('maps a track', () => {
    expect(mapMortgageTrack(fixedTrack, '123-45678_90')).toEqual({
      type: LoanTypes.Mortgage,
      accountNumber: '123-45678_90',
      loanId: '111',
      name: 'ריבית קבועה לא צמודה',
      currency: 'ILS',
      originalAmount: 300000,
      principalBalance: 250000,
      totalBalance: 251000,
      startDate: expect.stringMatching(/^2022-03-1[45]T/),
      endDate: expect.stringMatching(/^2047-03-(09|10)T/),
      lastPaymentAmount: 1500,
      interestRate: 4.5,
      interestType: LoanInterestTypes.Fixed,
      linkage: LoanLinkageTypes.None,
    });
  });

  test('returns null for an unknown currency rather than guessing', () => {
    expect(mapMortgageTrack({ ...fixedTrack, currencyLeumi: '999' }, '123-45678_90')).toBeNull();
  });

  test('leaves dates undefined when they are missing or malformed', () => {
    const track = mapMortgageTrack({ ...fixedTrack, loanCreditDate: null, calculateEndDate: '2047-03-10' }, '');
    expect(track?.startDate).toBeUndefined();
    expect(track?.endDate).toBeUndefined();
  });

  test("takes the track's own payment, not the mortgage payment repeated in its payment history", () => {
    expect(mapMortgageTrack(primeTrack, '')?.lastPaymentAmount).toBe(1000);
  });

  test('leaves the last payment undefined when the track has none', () => {
    expect(mapMortgageTrack({ ...fixedTrack, lastPaymentAmount: null }, '')?.lastPaymentAmount).toBeUndefined();
  });
});

describe('mapMortgage', () => {
  test('maps the mortgage and nests its tracks', () => {
    const mortgage = mapMortgage(mortgageDetail, [fixedTrack, primeTrack]);

    expect(mortgage).toMatchObject({
      type: LoanTypes.Mortgage,
      accountNumber: '123-45678_90',
      loanId: '1234567890123',
      name: 'לווה פרטי-מגורים',
      currency: 'ILS',
      originalAmount: 500000,
      principalBalance: 400000,
      totalBalance: 401500,
      lastPaymentAmount: 2500,
    });
    expect(mortgage?.tracks?.map(track => track.loanId)).toEqual(['111', '222']);
    expect(mortgage?.tracks?.every(track => track.accountNumber === '123-45678_90')).toBe(true);
  });

  test("takes the mortgage's own payment rather than summing the tracks' payment histories", () => {
    const tracks = [fixedTrack, primeTrack, { ...primeTrack, loanId: '333' }].map(track => ({
      ...track,
      paymentItems: fixedTrack.paymentItems,
    }));
    const mortgage = mapMortgage(mortgageDetail, tracks);
    expect(mortgage?.lastPaymentAmount).toBe(2500);
    expect(mortgage?.tracks?.map(track => track.lastPaymentAmount)).toEqual([1500, 1000, 1000]);
  });

  test('leaves tracks undefined when they could not be fetched, not empty', () => {
    const mortgage = mapMortgage(mortgageDetail, undefined);
    expect(mortgage?.tracks).toBeUndefined();
    expect(mortgage?.lastPaymentAmount).toBe(2500);
  });

  test('leaves tracks undefined when any track cannot be mapped, rather than returning a partial list', () => {
    expect(mapMortgage(mortgageDetail, [fixedTrack, { ...primeTrack, currencyLeumi: '999' }])?.tracks).toBeUndefined();
  });

  test('returns null for an unknown currency', () => {
    expect(mapMortgage({ ...mortgageDetail, currencyLeumi: '999' }, [fixedTrack])).toBeNull();
  });

  test('leaves the principal balance undefined when it is missing, rather than reporting zero', () => {
    expect(mapMortgage({ ...mortgageDetail, balanceItems: [] }, [fixedTrack])?.principalBalance).toBeUndefined();
    const withNull = {
      ...mortgageDetail,
      balanceItems: [{ fundBalance: 400000, clearingBalance: 1 }, { fundBalance: null }],
    };
    expect(mapMortgage(withNull as unknown as LeumiMortgageDetail, [fixedTrack])?.principalBalance).toBeUndefined();
  });

  test('returns null when the account is missing, rather than an empty account number', () => {
    expect(mapMortgage({ ...mortgageDetail, portfolioAccountsItems: [] }, [fixedTrack])).toBeNull();
  });

  test('leaves the last payment undefined when the mortgage has none', () => {
    expect(
      mapMortgage({ ...mortgageDetail, lastPaymentAmount: null }, [fixedTrack])?.lastPaymentAmount,
    ).toBeUndefined();
  });
});

describe('mapLoanPageFields', () => {
  const fields = {
    'נכון לתאריך': '14/10/26',
    סוג: 'לא צמוד ר.קבועה',
    חשבון: '123-45678/90',
    'מספר הלוואה': '87654321',
    מטבע: '₪',
    'מטרת הלוואה': 'הל. לכל מטרה',
    'תשלומים שנותרו': '30',
    'סכום הלוואה מקורי': '60,000.00',
    'יתרת קרן': '42,500.50',
    'סכום הלוואה משוערך בש"ח': '42,500.50',
    'סכום התשלום הבא': '1,650.25',
    'סוג הצמדה': 'לא צמוד',
    'שיעור ריבית': '6.10%',
    'תאריך העמדת הלוואה': '01/05/24',
    'תאריך סיום': '01/05/29',
    'תאריך התשלום הבא': '01/11/26',
  };

  test('maps a loan details page', () => {
    expect(mapLoanPageFields(fields)).toEqual({
      type: LoanTypes.Loan,
      accountNumber: '123-45678_90',
      loanId: '87654321',
      name: 'לא צמוד ר.קבועה',
      currency: 'ILS',
      originalAmount: 60000,
      principalBalance: 42500.5,
      startDate: expect.stringMatching(/^2024-0(4-30|5-01)T/),
      endDate: expect.stringMatching(/^2029-0(4-30|5-01)T/),
      nextPaymentAmount: 1650.25,
      nextPaymentDate: expect.stringMatching(/^2026-1(0-31|1-01)T/),
      interestRate: 6.1,
      interestType: LoanInterestTypes.Fixed,
      linkage: LoanLinkageTypes.None,
    });
  });

  test('leaves the interest type and linkage undefined for labels it does not know', () => {
    const loan = mapLoanPageFields({ ...fields, סוג: 'מט"י ז"א', 'סוג הצמדה': 'צמוד מדד' });
    expect(loan?.interestType).toBeUndefined();
    expect(loan?.linkage).toBeUndefined();
  });

  test('leaves the rate undefined for a prime based rate label', () => {
    expect(mapLoanPageFields({ ...fields, 'שיעור ריבית': 'פריים+1.5%' })?.interestRate).toBeUndefined();
  });

  test('returns null for a foreign currency loan rather than guessing', () => {
    expect(mapLoanPageFields({ ...fields, מטבע: '$' })).toBeNull();
  });

  test('returns null when the loan number is missing', () => {
    expect(mapLoanPageFields({ ...fields, 'מספר הלוואה': '' })).toBeNull();
  });
});

describe('hasRegularLoans', () => {
  test('is true when the summary has a loans total', () => {
    expect(
      hasRegularLoans({
        multiCheckingFlag: false,
        TotalPerTypeItems: [{ accountType: 'CHECKING' }, { accountType: 'LOAN' }],
      }),
    ).toBe(true);
  });

  test('is false when the summary has no loans total', () => {
    expect(hasRegularLoans({ multiCheckingFlag: false, TotalPerTypeItems: [{ accountType: 'CHECKING' }] })).toBe(false);
  });

  test('is unknown for customers with multiple checking accounts, since the summary covers one account', () => {
    expect(
      hasRegularLoans({ multiCheckingFlag: true, TotalPerTypeItems: [{ accountType: 'CHECKING' }] }),
    ).toBeUndefined();
  });

  test('is unknown when the summary is missing or unexpected', () => {
    expect(hasRegularLoans(null)).toBeUndefined();
    expect(hasRegularLoans({ multiCheckingFlag: false })).toBeUndefined();
  });
});

describe('fetchLeumiLoans', () => {
  const LOAN_ACTIVITY_URL = 'https://hb2.bankleumi.co.il/eBanking/LoanAndMortgages/DisplayLoanActivity.aspx';

  /**
   * @param responses JSON API responses by URL suffix; fetchGetWithinPage resolves `page.evaluate` to [text, status]
   * @param loanPages label/value fields of each loan details page, by its index in the loans dropdown
   */
  function mockPage(responses: Record<string, unknown>, loanPages?: Record<string, Record<string, string>>): Page {
    let currentUrl = '';
    return {
      evaluate: jest.fn((_fn: unknown, url: string) => {
        const key = Object.keys(responses).find(suffix => url.endsWith(suffix));
        if (!key) {
          return Promise.reject(new Error(`unexpected url ${url}`));
        }
        const response = responses[key];
        if (response instanceof Error) {
          return Promise.reject(response);
        }
        return Promise.resolve([typeof response === 'string' ? response : JSON.stringify(response), 200]);
      }),
      goto: jest.fn((url: string) => {
        currentUrl = url;
        return Promise.resolve(null);
      }),
      $: jest.fn((selector: string) => {
        const onLoansPage = !!loanPages && currentUrl.startsWith(LOAN_ACTIVITY_URL);
        const index = new URL(currentUrl || 'https://x').searchParams.get('index');
        const present =
          (selector === '#ddlAccounts_m_ddl' && onLoansPage) ||
          (selector === '#pnlVariousData' && onLoansPage && !!index && !!loanPages?.[index]);
        return Promise.resolve(present ? {} : null);
      }),
      $$eval: jest.fn((selector: string, fn: (elements: unknown[], arg?: unknown) => unknown, arg?: unknown) => {
        if (selector.endsWith('option')) {
          const values = ['-1', ...Object.keys(loanPages ?? {})];
          return Promise.resolve(
            fn(
              values.map(value => ({ value })),
              arg,
            ),
          );
        }
        const index = new URL(currentUrl).searchParams.get('index') ?? '';
        const labels = Object.entries(loanPages?.[index] ?? {}).map(([label, value]) => ({
          textContent: `${label}:`,
          nextElementSibling: { textContent: value },
        }));
        return Promise.resolve(fn(labels, arg));
      }),
    } as unknown as Page;
  }

  const gotoMock = (page: Page) => (page as unknown as { goto: jest.Mock }).goto;

  const mortgageDetailsResponse = { loanMortgageItems: [{ MortgageDetail: mortgageDetail }] };
  const loanInfoResponse = { MortgageDetails: { loansItems: [fixedTrack, primeTrack] } };
  const noLoansSummary = { multiCheckingFlag: false, TotalPerTypeItems: [{ accountType: 'CHECKING' }] };
  const withLoansSummary = { multiCheckingFlag: false, TotalPerTypeItems: [{ accountType: 'LOAN' }] };
  const loanPageFields = (loanNumber: string) => ({
    סוג: 'לא צמוד ר.קבועה',
    חשבון: '123-45678/90',
    'מספר הלוואה': loanNumber,
    מטבע: '₪',
    'סכום הלוואה מקורי': '60,000.00',
    'יתרת קרן': '42,500.50',
  });

  test('fetches mortgages and their tracks', async () => {
    const page = mockPage({
      '/mortgageDetails': mortgageDetailsResponse,
      '/loanInfo': loanInfoResponse,
      '/SummaryData': noLoansSummary,
    });
    const loans = await fetchLeumiLoans(page);
    expect(loans).toHaveLength(1);
    expect(loans?.[0].tracks).toHaveLength(2);
  });

  test('returns an empty list when the customer has no mortgages and no loans', async () => {
    const page = mockPage({ '/mortgageDetails': { loanMortgageItems: [] }, '/SummaryData': noLoansSummary });
    expect(await fetchLeumiLoans(page)).toEqual([]);
  });

  test('does not open the loans page when the summary shows no loans', async () => {
    const page = mockPage({ '/mortgageDetails': mortgageDetailsResponse, '/SummaryData': noLoansSummary });
    await fetchLeumiLoans(page);
    expect(gotoMock(page)).not.toHaveBeenCalled();
  });

  test('fetches each regular loan from its own page, skipping the dropdown placeholder', async () => {
    const page = mockPage(
      { '/mortgageDetails': mortgageDetailsResponse, '/loanInfo': loanInfoResponse, '/SummaryData': withLoansSummary },
      { '11': loanPageFields('111111'), '12': loanPageFields('222222') },
    );
    const loans = await fetchLeumiLoans(page);
    expect(loans?.map(loan => [loan.type, loan.loanId])).toEqual([
      [LoanTypes.Mortgage, '1234567890123'],
      [LoanTypes.Loan, '111111'],
      [LoanTypes.Loan, '222222'],
    ]);
    expect(gotoMock(page)).toHaveBeenCalledWith(`${LOAN_ACTIVITY_URL}?index=11`, expect.anything());
    expect(gotoMock(page)).not.toHaveBeenCalledWith(`${LOAN_ACTIVITY_URL}?index=-1`, expect.anything());
  });

  test('opens the loans page when the summary is unavailable', async () => {
    const page = mockPage(
      { '/mortgageDetails': { loanMortgageItems: [] }, '/SummaryData': new Error('network') },
      { '11': loanPageFields('111111') },
    );
    expect(await fetchLeumiLoans(page)).toHaveLength(1);
  });

  test('returns undefined when the loans page is expected but not found', async () => {
    const page = mockPage({ '/mortgageDetails': mortgageDetailsResponse, '/SummaryData': withLoansSummary });
    expect(await fetchLeumiLoans(page)).toBeUndefined();
  });

  test('returns undefined when any regular loan cannot be mapped, rather than a partial list', async () => {
    const page = mockPage(
      { '/mortgageDetails': { loanMortgageItems: [] }, '/SummaryData': withLoansSummary },
      { '11': loanPageFields('111111'), '12': { ...loanPageFields('222222'), מטבע: '$' } },
    );
    expect(await fetchLeumiLoans(page)).toBeUndefined();
  });

  test('returns undefined, not an empty list, when the response is not the expected shape', async () => {
    const page = mockPage({ '/mortgageDetails': { error: 'something' } });
    expect(await fetchLeumiLoans(page)).toBeUndefined();
  });

  test('returns undefined when the response is not JSON, e.g. a login page', async () => {
    const page = mockPage({ '/mortgageDetails': '<html>login</html>' });
    expect(await fetchLeumiLoans(page)).toBeUndefined();
  });

  test('returns undefined when the request fails', async () => {
    const page = mockPage({ '/mortgageDetails': new Error('network') });
    expect(await fetchLeumiLoans(page)).toBeUndefined();
  });

  test('keeps the mortgage without tracks when only the tracks request fails', async () => {
    const page = mockPage({
      '/mortgageDetails': mortgageDetailsResponse,
      '/loanInfo': new Error('network'),
      '/SummaryData': noLoansSummary,
    });
    const loans = await fetchLeumiLoans(page);
    expect(loans).toHaveLength(1);
    expect(loans?.[0].tracks).toBeUndefined();
  });

  test('returns undefined when any mortgage cannot be mapped, rather than a partial list', async () => {
    const page = mockPage({
      '/mortgageDetails': {
        loanMortgageItems: [
          { MortgageDetail: mortgageDetail },
          { MortgageDetail: { ...mortgageDetail, mortgageKey: '999', currencyLeumi: '999' } },
        ],
      },
      '/loanInfo': loanInfoResponse,
      '/SummaryData': noLoansSummary,
    });
    expect(await fetchLeumiLoans(page)).toBeUndefined();
  });
});
