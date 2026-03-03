import moment from 'moment';
import { type Page } from 'playwright';

import { fetchGetWithinPage } from '../../Common/Fetch';
import { getRawTransaction } from '../../Common/Transactions';
import { CompanyTypes } from '../../Definitions';
import { type Transaction, TransactionStatuses, TransactionTypes } from '../../Transactions';
import { ScraperErrorTypes } from '../Base/Errors';
import { GenericBankScraper } from '../Base/GenericBankScraper';
import { type ScraperOptions, type ScraperScrapingResult } from '../Base/Interface';
import { type LoginConfig } from '../Base/LoginConfig';
import { SCRAPER_CONFIGURATION } from '../Registry/ScraperConfig';
import { discountConfig } from './DiscountLoginConfig';

const CFG = SCRAPER_CONFIGURATION.banks[CompanyTypes.Discount];

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
    UserAccounts: {
      NewAccountInfo: {
        AccountID: string;
      };
    }[];
  };
}

interface ScrapedTransactionData {
  Error?: { MsgText: string };
  CurrentAccountLastTransactions?: {
    OperationEntry: ScrapedTransaction[] | null;
    CurrentAccountInfo: CurrentAccountInfo;
    FutureTransactionsBlock: {
      FutureTransactionEntry: ScrapedTransaction[] | null;
    };
  };
}

function convertOneTxn(
  txn: ScrapedTransaction,
  txnStatus: TransactionStatuses,
  options?: ScraperOptions,
): Transaction {
  const result: Transaction = {
    type: TransactionTypes.Normal,
    identifier: txn.OperationNumber,
    date: moment(txn.OperationDate, CFG.format.date).toISOString(),
    processedDate: moment(txn.ValueDate, CFG.format.date).toISOString(),
    originalAmount: txn.OperationAmount,
    originalCurrency: 'ILS',
    chargedAmount: txn.OperationAmount,
    description: txn.OperationDescriptionToDisplay,
    status: txnStatus,
  };
  if (options?.includeRawTransaction) result.rawTransaction = getRawTransaction(txn);
  return result;
}

function convertTransactions(
  txns: ScrapedTransaction[],
  txnStatus: TransactionStatuses,
  options?: ScraperOptions,
): Transaction[] {
  return txns.map(txn => convertOneTxn(txn, txnStatus, options));
}

interface FetchOneAccOpts {
  page: Page;
  apiSiteUrl: string;
  accountNumber: string;
  startDateStr: string;
  options: ScraperOptions;
}

function getPendingTxns(
  txnsResult: ScrapedTransactionData,
  options: ScraperOptions,
): Transaction[] {
  const rawFutureTxns: ScrapedTransaction[] | null | undefined =
    txnsResult.CurrentAccountLastTransactions?.FutureTransactionsBlock.FutureTransactionEntry;
  if (!rawFutureTxns) return [];
  return convertTransactions(rawFutureTxns, TransactionStatuses.Pending, options);
}

function buildOneAccountResult(
  txnsResult: ScrapedTransactionData,
  accountNumber: string,
  options: ScraperOptions,
): { accountNumber: string; balance: number; txns: Transaction[] } {
  const data = txnsResult.CurrentAccountLastTransactions!;
  const completedTxns = data.OperationEntry
    ? convertTransactions(data.OperationEntry, TransactionStatuses.Completed, options)
    : [];
  return {
    accountNumber,
    balance: data.CurrentAccountInfo.AccountBalance,
    txns: [...completedTxns, ...getPendingTxns(txnsResult, options)],
  };
}

async function fetchOneAccount(
  opts: FetchOneAccOpts,
): Promise<{ error: string } | { accountNumber: string; balance: number; txns: Transaction[] }> {
  const { page, apiSiteUrl, accountNumber, startDateStr, options } = opts;
  const txnsUrl = `${apiSiteUrl}/lastTransactions/${accountNumber}/Date?IsCategoryDescCode=True&IsTransactionDetails=True&IsEventNames=True&IsFutureTransactionFlag=True&FromDate=${startDateStr}`;
  const txnsResult = await fetchGetWithinPage<ScrapedTransactionData>(page, txnsUrl);
  if (!txnsResult || txnsResult.Error) {
    return { error: txnsResult?.Error?.MsgText ?? 'unknown error' };
  }
  if (!txnsResult.CurrentAccountLastTransactions) {
    return { accountNumber, balance: 0, txns: [] };
  }
  return buildOneAccountResult(txnsResult, accountNumber, options);
}

function buildStartDateStr(options: ScraperOptions): string {
  const defaultStartMoment = moment().subtract(1, 'years').add(2, 'day');
  const startMoment = moment.max(defaultStartMoment, moment(options.startDate));
  return startMoment.format(CFG.format.date);
}

interface FetchAllAccountsOpts {
  page: Page;
  apiSiteUrl: string;
  accountNumbers: string[];
  startDateStr: string;
  options: ScraperOptions;
}

async function fetchAllAccounts(opts: FetchAllAccountsOpts): Promise<ScraperScrapingResult> {
  const { page, apiSiteUrl, accountNumbers, startDateStr, options } = opts;
  const accountsData = [];
  for (const accountNumber of accountNumbers) {
    const result = await fetchOneAccount({
      page,
      apiSiteUrl,
      accountNumber,
      startDateStr,
      options,
    });
    if ('error' in result)
      return { success: false, errorType: ScraperErrorTypes.Generic, errorMessage: result.error };
    accountsData.push(result);
  }
  return { success: true, accounts: accountsData };
}

interface FetchAccountDataOpts {
  page: Page;
  apiSiteUrl: string;
  accountInfo: ScrapedAccountData;
  options: ScraperOptions;
}

function buildAccountsOpts(opts: FetchAccountDataOpts): FetchAllAccountsOpts {
  const { page, apiSiteUrl, accountInfo, options } = opts;
  const startDateStr = buildStartDateStr(options);
  const accountNumbers = accountInfo.UserAccountsData.UserAccounts.map(
    acc => acc.NewAccountInfo.AccountID,
  );
  return { page, apiSiteUrl, accountNumbers, startDateStr, options };
}

async function fetchAccountData(
  page: Page,
  options: ScraperOptions,
): Promise<ScraperScrapingResult> {
  const apiSiteUrl = `${CFG.api.base}/Titan/gatewayAPI`;
  const accountInfo = await fetchGetWithinPage<ScrapedAccountData>(
    page,
    `${apiSiteUrl}/userAccountsData`,
  );
  if (!accountInfo)
    return {
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: 'failed to get account data',
    };
  return fetchAllAccounts(buildAccountsOpts({ page, apiSiteUrl, accountInfo, options }));
}

interface ScraperSpecificCredentials {
  id: string;
  password: string;
  num: string;
}

class DiscountScraper extends GenericBankScraper<ScraperSpecificCredentials> {
  constructor(
    options: ScraperOptions,
    config: LoginConfig = discountConfig(
      SCRAPER_CONFIGURATION.banks[CompanyTypes.Discount].urls.base,
    ),
  ) {
    super(options, config);
  }

  public async fetchData(): Promise<ScraperScrapingResult> {
    return fetchAccountData(this.page, this.options);
  }
}

export default DiscountScraper;
