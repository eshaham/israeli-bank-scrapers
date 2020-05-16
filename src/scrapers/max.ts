import buildUrl from 'build-url';
import moment, { Moment } from 'moment';
import { Page } from 'puppeteer';
import { fetchGetWithinPage } from '../helpers/fetch';
import { BaseScraperWithBrowser, LoginResults, PossibleLoginResults } from './base-scraper-with-browser';
import { waitForRedirect } from '../helpers/navigation';
import { waitUntilElementFound, elementPresentOnPage, clickButton } from '../helpers/elements-interactions';
import getAllMonthMoments from '../helpers/dates';
import { fixInstallments, sortTransactionsByDate, filterOldTransactions } from '../helpers/transactions';
import { Transaction, TransactionStatuses, TransactionTypes } from '../types';
import { BaseScraperOptions, ScraperCredentials } from './base-scraper';


interface ScrapedTransaction {
  shortCardNumber: string,
  paymentDate?: string,
  purchaseDate: string,
  actualPaymentAmount: string,
  originalCurrency: string,
  originalAmount: number,
  planName: string,
  comments: string,
  merchantName: string,
}

const BASE_ACTIONS_URL = 'https://online.max.co.il';
const BASE_API_ACTIONS_URL = 'https://onlinelcapi.max.co.il';
const BASE_WELCOME_URL = 'https://www.max.co.il';
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

const INVALID_DETAILS_SELECTOR = '#popupWrongDetails';
const LOGIN_ERROR_SELECTOR = '#popupCardHoldersLoginError';

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
    path: `/api/registered/transactionDetails/getTransactionsAndGraphs?filterData={"userIndex":-1,"cardIndex":-1,"monthView":true,"date":"${date}","dates":{"startDate":"0","endDate":"0"}}&v=V3.13-HF.6.26`,
  });
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
    case INTERNET_SHOPPING_TYPE_NAME:
    case MONTHLY_CHARGE_PLUS_INTEREST_TYPE_NAME:
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
    return null;
  }
  const matches = comments.match(/\d+/g);
  if (!matches || matches.length < 2) {
    return null;
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

  return {
    type: getTransactionType(rawTransaction.planName),
    date: moment(rawTransaction.purchaseDate).toISOString(),
    processedDate,
    originalAmount: -rawTransaction.originalAmount,
    originalCurrency: rawTransaction.originalCurrency,
    chargedAmount: -rawTransaction.actualPaymentAmount,
    description: rawTransaction.merchantName.trim(),
    memo: rawTransaction.comments,
    installments: getInstallmentsInfo(rawTransaction.comments) || undefined,
    status,
  };
}
interface ScrapedTransactionsResult{
  result?: {
    transactions: ScrapedTransaction[]
  }
}

async function fetchTransactionsForMonth(page: Page, monthMoment: Moment) {
  const url = getTransactionsUrl(monthMoment);

  const data = await fetchGetWithinPage<ScrapedTransactionsResult>(page, url);
  const transactionsByAccount: Record<string, Transaction[]> = {};

  if (!data || !data.result) return transactionsByAccount;

  data.result.transactions.forEach((transaction: ScrapedTransaction) => {
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

async function fetchTransactions(page: Page, options: BaseScraperOptions) {
  const defaultStartMoment = moment().subtract(1, 'years');
  const startDate = options.startDate || defaultStartMoment.toDate();
  const startMoment = moment.max(defaultStartMoment, moment(startDate));
  const allMonths = getAllMonthMoments(startMoment, true);

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
  urls[LoginResults.Success] = [`${BASE_WELCOME_URL}/homepage/personal`];
  urls[LoginResults.ChangePassword] = [`${BASE_ACTIONS_URL}/Anonymous/Login/PasswordExpired.aspx`];
  urls[LoginResults.InvalidPassword] = [async () => {
    return elementPresentOnPage(page, INVALID_DETAILS_SELECTOR);
  }];
  urls[LoginResults.UnknownError] = [async () => {
    return elementPresentOnPage(page, LOGIN_ERROR_SELECTOR);
  }];
  return urls;
}

function createLoginFields(inputGroupName: string, credentials: ScraperCredentials) {
  return [
    { selector: `#${inputGroupName}_txtUserName`, value: credentials.username },
    { selector: '#txtPassword', value: credentials.password },
  ];
}

class MaxScraper extends BaseScraperWithBrowser {
  getLoginOptions(credentials: ScraperCredentials) {
    const inputGroupName = 'PlaceHolderMain_CardHoldersLogin1';
    return {
      loginUrl: `${BASE_ACTIONS_URL}/Anonymous/Login/CardholdersLogin.aspx`,
      fields: createLoginFields(inputGroupName, credentials),
      submitButtonSelector: `#${inputGroupName}_btnLogin`,
      preAction: async () => {
        if (await elementPresentOnPage(this.page, '#closePopup')) {
          await clickButton(this.page, '#closePopup');
        }
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
