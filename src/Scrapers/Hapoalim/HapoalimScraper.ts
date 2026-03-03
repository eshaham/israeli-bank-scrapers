import moment from 'moment';
import { type Page } from 'playwright';
import { v4 as uuid4 } from 'uuid';

import { getDebug } from '../../Common/Debug';
import { fetchGetWithinPage, fetchPostWithinPage } from '../../Common/Fetch';
import {} from '../../Common/Navigation';
import { getRawTransaction } from '../../Common/Transactions';
import { waitUntil } from '../../Common/Waiting';
import { CompanyTypes } from '../../Definitions';
import { type Transaction, TransactionStatuses, TransactionTypes } from '../../Transactions';
import { GenericBankScraper } from '../Base/GenericBankScraper';
import { type ScraperOptions } from '../Base/Interface';
import { SCRAPER_CONFIGURATION } from '../Registry/ScraperConfig';
import { HAPOALIM_CONFIG } from './HapoalimLoginConfig';

const LOG = getDebug('hapoalim');

const CFG = SCRAPER_CONFIGURATION.banks[CompanyTypes.Hapoalim];

// eslint-disable-next-line @typescript-eslint/no-namespace
declare namespace window {
  const bnhpApp: { restContext: string };
}

interface ScrapedTransaction {
  serialNumber?: number;
  activityDescription?: string;
  eventAmount: number;
  valueDate?: string;
  eventDate?: string;
  referenceNumber?: number;
  ScrapedTransaction?: string;
  eventActivityTypeCode: number;
  currentBalance: number;
  pfmDetails: string;
  beneficiaryDetailsData?: {
    partyHeadline?: string;
    partyName?: string;
    messageHeadline?: string;
    messageDetail?: string;
  };
  additionalInformation?: unknown;
}

interface ScrapedPfmTransaction {
  transactionNumber: number;
}

type FetchedAccountData = {
  bankNumber: string;
  accountNumber: string;
  branchNumber: string;
  accountClosingReasonCode: number;
}[];

interface FetchedAccountTransactionsData {
  transactions: ScrapedTransaction[];
}

interface BalanceAndCreditLimit {
  creditLimitAmount: number;
  creditLimitDescription: string;
  creditLimitUtilizationAmount: number;
  creditLimitUtilizationExistanceCode: number;
  creditLimitUtilizationPercent: number;
  currentAccountLimitsAmount: number;
  currentBalance: number;
  withdrawalBalance: number;
}

function buildMemo(txn: ScrapedTransaction): string {
  if (!txn.beneficiaryDetailsData) return '';
  const { partyHeadline, partyName, messageHeadline, messageDetail } = txn.beneficiaryDetailsData;
  const memoLines: string[] = [];
  if (partyHeadline) memoLines.push(partyHeadline);
  if (partyName) memoLines.push(`${partyName}.`);
  if (messageHeadline) memoLines.push(messageHeadline);
  if (messageDetail) memoLines.push(`${messageDetail}.`);
  return memoLines.join(' ');
}

function convertOneTxn(txn: ScrapedTransaction, options?: ScraperOptions): Transaction {
  const isOutbound = txn.eventActivityTypeCode === 2;
  const amount = isOutbound ? -txn.eventAmount : txn.eventAmount;
  const result: Transaction = {
    type: TransactionTypes.Normal,
    identifier: txn.referenceNumber,
    date: moment(txn.eventDate, CFG.format.date).toISOString(),
    processedDate: moment(txn.valueDate, CFG.format.date).toISOString(),
    originalAmount: amount,
    originalCurrency: 'ILS',
    chargedAmount: amount,
    description: txn.activityDescription ?? '',
    status: txn.serialNumber === 0 ? TransactionStatuses.Pending : TransactionStatuses.Completed,
    memo: buildMemo(txn),
  };
  if (options?.includeRawTransaction) result.rawTransaction = getRawTransaction(txn);
  return result;
}

function convertTransactions(txns: ScrapedTransaction[], options?: ScraperOptions): Transaction[] {
  return txns.map(txn => convertOneTxn(txn, options));
}

async function getRestContext(page: Page): Promise<string> {
  await waitUntil(() => {
    return page.evaluate(() => !!window.bnhpApp);
  }, 'waiting for app data load');

  const result = await page.evaluate(() => {
    return window.bnhpApp.restContext;
  });

  return result.slice(1);
}

async function fetchPoalimXSRFWithinPage(
  page: Page,
  url: string,
  pageUuid: string,
): Promise<FetchedAccountTransactionsData | null> {
  const cookies = await page.context().cookies();
  const xsrfCookie = cookies.find(cookie => cookie.name === 'XSRF-TOKEN');
  const headers: Record<string, string> = {};
  if (xsrfCookie != null) {
    headers['X-XSRF-TOKEN'] = xsrfCookie.value;
  }
  headers.pageUuid = pageUuid;
  headers.uuid = uuid4();
  headers['Content-Type'] = 'application/json;charset=UTF-8';
  return fetchPostWithinPage<FetchedAccountTransactionsData>(page, url, {
    data: [],
    extraHeaders: headers,
  });
}

interface ExtraScrapOpts {
  txnsResult: FetchedAccountTransactionsData;
  baseUrl: string;
  page: Page;
  accountNumber: string;
}

interface EnrichTxnOpts {
  transaction: ScrapedTransaction;
  baseUrl: string;
  page: Page;
  accountNumber: string;
}

async function enrichOneTxn(opts: EnrichTxnOpts): Promise<ScrapedTransaction> {
  const { transaction, baseUrl, page, accountNumber } = opts;
  const { pfmDetails, serialNumber } = transaction;
  if (serialNumber === 0) return transaction;
  const url = `${baseUrl}${pfmDetails}&accountId=${accountNumber}&lang=${CFG.format.apiLang}`;
  const extraDetails = (await fetchGetWithinPage<ScrapedPfmTransaction[]>(page, url)) ?? [];
  if (extraDetails.length && extraDetails[0].transactionNumber) {
    return {
      ...transaction,
      referenceNumber: extraDetails[0].transactionNumber,
      additionalInformation: extraDetails,
    };
  }
  return transaction;
}

async function getExtraScrap(opts: ExtraScrapOpts): Promise<FetchedAccountTransactionsData> {
  const { txnsResult, baseUrl, page, accountNumber } = opts;
  const res = await Promise.all(
    txnsResult.transactions.map(t =>
      enrichOneTxn({ transaction: t, baseUrl, page, accountNumber }),
    ),
  );
  return { transactions: res };
}

interface GetAccountTxnsOpts {
  baseUrl: string;
  apiSiteUrl: string;
  page: Page;
  accountNumber: string;
  startDate: string;
  endDate: string;
  shouldAddTransactionInformation?: boolean;
  options?: ScraperOptions;
}

async function enrichTxnsIfNeeded(
  txnsResult: FetchedAccountTransactionsData | null,
  opts: GetAccountTxnsOpts,
): Promise<FetchedAccountTransactionsData | null> {
  const { shouldAddTransactionInformation = false, baseUrl, page, accountNumber } = opts;
  if (shouldAddTransactionInformation && txnsResult?.transactions.length)
    return getExtraScrap({ txnsResult, baseUrl, page, accountNumber });
  return txnsResult;
}

async function getAccountTransactions(opts: GetAccountTxnsOpts): Promise<Transaction[]> {
  const { apiSiteUrl, accountNumber, startDate, endDate, page, options } = opts;
  const txnsUrl = `${apiSiteUrl}/current-account/transactions?accountId=${accountNumber}&numItemsPerPage=${CFG.format.numItemsPerPage}&retrievalEndDate=${endDate}&retrievalStartDate=${startDate}&sortCode=${CFG.format.sortCode}`;
  const txnsResult = await fetchPoalimXSRFWithinPage(
    page,
    txnsUrl,
    '/current-account/transactions',
  );
  const finalResult = await enrichTxnsIfNeeded(txnsResult, opts);
  return convertTransactions(finalResult?.transactions ?? [], options);
}

async function getAccountBalance(
  apiSiteUrl: string,
  page: Page,
  accountNumber: string,
): Promise<number | undefined> {
  const balanceAndCreditLimitUrl = `${apiSiteUrl}/current-account/composite/balanceAndCreditLimit?accountId=${accountNumber}&view=details&lang=${CFG.format.apiLang}`;
  const balanceAndCreditLimit = await fetchGetWithinPage<BalanceAndCreditLimit>(
    page,
    balanceAndCreditLimitUrl,
  );

  return balanceAndCreditLimit?.currentBalance;
}

interface FetchOneAccountOpts {
  page: Page;
  baseUrl: string;
  apiSiteUrl: string;
  account: FetchedAccountData[0];
  dateOpts: { startDateStr: string; endDateStr: string };
  options: ScraperOptions;
}

async function fetchOneAccount(
  opts: FetchOneAccountOpts,
): Promise<{ accountNumber: string; balance: number | undefined; txns: Transaction[] }> {
  const { page, baseUrl, apiSiteUrl, account, dateOpts, options } = opts;
  const accountNumber = `${account.bankNumber}-${account.branchNumber}-${account.accountNumber}`;
  LOG.info('getting information for account %s', accountNumber);
  const balance = await getAccountBalance(apiSiteUrl, page, accountNumber);
  const txns = await getAccountTransactions({
    baseUrl,
    apiSiteUrl,
    page,
    accountNumber,
    startDate: dateOpts.startDateStr,
    endDate: dateOpts.endDateStr,
    shouldAddTransactionInformation: options.shouldAddTransactionInformation,
    options,
  });
  return { accountNumber, balance, txns };
}

async function fetchOpenAccounts(page: Page, baseUrl: string): Promise<FetchedAccountData> {
  const accountsInfo =
    (await fetchGetWithinPage<FetchedAccountData>(
      page,
      `${baseUrl}/ServerServices/general/accounts`,
    )) ?? [];
  const openAccountsInfo = accountsInfo.filter(account => account.accountClosingReasonCode === 0);
  LOG.info(
    'got %d open accounts from %d total accounts, fetching txns and balance',
    openAccountsInfo.length,
    accountsInfo.length,
  );
  return openAccountsInfo;
}

function buildDateOpts(options: ScraperOptions): { startDateStr: string; endDateStr: string } {
  const defaultStartMoment = moment().subtract(1, 'years').add(1, 'day');
  const startMoment = moment.max(defaultStartMoment, moment(options.startDate));
  return {
    startDateStr: startMoment.format(CFG.format.date),
    endDateStr: moment().format(CFG.format.date),
  };
}

async function fetchAccountData(
  page: Page,
  baseUrl: string,
  options: ScraperOptions,
): Promise<{
  success: boolean;
  accounts: { accountNumber: string; balance: number | undefined; txns: Transaction[] }[];
}> {
  const restContext = await getRestContext(page);
  const apiSiteUrl = `${baseUrl}/${restContext}`;
  const openAccountsInfo = await fetchOpenAccounts(page, baseUrl);
  const dateOpts = buildDateOpts(options);
  const accounts = await Promise.all(
    openAccountsInfo.map(acc =>
      fetchOneAccount({ page, baseUrl, apiSiteUrl, account: acc, dateOpts, options }),
    ),
  );
  LOG.info('fetching ended');
  return { success: true, accounts };
}

interface ScraperSpecificCredentials {
  userCode: string;
  password: string;
}

class HapoalimScraper extends GenericBankScraper<ScraperSpecificCredentials> {
  constructor(options: ScraperOptions) {
    super(options, HAPOALIM_CONFIG);
  }

  public async fetchData(): Promise<{
    success: boolean;
    accounts: { accountNumber: string; balance: number | undefined; txns: Transaction[] }[];
  }> {
    return fetchAccountData(this.page, CFG.api.base, this.options);
  }
}

export default HapoalimScraper;
