import moment from 'moment';
import { type Page } from 'puppeteer';
import { waitUntilElementFound } from '../helpers/elements-interactions';
import { fetchGetWithinPage } from '../helpers/fetch';
import { waitForNavigation } from '../helpers/navigation';
import { getRawTransaction } from '../helpers/transactions';
import { type Transaction, TransactionStatuses, TransactionTypes } from '../transactions';
import { BaseScraperWithBrowser, LoginResults, type PossibleLoginResults } from './base-scraper-with-browser';
import { ScraperErrorTypes } from './errors';
import { type ScraperOptions, type ScraperScrapingResult } from './interface';
import { CompanyTypes } from '../definitions';
import { type BankLoan } from '../loans';

const BASE_URL = 'https://start.telebank.co.il';
const DATE_FORMAT = 'YYYYMMDD';

interface ScrapedTransaction {
  OperationNumber: number;
  OperationDate: string;
  ValueDate: string;
  OperationAmount: number;
  OperationDescriptionToDisplay: string;
}

interface CurrentAccountInfo {
  AccountBalance: number;
}

interface ScrapedAccountData {
  UserAccountsData: {
    DefaultAccountNumber: string;
    UserAccounts: Array<{
      NewAccountInfo: {
        AccountID: string;
      };
    }>;
  };
}

interface ScrapedTransactionData {
  Error?: { MsgText: string };
  CurrentAccountLastTransactions?: {
    OperationEntry: ScrapedTransaction[];
    CurrentAccountInfo: CurrentAccountInfo;
    FutureTransactionsBlock?: {
      FutureTransactionEntry: ScrapedTransaction[];
    };
  };
}

function convertTransactions(
  txns: ScrapedTransaction[],
  txnStatus: TransactionStatuses,
  options?: ScraperOptions,
): Transaction[] {
  if (!txns) {
    return [];
  }
  return txns.map(txn => {
    const result: Transaction = {
      type: TransactionTypes.Normal,
      identifier: txn.OperationNumber,
      date: moment(txn.OperationDate, DATE_FORMAT).toISOString(),
      processedDate: moment(txn.ValueDate, DATE_FORMAT).toISOString(),
      originalAmount: txn.OperationAmount,
      originalCurrency: 'ILS',
      chargedAmount: txn.OperationAmount,
      description: txn.OperationDescriptionToDisplay,
      status: txnStatus,
    };

    if (options?.includeRawTransaction) {
      result.rawTransaction = getRawTransaction(txn);
    }

    return result;
  });
}

interface ScrapedLoan {
  LoanAccount: string;
  LoanName?: string;
  LoanCurrency?: string;
  LoanAmount?: number;
  PrincipalBalance?: number;
  InterestBalance?: number;
  LoanBalance?: number;
  TotalLoanBalance?: number;
  PrepaymentPenaltyFee?: number;
  TotalInterestRate?: number;
  EffectiveInterstRate?: number;
  BaseInterestRate?: number;
  EarningsRate?: number;
  NextPayment?: number;
  NumOfPayments?: string;
  NumOfPaymentsMade?: string;
  NumOfPaymentsRemained?: string;
  NextPaymentDate?: string;
  LastPaymentDate?: string;
}
interface DiscountLoansResponse {
  LoansQuery?: {
    LoanDetailsBlock?: {
      LoanEntry?: ScrapedLoan | ScrapedLoan[];
    };
  };
}

export function convertLoans(loans: ScrapedLoan[], accountNumber: string, options: ScraperOptions): BankLoan[] {
  return loans.map(loan => {
    const result: BankLoan = {
      sourceAccountNumber: accountNumber,
      loanAccountNumber: loan.LoanAccount,
      name: loan.LoanName,
      currency: loan.LoanCurrency,
      originalAmount: loan.LoanAmount,
      principalBalance: loan.PrincipalBalance,
      accruedInterest: loan.InterestBalance,
      outstandingBalance: loan.LoanBalance,
      payoffEstimate: loan.TotalLoanBalance,
      prepaymentPenaltyFee: loan.PrepaymentPenaltyFee,
      interestRate: loan.TotalInterestRate,
      effectiveInterestRate: loan.EffectiveInterstRate,
      baseInterestRate: loan.BaseInterestRate,
      interestSpread: loan.EarningsRate,
      monthlyPayment: loan.NextPayment,
      paymentsTotal: parsePaymentCount(loan.NumOfPayments),
      paymentsMade: parsePaymentCount(loan.NumOfPaymentsMade),
      paymentsRemaining: parsePaymentCount(loan.NumOfPaymentsRemained),
      nextPaymentDate: parseLoanDate(loan.NextPaymentDate),
      endDate: parseLoanDate(loan.LastPaymentDate),
    };

    if (options.includeRawLoan) {
      result.rawLoan = loan;
    }

    return result;
  });
}

function parsePaymentCount(value?: string): number | undefined {
  if (!value || !/^\d+$/.test(value)) {
    return undefined;
  }

  const count = Number(value);
  return Number.isSafeInteger(count) ? count : undefined;
}

function parseLoanDate(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const date = moment(value, DATE_FORMAT, true);

  return date.isValid() ? date.format('YYYY-MM-DD') : undefined;
}

async function fetchLoansData(
  page: Page,
  accountNumbers: string[],
  options: ScraperOptions,
): Promise<{ loans: BankLoan[]; failedAccounts: number }> {
  const loans: BankLoan[] = [];
  let failedAccounts = 0;

  for (const accountNumber of accountNumbers) {
    try {
      const url = `${BASE_URL}/Titan/gatewayAPI/onlineLoans/loansQuery/${encodeURIComponent(accountNumber)}`;

      const response = await fetchGetWithinPage<DiscountLoansResponse>(page, url);

      const details = response?.LoansQuery?.LoanDetailsBlock;

      if (!details) {
        throw new Error('Invalid Discount loans response');
      }

      const rawEntries = details.LoanEntry ?? [];
      const entries = Array.isArray(rawEntries) ? rawEntries : [rawEntries];

      if (entries.some(loan => typeof loan?.LoanAccount !== 'string' || !loan.LoanAccount.trim())) {
        throw new Error('Invalid Discount loan entry');
      }

      loans.push(...convertLoans(entries, accountNumber, options));
    } catch {
      // Preserve successfully retrieved loans from other accounts.
      // Do not expose sensitive bank data in errors.
      failedAccounts++;
    }
  }

  return { loans, failedAccounts };
}

async function fetchAccountData(page: Page, options: ScraperOptions): Promise<ScraperScrapingResult> {
  const apiSiteUrl = `${BASE_URL}/Titan/gatewayAPI`;

  const accountDataUrl = `${apiSiteUrl}/userAccountsData`;
  const accountInfo = await fetchGetWithinPage<ScrapedAccountData>(page, accountDataUrl);

  if (!accountInfo) {
    return {
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: 'failed to get account data',
    };
  }

  const defaultStartMoment = moment().subtract(1, 'years').add(2, 'day');
  const startDate = options.startDate || defaultStartMoment.toDate();
  const startMoment = moment.max(defaultStartMoment, moment(startDate));

  const startDateStr = startMoment.format(DATE_FORMAT);

  const accounts: string[] = accountInfo.UserAccountsData.UserAccounts.map(acc => acc.NewAccountInfo.AccountID);
  const accountsData: Array<{ accountNumber: string; balance: number; txns: Transaction[] }> = [];

  for (const accountNumber of accounts) {
    const txnsUrl = `${apiSiteUrl}/lastTransactions/${accountNumber}/Date?IsCategoryDescCode=True&IsTransactionDetails=True&IsEventNames=True&IsFutureTransactionFlag=True&FromDate=${startDateStr}`;
    const txnsResult = await fetchGetWithinPage<ScrapedTransactionData>(page, txnsUrl);
    if (!txnsResult || txnsResult.Error || !txnsResult.CurrentAccountLastTransactions) {
      return {
        success: false,
        errorType: ScraperErrorTypes.Generic,
        errorMessage: txnsResult && txnsResult.Error ? txnsResult.Error.MsgText : 'unknown error',
      };
    }

    const accountCompletedTxns = convertTransactions(
      txnsResult.CurrentAccountLastTransactions.OperationEntry,
      TransactionStatuses.Completed,
      options,
    );
    const rawFutureTxns =
      txnsResult.CurrentAccountLastTransactions.FutureTransactionsBlock?.FutureTransactionEntry ?? [];
    const accountPendingTxns = convertTransactions(rawFutureTxns, TransactionStatuses.Pending, options);

    accountsData.push({
      accountNumber,
      balance: txnsResult.CurrentAccountLastTransactions.CurrentAccountInfo.AccountBalance,
      txns: [...accountCompletedTxns, ...accountPendingTxns],
    });
  }

  const accountData: ScraperScrapingResult = {
    success: true,
    accounts: accountsData,
  };

  if (options.includeLoans && options.companyId === CompanyTypes.discount) {
    const { loans, failedAccounts } = await fetchLoansData(page, accounts, options);

    accountData.loans = loans;

    if (failedAccounts > 0) {
      accountData.loansError = `Could not retrieve loans for ${failedAccounts} account(s)`;
    }
  }

  return accountData;
}

async function navigateOrErrorLabel(page: Page) {
  try {
    await waitForNavigation(page);
  } catch (e) {
    await waitUntilElementFound(page, '#general-error', false, 100);
  }
}

function getPossibleLoginResults(): PossibleLoginResults {
  const urls: PossibleLoginResults = {};
  urls[LoginResults.Success] = [
    `${BASE_URL}/apollo/retail/#/MY_ACCOUNT_HOMEPAGE`,
    `${BASE_URL}/apollo/retail2/#/MY_ACCOUNT_HOMEPAGE`,
    `${BASE_URL}/apollo/retail2/`,
    `${BASE_URL}/apollo/retail3/#/MY_ACCOUNT_HOMEPAGE`,
    `${BASE_URL}/apollo/retail3/`,
  ];
  urls[LoginResults.InvalidPassword] = [`${BASE_URL}/apollo/core/templates/lobby/masterPage.html#/LOGIN_PAGE`];
  urls[LoginResults.ChangePassword] = [`${BASE_URL}/apollo/core/templates/lobby/masterPage.html#/PWD_RENEW`];
  return urls;
}

function createLoginFields(credentials: ScraperSpecificCredentials) {
  return [
    { selector: '#tzId', value: credentials.id },
    { selector: '#tzPassword', value: credentials.password },
    { selector: '#aidnum', value: credentials.num },
  ];
}

type ScraperSpecificCredentials = { id: string; password: string; num: string };

class DiscountScraper extends BaseScraperWithBrowser<ScraperSpecificCredentials> {
  getLoginOptions(credentials: ScraperSpecificCredentials) {
    return {
      loginUrl: `${BASE_URL}/login/#/LOGIN_PAGE`,
      checkReadiness: async () => waitUntilElementFound(this.page, '#tzId'),
      fields: createLoginFields(credentials),
      submitButtonSelector: '.sendBtn',
      postAction: async () => navigateOrErrorLabel(this.page),
      possibleResults: getPossibleLoginResults(),
    };
  }

  async fetchData() {
    return fetchAccountData(this.page, this.options);
  }
}

export default DiscountScraper;
