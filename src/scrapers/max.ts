import buildUrl from 'build-url';
// eslint-disable-next-line import/named
import moment, { Moment } from 'moment';
import { Page } from 'puppeteer';
import { DOLLAR_CURRENCY, EURO_CURRENCY, SHEKEL_CURRENCY } from '../constants';
import getAllMonthMoments from '../helpers/dates';
import { getDebug } from '../helpers/debug';
import { clickButton, elementPresentOnPage, waitUntilElementFound } from '../helpers/elements-interactions';
import { fetchGetWithinPage } from '../helpers/fetch';
import { waitForRedirect } from '../helpers/navigation';
import { filterOldTransactions, fixInstallments, sortTransactionsByDate } from '../helpers/transactions';
import { Transaction, TransactionStatuses, TransactionTypes } from '../transactions';
import {
  BaseScraperWithBrowser, LoginOptions, LoginResults, PossibleLoginResults,
} from './base-scraper-with-browser';
import { ScraperOptions } from './interface';

const debug = getDebug('max');

export interface ScrapedTransaction {
  shortCardNumber: string;
  paymentDate?: string;
  purchaseDate: string;
  actualPaymentAmount: string;
  paymentCurrency: number | null;
  originalCurrency: string;
  originalAmount: number;
  planName: string;
  planTypeId: number;
  comments: string;
  merchantName: string;
  categoryId: number;
  fundsTransferComment?: string;
  fundsTransferReceiverOrTransfer?: string;
  dealData?: {
    arn: string;
  };
}

const BASE_API_ACTIONS_URL = 'https://onlinelcapi.max.co.il';
const BASE_WELCOME_URL = 'https://www.max.co.il';

const LOGIN_URL = `${BASE_WELCOME_URL}/homepage/welcome`;
const PASSWORD_EXPIRED_URL = `${BASE_WELCOME_URL}/renew-password`;
const SUCCESS_URL = `${BASE_WELCOME_URL}/homepage/personal`;

enum MaxPlanName {
  Normal = 'רגילה',
  ImmediateCharge = 'חיוב עסקות מיידי',
  InternetShopping = 'אינטרנט/חו"ל',
  Installments = 'תשלומים',
  MonthlyCharge = 'חיוב חודשי',
  OneMonthPostponed = 'דחוי חודש',
  MonthlyPostponed = 'דחוי לחיוב החודשי',
  MonthlyPayment = 'תשלום חודשי',
  FuturePurchaseFinancing = 'מימון לרכישה עתידית',
  MonthlyPostponedInstallments = 'דחוי חודש תשלומים',
  ThirtyDaysPlus = 'עסקת 30 פלוס',
  TwoMonthsPostponed = 'דחוי חודשיים',
  TwoMonthsPostponed2 = 'דחוי 2 ח\' תשלומים',
  MonthlyChargePlusInterest = 'חודשי + ריבית',
  Credit = 'קרדיט',
  CreditOutsideTheLimit = 'קרדיט-מחוץ למסגרת',
  AccumulatingBasket = 'סל מצטבר',
  PostponedTransactionInstallments = 'פריסת העסקה הדחויה',
  ReplacementCard = 'כרטיס חליפי',
  EarlyRepayment = 'פרעון מוקדם',
  MonthlyCardFee = 'דמי כרטיס',
  CurrencyPocket = 'חיוב ארנק מטח',
}

const INVALID_DETAILS_SELECTOR = '#popupWrongDetails';
const LOGIN_ERROR_SELECTOR = '#popupCardHoldersLoginError';

const categories = new Map<number, string>();

function redirectOrDialog(page: Page) {
  return Promise.race([
    waitForRedirect(page, 20000, false, [BASE_WELCOME_URL, `${BASE_WELCOME_URL}/`]),
    waitUntilElementFound(page, INVALID_DETAILS_SELECTOR, true),
    waitUntilElementFound(page, LOGIN_ERROR_SELECTOR, true),
  ]);
}

function getTransactionsUrl(monthMoment: Moment) {
  const month = monthMoment.month() + 1;
  const year = monthMoment.year();
  const date = `${year}-${month}-01`;

  /**
     * url explanation:
     * userIndex: -1 for all account owners
     * cardIndex: -1 for all cards under the account
     * all other query params are static, beside the date which changes for request per month
     */
  return buildUrl(BASE_API_ACTIONS_URL, {
    path: `/api/registered/transactionDetails/getTransactionsAndGraphs?filterData={"userIndex":-1,"cardIndex":-1,"monthView":true,"date":"${date}","dates":{"startDate":"0","endDate":"0"},"bankAccount":{"bankAccountIndex":-1,"cards":null}}&firstCallCardIndex=-1`,
  });
}

interface FetchCategoryResult {
  result? : Array<{
    id: number;
    name: string;
  }>;
}

async function loadCategories(page: Page) {
  debug('Loading categories');
  const res = await fetchGetWithinPage<FetchCategoryResult>(page, `${BASE_API_ACTIONS_URL}/api/contents/getCategories`);
  if (res && Array.isArray(res.result)) {
    debug(`${res.result.length} categories loaded`);
    res.result?.forEach(({ id, name }) => categories.set(id, name));
  }
}

function getTransactionType(planName: string, planTypeId: number) {
  const cleanedUpTxnTypeStr = planName.replace('\t', ' ').trim() as MaxPlanName;
  switch (cleanedUpTxnTypeStr) {
    case MaxPlanName.ImmediateCharge:
    case MaxPlanName.Normal:
    case MaxPlanName.MonthlyCharge:
    case MaxPlanName.OneMonthPostponed:
    case MaxPlanName.MonthlyPostponed:
    case MaxPlanName.FuturePurchaseFinancing:
    case MaxPlanName.MonthlyPayment:
    case MaxPlanName.MonthlyPostponedInstallments:
    case MaxPlanName.ThirtyDaysPlus:
    case MaxPlanName.TwoMonthsPostponed:
    case MaxPlanName.TwoMonthsPostponed2:
    case MaxPlanName.AccumulatingBasket:
    case MaxPlanName.InternetShopping:
    case MaxPlanName.MonthlyChargePlusInterest:
    case MaxPlanName.PostponedTransactionInstallments:
    case MaxPlanName.ReplacementCard:
    case MaxPlanName.EarlyRepayment:
    case MaxPlanName.MonthlyCardFee:
    case MaxPlanName.CurrencyPocket:
      return TransactionTypes.Normal;
    case MaxPlanName.Installments:
    case MaxPlanName.Credit:
    case MaxPlanName.CreditOutsideTheLimit:
      return TransactionTypes.Installments;
    default:
      switch (planTypeId) {
        case 2:
        case 3:
          return TransactionTypes.Installments;
        case 5:
          return TransactionTypes.Normal;
        default:
          throw new Error(`Unknown transaction type ${cleanedUpTxnTypeStr as string}`);
      }
  }
}

function getInstallmentsInfo(comments: string) {
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

function getChargedCurrency(currencyId: number | null) {
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
  comments, fundsTransferReceiverOrTransfer, fundsTransferComment,
}: Pick<ScrapedTransaction, 'comments' | 'fundsTransferReceiverOrTransfer' | 'fundsTransferComment'>) {
  if (fundsTransferReceiverOrTransfer) {
    const memo = comments ? `${comments} ${fundsTransferReceiverOrTransfer}` : fundsTransferReceiverOrTransfer;
    return fundsTransferComment ? `${memo}: ${fundsTransferComment}` : memo;
  }

  return comments;
}

function mapTransaction(rawTransaction: ScrapedTransaction): Transaction {
  const isPending = rawTransaction.paymentDate === null;
  const processedDate = moment(isPending ?
    rawTransaction.purchaseDate :
    rawTransaction.paymentDate).toISOString();
  const status = isPending ? TransactionStatuses.Pending : TransactionStatuses.Completed;

  const installments = getInstallmentsInfo(rawTransaction.comments);
  const identifier = installments ?
    `${rawTransaction.dealData?.arn}_${installments.number}` :
    rawTransaction.dealData?.arn;

  return {
    type: getTransactionType(rawTransaction.planName, rawTransaction.planTypeId),
    date: moment(rawTransaction.purchaseDate).toISOString(),
    processedDate,
    originalAmount: -rawTransaction.originalAmount,
    originalCurrency: rawTransaction.originalCurrency,
    chargedAmount: -rawTransaction.actualPaymentAmount,
    chargedCurrency: getChargedCurrency(rawTransaction.paymentCurrency),
    description: rawTransaction.merchantName.trim(),
    memo: getMemo(rawTransaction),
    category: categories.get(rawTransaction?.categoryId),
    installments,
    identifier,
    status,
  };
}
interface ScrapedTransactionsResult {
  result?: {
    transactions: ScrapedTransaction[];
  };
}

async function fetchTransactionsForMonth(page: Page, monthMoment: Moment) {
  const url = getTransactionsUrl(monthMoment);

  const data = await fetchGetWithinPage<ScrapedTransactionsResult>(page, url);
  const transactionsByAccount: Record<string, Transaction[]> = {};

  if (!data || !data.result) return transactionsByAccount;

  data.result.transactions
    // Filter out non-transactions without a plan type, e.g. summary rows
    .filter((transaction) => !!transaction.planName)
    .forEach((transaction: ScrapedTransaction) => {
      if (!transactionsByAccount[transaction.shortCardNumber]) {
        transactionsByAccount[transaction.shortCardNumber] = [];
      }

      const mappedTransaction = mapTransaction(transaction);
      transactionsByAccount[transaction.shortCardNumber].push(mappedTransaction);
    });

  return transactionsByAccount;
}

function addResult(allResults: Record<string, Transaction[]>, result: Record<string, Transaction[]>) {
  const clonedResults: Record<string, Transaction[]> = { ...allResults };
  Object.keys(result).forEach((accountNumber) => {
    if (!clonedResults[accountNumber]) {
      clonedResults[accountNumber] = [];
    }
    clonedResults[accountNumber].push(...result[accountNumber]);
  });
  return clonedResults;
}

function prepareTransactions(txns: Transaction[], startMoment: moment.Moment, combineInstallments: boolean, enableTransactionsFilterByDate: boolean) {
  let clonedTxns = Array.from(txns);
  if (!combineInstallments) {
    clonedTxns = fixInstallments(clonedTxns);
  }
  clonedTxns = sortTransactionsByDate(clonedTxns);
  clonedTxns = enableTransactionsFilterByDate ?
    filterOldTransactions(clonedTxns, startMoment, combineInstallments || false) :
    clonedTxns;
  return clonedTxns;
}

async function fetchTransactions(page: Page, options: ScraperOptions) {
  const futureMonthsToScrape = options.futureMonthsToScrape ?? 1;
  const defaultStartMoment = moment().subtract(1, 'years');
  const startDate = options.startDate || defaultStartMoment.toDate();
  const startMoment = moment.max(defaultStartMoment, moment(startDate));
  const allMonths = getAllMonthMoments(startMoment, futureMonthsToScrape);

  await loadCategories(page);

  let allResults: Record<string, Transaction[]> = {};
  for (let i = 0; i < allMonths.length; i += 1) {
    const result = await fetchTransactionsForMonth(page, allMonths[i]);
    allResults = addResult(allResults, result);
  }

  Object.keys(allResults).forEach((accountNumber) => {
    let txns = allResults[accountNumber];
    txns = prepareTransactions(txns, startMoment, options.combineInstallments || false,
      (options.outputData?.enableTransactionsFilterByDate ?? true));
    allResults[accountNumber] = txns;
  });

  return allResults;
}

function getPossibleLoginResults(page: Page): PossibleLoginResults {
  const urls: PossibleLoginResults = {};
  urls[LoginResults.Success] = [SUCCESS_URL];
  urls[LoginResults.ChangePassword] = [PASSWORD_EXPIRED_URL];
  urls[LoginResults.InvalidPassword] = [async () => {
    return elementPresentOnPage(page, INVALID_DETAILS_SELECTOR);
  }];
  urls[LoginResults.UnknownError] = [async () => {
    return elementPresentOnPage(page, LOGIN_ERROR_SELECTOR);
  }];
  return urls;
}

function createLoginFields(credentials: ScraperSpecificCredentials) {
  return [
    { selector: '#user-name', value: credentials.username },
    { selector: '#password', value: credentials.password },
  ];
}

type ScraperSpecificCredentials = { username: string, password: string };

class MaxScraper extends BaseScraperWithBrowser<ScraperSpecificCredentials> {
  getLoginOptions(credentials: ScraperSpecificCredentials): LoginOptions {
    return {
      loginUrl: LOGIN_URL,
      fields: createLoginFields(credentials),
      submitButtonSelector: '#login-password #send-code',
      preAction: async () => {
        if (await elementPresentOnPage(this.page, '#closePopup')) {
          await clickButton(this.page, '#closePopup');
        }
        await clickButton(this.page, '.personal-area > a.go-to-personal-area');
        await waitUntilElementFound(this.page, '#login-password-link', true);
        await clickButton(this.page, '#login-password-link');
        await waitUntilElementFound(this.page, '#login-password.tab-pane.active app-user-login-form', true);
      },
      checkReadiness: async () => {
        await waitUntilElementFound(this.page, '.personal-area > a.go-to-personal-area', true);
      },
      postAction: async () => redirectOrDialog(this.page),
      possibleResults: getPossibleLoginResults(this.page),
      waitUntil: 'domcontentloaded',
    };
  }

  async fetchData() {
    const results = await fetchTransactions(this.page, this.options);
    const accounts = Object.keys(results).map((accountNumber) => {
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
