import DiscountScraper, { convertLoans } from './discount';
import { maybeTestCompanyAPI, extendAsyncTimeout, getTestsConfig, exportTransactions } from '../tests/tests-utils';
import { SCRAPERS, CompanyTypes } from '../definitions';
import { LoginResults } from './base-scraper-with-browser';
import { type ScraperOptions } from './interface';
import { type Page } from 'puppeteer';
import * as fetchHelpers from '../helpers/fetch';

const COMPANY_ID = 'discount'; // TODO this property should be hard-coded in the provider
const testsConfig = getTestsConfig();

describe('Discount legacy scraper', () => {
  beforeAll(() => {
    extendAsyncTimeout(); // The default timeout is 5 seconds per async test, this function extends the timeout value
  });

  test('should expose login fields in scrapers constant', () => {
    expect(SCRAPERS.discount).toBeDefined();
    expect(SCRAPERS.discount.loginFields).toContain('id');
    expect(SCRAPERS.discount.loginFields).toContain('password');
    expect(SCRAPERS.discount.loginFields).toContain('num');
  });

  maybeTestCompanyAPI(COMPANY_ID, config => config.companyAPI.invalidPassword)(
    'should fail on invalid user/password"',
    async () => {
      const options = {
        ...testsConfig.options,
        companyId: COMPANY_ID,
      };

      const scraper = new DiscountScraper(options);

      const result = await scraper.scrape({ id: 'e10s12', password: '3f3ss3d', num: '1234' });

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

    const scraper = new DiscountScraper(options);
    const result = await scraper.scrape(testsConfig.credentials.discount);
    expect(result).toBeDefined();
    const error = `${result.errorType || ''} ${result.errorMessage || ''}`.trim();
    expect(error).toBe('');
    expect(result.success).toBeTruthy();

    exportTransactions(COMPANY_ID, result.accounts || []);
  });
});

describe('Discount loans conversion', () => {
  const options: ScraperOptions = {
    companyId: CompanyTypes.discount,
    startDate: new Date('2026-10-01'),
  };

  const sampleLoan = {
    LoanAccount: 'TEST-LOAN-001',
    LoanName: 'Variable rate loan',
    LoanCurrency: 'ILS',
    LoanAmount: 100000,
    PrincipalBalance: 80000,
    InterestBalance: 500,
    LoanBalance: 80500,
    TotalLoanBalance: 80700,
    PrepaymentPenaltyFee: 200,
    TotalInterestRate: 6.25,
    BaseInterestRate: 4.75,
    EarningsRate: 1.5,
    NextPayment: 1200,
    NumOfPayments: '120',
    NumOfPaymentsMade: '32',
    NumOfPaymentsRemained: '88',
    NextPaymentDate: '20261027',
    LastPaymentDate: '20340127',
  };

  test('should convert a loan to BankLoan', () => {
    const loans = convertLoans([sampleLoan], 'TEST-ACCOUNT', options);

    expect(loans).toHaveLength(1);
    expect(loans[0]).toMatchObject({
      sourceAccountNumber: 'TEST-ACCOUNT',
      loanAccountNumber: 'TEST-LOAN-001',
      originalAmount: 100000,
      principalBalance: 80000,
      accruedInterest: 500,
      outstandingBalance: 80500,
      payoffEstimate: 80700,
      interestRate: 6.25,
      monthlyPayment: 1200,
      paymentsTotal: 120,
      paymentsMade: 32,
      paymentsRemaining: 88,
      nextPaymentDate: '2026-10-27',
      endDate: '2034-01-27',
    });
  });

  test('should convert multiple loans', () => {
    const loans = convertLoans([sampleLoan, { ...sampleLoan, LoanAccount: 'TEST-LOAN-002' }], 'TEST-ACCOUNT', options);

    expect(loans).toHaveLength(2);
    expect(loans[0].loanAccountNumber).toBe('TEST-LOAN-001');
    expect(loans[1].loanAccountNumber).toBe('TEST-LOAN-002');
  });

  test('should handle an empty loan list', () => {
    const loans = convertLoans([], 'TEST-ACCOUNT', options);

    expect(loans).toEqual([]);
  });

  test('should omit raw data by default', () => {
    const loans = convertLoans([sampleLoan], 'TEST-ACCOUNT', options);

    expect(loans[0].rawLoan).toBeUndefined();
  });

  test('should include raw data when requested', () => {
    const loans = convertLoans([sampleLoan], 'TEST-ACCOUNT', { ...options, includeRawLoan: true });

    expect(loans[0].rawLoan).toEqual(sampleLoan);
  });

  test('should handle invalid payment counts', () => {
    const loans = convertLoans([{ ...sampleLoan, NumOfPaymentsRemained: 'invalid' }], 'TEST-ACCOUNT', options);

    expect(loans[0].paymentsRemaining).toBeUndefined();
  });
});

describe('Discount loans fetching', () => {
  class TestableDiscountScraper extends DiscountScraper {
    fetchWithMockPage() {
      this.page = {} as Page;
      return this.fetchData();
    }
  }

  const accountsResponse = (ids: string[]) => ({
    UserAccountsData: {
      DefaultAccountNumber: ids[0] ?? '',
      UserAccounts: ids.map(id => ({
        NewAccountInfo: { AccountID: id },
      })),
    },
  });

  const transactionsResponse = {
    CurrentAccountLastTransactions: {
      OperationEntry: [],
      CurrentAccountInfo: { AccountBalance: 100 },
      FutureTransactionsBlock: {
        FutureTransactionEntry: [],
      },
    },
  };

  const loansResponse = (entries: unknown[]) => ({
    LoansQuery: {
      LoanDetailsBlock: {
        LoanEntry: entries,
      },
    },
  });

  function mockResponses(...responses: unknown[]) {
    const spy = jest.spyOn(fetchHelpers, 'fetchGetWithinPage');

    for (const response of responses) {
      if (response instanceof Error) {
        spy.mockRejectedValueOnce(response);
      } else {
        spy.mockResolvedValueOnce(response as never);
      }
    }

    return spy;
  }

  function runScraper(overrides: Partial<ScraperOptions> = {}) {
    const scraper = new TestableDiscountScraper({
      companyId: CompanyTypes.discount,
      startDate: new Date('2026-10-01'),
      ...overrides,
    });

    return scraper.fetchWithMockPage();
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('should not fetch loans by default', async () => {
    const fetchMock = mockResponses(accountsResponse(['ACCOUNT-A']), transactionsResponse);

    const result = await runScraper();

    expect(result.success).toBe(true);
    expect(result.accounts).toHaveLength(1);
    expect(result.loans).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('should fetch loans when enabled', async () => {
    const fetchMock = mockResponses(
      accountsResponse(['ACCOUNT-A']),
      transactionsResponse,
      loansResponse([
        {
          LoanAccount: 'LOAN-A',
          PrincipalBalance: 8000,
          TotalInterestRate: 6.25,
        },
      ]),
    );

    const result = await runScraper({
      includeLoans: true,
    });

    expect(result.success).toBe(true);
    expect(result.loans).toHaveLength(1);
    expect(result.loans?.[0]).toMatchObject({
      loanAccountNumber: 'LOAN-A',
      principalBalance: 8000,
      interestRate: 6.25,
    });
    expect(result.loansError).toBeUndefined();

    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      expect.anything(),
      expect.stringContaining('/onlineLoans/loansQuery/ACCOUNT-A'),
    );
  });

  test('should support accounts without loans', async () => {
    mockResponses(accountsResponse(['ACCOUNT-A']), transactionsResponse, loansResponse([]));

    const result = await runScraper({
      includeLoans: true,
    });

    expect(result.success).toBe(true);
    expect(result.loans).toEqual([]);
    expect(result.loansError).toBeUndefined();
  });

  test('should preserve loans after partial failure', async () => {
    mockResponses(
      accountsResponse(['ACCOUNT-A', 'ACCOUNT-B']),
      transactionsResponse,
      transactionsResponse,
      loansResponse([
        {
          LoanAccount: 'LOAN-A',
          PrincipalBalance: 8000,
        },
      ]),
      new Error('Simulated request failure'),
    );

    const result = await runScraper({
      includeLoans: true,
    });

    expect(result.success).toBe(true);
    expect(result.accounts).toHaveLength(2);
    expect(result.loans).toHaveLength(1);
    expect(result.loans?.[0].loanAccountNumber).toBe('LOAN-A');
    expect(result.loansError).toContain('1 account(s)');
  });

  test('should preserve accounts when loans response is invalid', async () => {
    mockResponses(accountsResponse(['ACCOUNT-A']), transactionsResponse, { LoansQuery: {} });

    const result = await runScraper({
      includeLoans: true,
    });

    expect(result.success).toBe(true);
    expect(result.accounts).toHaveLength(1);
    expect(result.loans).toEqual([]);
    expect(result.loansError).toBeDefined();
  });

  test('should not fetch loans for Mercantile', async () => {
    const fetchMock = mockResponses(accountsResponse(['ACCOUNT-A']), transactionsResponse);

    const result = await runScraper({
      companyId: CompanyTypes.mercantile,
      includeLoans: true,
    });

    expect(result.success).toBe(true);
    expect(result.loans).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
