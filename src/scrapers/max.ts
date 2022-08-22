import buildUrl from 'build-url';
import moment, { Moment } from 'moment';
import { Page } from 'puppeteer';
import { fetchGetWithinPage } from '../helpers/fetch';
import { BaseScraperWithBrowser, LoginResults, PossibleLoginResults } from './base-scraper-with-browser';
import { waitForRedirect } from '../helpers/navigation';
import { waitUntilElementFound, elementPresentOnPage, clickButton } from '../helpers/elements-interactions';
import getAllMonthMoments from '../helpers/dates';
import { fixInstallments, sortTransactionsByDate, filterOldTransactions } from '../helpers/transactions';
import { Transaction, TransactionStatuses, TransactionTypes } from '../transactions';
import { ScraperOptions, ScraperCredentials } from './base-scraper';
import { getDebug } from '../helpers/debug';

const debug = getDebug('max');

interface ScrapedTransaction {
  shortCardNumber: string;
  paymentDate?: string;
  purchaseDate: string;
  actualPaymentAmount: string;
  originalCurrency: string;
  originalAmount: number;
  planName: string;
  comments: string;
  merchantName: string;
  categoryId: number;
  dealData?: {
    arn: string;
  };
}

const BASE_ACTIONS_URL = 'https://online.max.co.il';
const BASE_API_ACTIONS_URL = 'https://onlinelcapi.max.co.il';
const BASE_WELCOME_URL = 'https://www.max.co.il';

const LOGIN_URL = `${BASE_WELCOME_URL}/homepage/welcome`;
const PASSWORD_EXPIRED_URL = `${BASE_ACTIONS_URL}/Anonymous/Login/PasswordExpired.aspx`;
const SUCCESS_URL = `${BASE_WELCOME_URL}/homepage/personal`;

const NORMAL_TYPE_NAME = 'רגילה';
const ATM_TYPE_NAME = 'חיוב עסקות מיידי';
const INTERNET_SHOPPING_TYPE_NAME = 'אינטרנט/חו"ל';
const INSTALLMENTS_TYPE_NAME = 'תשלומים';
const MONTHLY_CHARGE_TYPE_NAME = 'חיוב חודשי';
const ONE_MONTH_POSTPONED_TYPE_NAME = 'דחוי חודש';
const MONTHLY_POSTPONED_TYPE_NAME = 'דחוי לחיוב החודשי';
const MONTHLY_PAYMENT_TYPE_NAME = 'תשלום חודשי';
const FUTURE_PURCHASE_FINANCING = 'מימון לרכישה עתידית';
const MONTHLY_POSTPONED_INSTALLMENTS_TYPE_NAME = 'דחוי חודש תשלומים';
const THIRTY_DAYS_PLUS_TYPE_NAME = 'עסקת 30 פלוס';
const TWO_MONTHS_POSTPONED_TYPE_NAME = 'דחוי חודשיים';
const MONTHLY_CHARGE_PLUS_INTEREST_TYPE_NAME = 'חודשי + ריבית';
const CREDIT_TYPE_NAME = 'קרדיט';
const ACCUMULATING_BASKET = 'סל מצטבר';
const POSTPONED_TRANSACTION_INSTALLMENTS = 'פריסת העסקה הדחויה';
const REPLACEMENT_CARD = 'כרטיס חליפי';
const EARLY_REPAYMENT = 'פרעון מוקדם';
const MONTHLY_CARD_FEE = 'דמי כרטיס';

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

function getTransactionType(txnTypeStr: string) {
  const cleanedUpTxnTypeStr = txnTypeStr.replace('\t', ' ').trim();
  switch (cleanedUpTxnTypeStr) {
    case ATM_TYPE_NAME:
    case NORMAL_TYPE_NAME:
    case MONTHLY_CHARGE_TYPE_NAME:
    case ONE_MONTH_POSTPONED_TYPE_NAME:
    case MONTHLY_POSTPONED_TYPE_NAME:
    case FUTURE_PURCHASE_FINANCING:
    case MONTHLY_PAYMENT_TYPE_NAME:
    case MONTHLY_POSTPONED_INSTALLMENTS_TYPE_NAME:
    case THIRTY_DAYS_PLUS_TYPE_NAME:
    case TWO_MONTHS_POSTPONED_TYPE_NAME:
    case ACCUMULATING_BASKET:
    case INTERNET_SHOPPING_TYPE_NAME:
    case MONTHLY_CHARGE_PLUS_INTEREST_TYPE_NAME:
    case POSTPONED_TRANSACTION_INSTALLMENTS:
    case REPLACEMENT_CARD:
    case EARLY_REPAYMENT:
    case MONTHLY_CARD_FEE:
      return TransactionTypes.Normal;
    case INSTALLMENTS_TYPE_NAME:
    case CREDIT_TYPE_NAME:
      return TransactionTypes.Installments;
    default:
      throw new Error(`Unknown transaction type ${cleanedUpTxnTypeStr}`);
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
    type: getTransactionType(rawTransaction.planName),
    date: moment(rawTransaction.purchaseDate).toISOString(),
    processedDate,
    originalAmount: -rawTransaction.originalAmount,
    originalCurrency: rawTransaction.originalCurrency,
    chargedAmount: -rawTransaction.actualPaymentAmount,
    description: rawTransaction.merchantName.trim(),
    memo: rawTransaction.comments,
    category: categories.get(rawTransaction?.categoryId),
    installments,
    identifier,
    status,
  };
}
interface ScrapedTransactionsResult{
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

function prepareTransactions(txns: Transaction[], startMoment: moment.Moment, combineInstallments: boolean) {
  let clonedTxns = Array.from(txns);
  if (!combineInstallments) {
    clonedTxns = fixInstallments(clonedTxns);
  }
  clonedTxns = sortTransactionsByDate(clonedTxns);
  clonedTxns = filterOldTransactions(clonedTxns, startMoment, combineInstallments || false);
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
    txns = prepareTransactions(txns, startMoment, options.combineInstallments || false);
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

function createLoginFields(credentials: ScraperCredentials) {
  return [
    { selector: '#user-name', value: credentials.username },
    { selector: '#password', value: credentials.password },
  ];
}

class MaxScraper extends BaseScraperWithBrowser {
  getLoginOptions(credentials: ScraperCredentials) {
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
