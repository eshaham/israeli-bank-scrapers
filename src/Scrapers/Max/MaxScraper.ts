import moment, { type Moment } from 'moment';
import { type Page } from 'playwright';

import getAllMonthMoments from '../../Common/Dates';
import { getDebug } from '../../Common/Debug';
import { fetchGetWithinPage } from '../../Common/Fetch';
import {
  filterOldTransactions,
  fixInstallments,
  getRawTransaction,
  sortTransactionsByDate,
} from '../../Common/Transactions';
import { DOLLAR_CURRENCY, EURO_CURRENCY, SHEKEL_CURRENCY } from '../../Constants';
import { CompanyTypes } from '../../Definitions';
import { type Transaction, TransactionStatuses, TransactionTypes } from '../../Transactions';
import { GenericBankScraper } from '../Base/GenericBankScraper';
import { type ScraperOptions } from '../Base/Interface';
import { SCRAPER_CONFIGURATION } from '../Registry/ScraperConfig';
import { MAX_CONFIG } from './MaxLoginConfig';

const LOG = getDebug('max');

export type { ScrapedTransaction } from './MaxTypes';
import { MaxPlanName, type ScrapedTransaction } from './MaxTypes';

const BASE_API_ACTIONS_URL = SCRAPER_CONFIGURATION.banks[CompanyTypes.Max].api.base;

const CATEGORIES = new Map<number, string>();

function getTransactionsUrl(monthMoment: Moment): string {
  const month = monthMoment.month() + 1;
  const year = monthMoment.year();
  const date = `${year}-${month}-01`;

  /**
   * url explanation:
   * userIndex: -1 for all account owners
   * cardIndex: -1 for all cards under the account
   * all other query params are static, beside the date which changes for request per month
   */
  const url = new URL(
    `${BASE_API_ACTIONS_URL}/api/registered/transactionDetails/getTransactionsAndGraphs`,
  );
  url.searchParams.set(
    'filterData',
    `{"userIndex":-1,"cardIndex":-1,"monthView":true,"date":"${date}","dates":{"startDate":"0","endDate":"0"},"bankAccount":{"bankAccountIndex":-1,"cards":null}}`,
  );
  url.searchParams.set('firstCallCardIndex', '-1');
  return url.toString();
}

interface FetchCategoryResult {
  result?: {
    id: number;
    name: string;
  }[];
}

async function loadCategories(page: Page): Promise<void> {
  LOG.info('Loading categories');
  const res = await fetchGetWithinPage<FetchCategoryResult>(
    page,
    `${BASE_API_ACTIONS_URL}/api/contents/getCategories`,
  );
  if (res && Array.isArray(res.result)) {
    LOG.info(`${res.result.length} categories loaded`);
    res.result.forEach(({ id, name }) => CATEGORIES.set(id, name));
  }
}

const PLAN_TYPE_MAP: Partial<Record<MaxPlanName, TransactionTypes>> = {
  [MaxPlanName.ImmediateCharge]: TransactionTypes.Normal,
  [MaxPlanName.Normal]: TransactionTypes.Normal,
  [MaxPlanName.MonthlyCharge]: TransactionTypes.Normal,
  [MaxPlanName.OneMonthPostponed]: TransactionTypes.Normal,
  [MaxPlanName.MonthlyPostponed]: TransactionTypes.Normal,
  [MaxPlanName.FuturePurchaseFinancing]: TransactionTypes.Normal,
  [MaxPlanName.MonthlyPayment]: TransactionTypes.Normal,
  [MaxPlanName.MonthlyPostponedInstallments]: TransactionTypes.Normal,
  [MaxPlanName.ThirtyDaysPlus]: TransactionTypes.Normal,
  [MaxPlanName.TwoMonthsPostponed]: TransactionTypes.Normal,
  [MaxPlanName.TwoMonthsPostponed2]: TransactionTypes.Normal,
  [MaxPlanName.AccumulatingBasket]: TransactionTypes.Normal,
  [MaxPlanName.InternetShopping]: TransactionTypes.Normal,
  [MaxPlanName.MonthlyChargePlusInterest]: TransactionTypes.Normal,
  [MaxPlanName.PostponedTransactionInstallments]: TransactionTypes.Normal,
  [MaxPlanName.ReplacementCard]: TransactionTypes.Normal,
  [MaxPlanName.EarlyRepayment]: TransactionTypes.Normal,
  [MaxPlanName.MonthlyCardFee]: TransactionTypes.Normal,
  [MaxPlanName.CurrencyPocket]: TransactionTypes.Normal,
  [MaxPlanName.MonthlyChargeDistribution]: TransactionTypes.Normal,
  [MaxPlanName.Installments]: TransactionTypes.Installments,
  [MaxPlanName.Credit]: TransactionTypes.Installments,
  [MaxPlanName.CreditOutsideTheLimit]: TransactionTypes.Installments,
};

const PLAN_ID_MAP: Record<number, TransactionTypes> = {
  2: TransactionTypes.Installments,
  3: TransactionTypes.Installments,
  5: TransactionTypes.Normal,
};

function getTransactionType(planName: string, planTypeId: number): TransactionTypes {
  const cleanedUpTxnTypeStr = planName.replaceAll('\t', ' ').trim() as MaxPlanName;
  const byName = PLAN_TYPE_MAP[cleanedUpTxnTypeStr];
  if (byName !== undefined) return byName;
  const byId = PLAN_ID_MAP[planTypeId];
  return byId;
}

function getInstallmentsInfo(comments: string): { number: number; total: number } | undefined {
  if (!comments) {
    return undefined;
  }
  const matches = comments.match(/\d+/g);
  if (!matches || matches.length < 2) {
    return undefined;
  }

  return {
    number: parseInt(matches[0], 10),
    total: parseInt(matches[1], 10),
  };
}

function getChargedCurrency(currencyId: number | null): string | undefined {
  switch (currencyId) {
    case 376:
      return SHEKEL_CURRENCY;
    case 840:
      return DOLLAR_CURRENCY;
    case 978:
      return EURO_CURRENCY;
    default:
      return undefined;
  }
}

export function getMemo({
  comments,
  fundsTransferReceiverOrTransfer,
  fundsTransferComment,
}: Pick<
  ScrapedTransaction,
  'comments' | 'fundsTransferReceiverOrTransfer' | 'fundsTransferComment'
>): string {
  if (fundsTransferReceiverOrTransfer) {
    const memo = comments
      ? `${comments} ${fundsTransferReceiverOrTransfer}`
      : fundsTransferReceiverOrTransfer;
    return fundsTransferComment ? `${memo}: ${fundsTransferComment}` : memo;
  }

  return comments;
}

function getTxnIdentifier(
  rawTransaction: ScrapedTransaction,
  installments: ReturnType<typeof getInstallmentsInfo>,
): string | undefined {
  return installments
    ? `${rawTransaction.dealData?.arn}_${installments.number}`
    : rawTransaction.dealData?.arn;
}

function buildTxnDates(raw: ScrapedTransaction): { date: string; processedDate: string } {
  const isPending = raw.paymentDate === null;
  return {
    date: moment(raw.purchaseDate).toISOString(),
    processedDate: moment(isPending ? raw.purchaseDate : raw.paymentDate).toISOString(),
  };
}

function buildTxnBase(rawTransaction: ScrapedTransaction): Omit<Transaction, 'rawTransaction'> {
  const isPending = rawTransaction.paymentDate === null;
  const installments = getInstallmentsInfo(rawTransaction.comments);
  return {
    type: getTransactionType(rawTransaction.planName, rawTransaction.planTypeId),
    ...buildTxnDates(rawTransaction),
    originalAmount: -rawTransaction.originalAmount,
    originalCurrency: rawTransaction.originalCurrency,
    chargedAmount: -rawTransaction.actualPaymentAmount,
    chargedCurrency: getChargedCurrency(rawTransaction.paymentCurrency),
    description: rawTransaction.merchantName.trim(),
    memo: getMemo(rawTransaction),
    category: CATEGORIES.get(rawTransaction.categoryId),
    installments,
    identifier: getTxnIdentifier(rawTransaction, installments),
    status: isPending ? TransactionStatuses.Pending : TransactionStatuses.Completed,
  };
}

function mapTransaction(rawTransaction: ScrapedTransaction, options?: ScraperOptions): Transaction {
  const result: Transaction = buildTxnBase(rawTransaction);
  if (options?.includeRawTransaction) result.rawTransaction = getRawTransaction(rawTransaction);
  return result;
}
interface ScrapedTransactionsResult {
  result?: {
    transactions: ScrapedTransaction[];
  };
}

async function fetchTransactionsForMonth(
  page: Page,
  monthMoment: Moment,
  options?: ScraperOptions,
): Promise<Record<string, Transaction[]>> {
  const url = getTransactionsUrl(monthMoment);

  const data = await fetchGetWithinPage<ScrapedTransactionsResult>(page, url);
  const transactionsByAccount: Record<string, Transaction[]> = {};

  if (!data?.result) return transactionsByAccount;

  data.result.transactions
    // Filter out non-transactions without a plan type, e.g. summary rows
    .filter(transaction => !!transaction.planName)
    .forEach((transaction: ScrapedTransaction) => {
      const mappedTransaction = mapTransaction(transaction, options);
      (transactionsByAccount[transaction.shortCardNumber] ??= []).push(mappedTransaction);
    });

  return transactionsByAccount;
}

function addResult(
  allResults: Record<string, Transaction[]>,
  result: Record<string, Transaction[]>,
): Record<string, Transaction[]> {
  const clonedResults: Record<string, Transaction[]> = { ...allResults };
  Object.keys(result).forEach(accountNumber => {
    (clonedResults[accountNumber] ??= []).push(...result[accountNumber]);
  });
  return clonedResults;
}

interface PrepareOpts {
  txns: Transaction[];
  startMoment: moment.Moment;
  shouldCombineInstallments: boolean;
  isFilterByDateEnabled: boolean;
}

function prepareTransactions(opts: PrepareOpts): Transaction[] {
  const { txns, startMoment, shouldCombineInstallments, isFilterByDateEnabled } = opts;
  let clonedTxns = Array.from(txns);
  if (!shouldCombineInstallments) clonedTxns = fixInstallments(clonedTxns);
  clonedTxns = sortTransactionsByDate(clonedTxns);
  return isFilterByDateEnabled
    ? filterOldTransactions(clonedTxns, startMoment, shouldCombineInstallments || false)
    : clonedTxns;
}

async function collectAllMonthResults(
  page: Page,
  allMonths: Moment[],
  options: ScraperOptions,
): Promise<Record<string, Transaction[]>> {
  let allResults: Record<string, Transaction[]> = {};
  for (const month of allMonths) {
    allResults = addResult(allResults, await fetchTransactionsForMonth(page, month, options));
  }
  return allResults;
}

function applyPrepareToAllAccounts(
  allResults: Record<string, Transaction[]>,
  startMoment: moment.Moment,
  options: ScraperOptions,
): void {
  const shouldCombineInstallments = options.shouldCombineInstallments ?? false;
  const isFilterByDateEnabled = options.outputData?.isFilterByDateEnabled ?? true;
  Object.keys(allResults).forEach(accountNumber => {
    allResults[accountNumber] = prepareTransactions({
      txns: allResults[accountNumber],
      startMoment,
      shouldCombineInstallments,
      isFilterByDateEnabled,
    });
  });
}

async function fetchTransactions(
  page: Page,
  options: ScraperOptions,
): Promise<Record<string, Transaction[]>> {
  const futureMonthsToScrape = options.futureMonthsToScrape ?? 1;
  const startMoment = moment.max(moment().subtract(4, 'years'), moment(options.startDate));
  const allMonths = getAllMonthMoments(startMoment, futureMonthsToScrape);
  await loadCategories(page);
  const allResults = await collectAllMonthResults(page, allMonths, options);
  applyPrepareToAllAccounts(allResults, startMoment, options);
  return allResults;
}

interface ScraperSpecificCredentials {
  username: string;
  password: string;
}

class MaxScraper extends GenericBankScraper<ScraperSpecificCredentials> {
  constructor(options: ScraperOptions) {
    super(options, MAX_CONFIG);
  }

  public async fetchData(): Promise<{
    success: boolean;
    accounts: { accountNumber: string; txns: Transaction[] }[];
  }> {
    const results = await fetchTransactions(this.page, this.options);
    const accounts = Object.keys(results).map(accountNumber => {
      return {
        accountNumber,
        txns: results[accountNumber],
      };
    });

    return {
      success: true,
      accounts,
    };
  }
}

export default MaxScraper;
