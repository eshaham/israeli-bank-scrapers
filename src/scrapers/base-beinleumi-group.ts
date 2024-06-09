// eslint-disable-next-line import/named
import moment, { Moment } from 'moment';
import { Page } from 'puppeteer';
import { SHEKEL_CURRENCY } from '../constants';
import {
  clickButton,
  elementPresentOnPage,
  fillInput,
  pageEvalAll,
  waitUntilElementFound,
} from '../helpers/elements-interactions';
import { waitForNavigation } from '../helpers/navigation';
import { sleep } from '../helpers/waiting';
import {
  Transaction, TransactionStatuses, TransactionTypes,
  TransactionsAccount,
} from '../transactions';
import { BaseScraperWithBrowser, LoginResults, PossibleLoginResults } from './base-scraper-with-browser';

const DATE_FORMAT = 'DD/MM/YYYY';
const NO_TRANSACTION_IN_DATE_RANGE_TEXT = 'לא נמצאו נתונים בנושא המבוקש';
const DATE_COLUMN_CLASS_COMPLETED = 'date first';
const DATE_COLUMN_CLASS_PENDING = 'first date';
const DESCRIPTION_COLUMN_CLASS_COMPLETED = 'reference wrap_normal';
const DESCRIPTION_COLUMN_CLASS_PENDING = 'details wrap_normal';
const REFERENCE_COLUMN_CLASS = 'details';
const DEBIT_COLUMN_CLASS = 'debit';
const CREDIT_COLUMN_CLASS = 'credit';
const ERROR_MESSAGE_CLASS = 'NO_DATA';
const ACCOUNTS_NUMBER = 'div.fibi_account span.acc_num';
const CLOSE_SEARCH_BY_DATES_BUTTON_CLASS = 'ui-datepicker-close';
const SHOW_SEARCH_BY_DATES_BUTTON_VALUE = 'הצג';
const COMPLETED_TRANSACTIONS_TABLE = 'table#dataTable077';
const PENDING_TRANSACTIONS_TABLE = 'table#dataTable023';
const NEXT_PAGE_LINK = 'a#Npage.paging';
const CURRENT_BALANCE = '.main_balance';

type TransactionsColsTypes = Record<string, number>;
type TransactionsTrTds = string[];
type TransactionsTr = { innerTds: TransactionsTrTds };

interface ScrapedTransaction {
  reference: string;
  date: string;
  credit: string;
  debit: string;
  memo?: string;
  description: string;
  status: TransactionStatuses;
}

export function getPossibleLoginResults(): PossibleLoginResults {
  const urls: PossibleLoginResults = {};
  urls[LoginResults.Success] = [/FibiMenu\/Online/];
  urls[LoginResults.InvalidPassword] = [/FibiMenu\/Marketing\/Private\/Home/];
  return urls;
}

export function createLoginFields(credentials: ScraperSpecificCredentials) {
  return [
    { selector: '#username', value: credentials.username },
    { selector: '#password', value: credentials.password },
  ];
}

function getAmountData(amountStr: string) {
  const amountStrCopy = amountStr.replace(',', '');
  return parseFloat(amountStrCopy);
}

function getTxnAmount(txn: ScrapedTransaction) {
  const credit = getAmountData(txn.credit);
  const debit = getAmountData(txn.debit);
  return (Number.isNaN(credit) ? 0 : credit) - (Number.isNaN(debit) ? 0 : debit);
}

function convertTransactions(txns: ScrapedTransaction[]): Transaction[] {
  return txns.map((txn): Transaction => {
    const convertedDate = moment(txn.date, DATE_FORMAT).toISOString();
    const convertedAmount = getTxnAmount(txn);
    return {
      type: TransactionTypes.Normal,
      identifier: txn.reference ? parseInt(txn.reference, 10) : undefined,
      date: convertedDate,
      processedDate: convertedDate,
      originalAmount: convertedAmount,
      originalCurrency: SHEKEL_CURRENCY,
      chargedAmount: convertedAmount,
      status: txn.status,
      description: txn.description,
      memo: txn.memo,
    };
  });
}

function getTransactionDate(tds: TransactionsTrTds, transactionType: string, transactionsColsTypes: TransactionsColsTypes) {
  if (transactionType === 'completed') {
    return (tds[transactionsColsTypes[DATE_COLUMN_CLASS_COMPLETED]] || '').trim();
  }
  return (tds[transactionsColsTypes[DATE_COLUMN_CLASS_PENDING]] || '').trim();
}

function getTransactionDescription(tds: TransactionsTrTds, transactionType: string, transactionsColsTypes: TransactionsColsTypes) {
  if (transactionType === 'completed') {
    return (tds[transactionsColsTypes[DESCRIPTION_COLUMN_CLASS_COMPLETED]] || '').trim();
  }
  return (tds[transactionsColsTypes[DESCRIPTION_COLUMN_CLASS_PENDING]] || '').trim();
}

function getTransactionReference(tds: TransactionsTrTds, transactionsColsTypes: TransactionsColsTypes) {
  return (tds[transactionsColsTypes[REFERENCE_COLUMN_CLASS]] || '').trim();
}

function getTransactionDebit(tds: TransactionsTrTds, transactionsColsTypes: TransactionsColsTypes) {
  return (tds[transactionsColsTypes[DEBIT_COLUMN_CLASS]] || '').trim();
}

function getTransactionCredit(tds: TransactionsTrTds, transactionsColsTypes: TransactionsColsTypes) {
  return (tds[transactionsColsTypes[CREDIT_COLUMN_CLASS]] || '').trim();
}

function extractTransactionDetails(txnRow: TransactionsTr, transactionStatus: TransactionStatuses, transactionsColsTypes: TransactionsColsTypes): ScrapedTransaction {
  const tds = txnRow.innerTds;
  const item = {
    status: transactionStatus,
    date: getTransactionDate(tds, transactionStatus, transactionsColsTypes),
    description: getTransactionDescription(tds, transactionStatus, transactionsColsTypes),
    reference: getTransactionReference(tds, transactionsColsTypes),
    debit: getTransactionDebit(tds, transactionsColsTypes),
    credit: getTransactionCredit(tds, transactionsColsTypes),
  };

  return item;
}

async function getTransactionsColsTypeClasses(page: Page, tableLocator: string): Promise<TransactionsColsTypes> {
  const result: TransactionsColsTypes = {};
  const typeClassesObjs = await pageEvalAll(page, `${tableLocator} tbody tr:first-of-type td`, null, (tds) => {
    return tds.map((td, index) => ({
      colClass: td.getAttribute('class'),
      index,
    }));
  });

  for (const typeClassObj of typeClassesObjs) {
    if (typeClassObj.colClass) {
      result[typeClassObj.colClass] = typeClassObj.index;
    }
  }
  return result;
}

function extractTransaction(txns: ScrapedTransaction[], transactionStatus: TransactionStatuses, txnRow: TransactionsTr, transactionsColsTypes: TransactionsColsTypes) {
  const txn = extractTransactionDetails(txnRow, transactionStatus, transactionsColsTypes);
  if (txn.date !== '') {
    txns.push(txn);
  }
}

async function extractTransactions(page: Page, tableLocator: string, transactionStatus: TransactionStatuses) {
  const txns: ScrapedTransaction[] = [];
  const transactionsColsTypes = await getTransactionsColsTypeClasses(page, tableLocator);

  const transactionsRows = await pageEvalAll<TransactionsTr[]>(page, `${tableLocator} tbody tr`, [], (trs) => {
    return trs.map((tr) => ({
      innerTds: Array.from(tr.getElementsByTagName('td')).map((td) => td.innerText),
    }));
  });

  for (const txnRow of transactionsRows) {
    extractTransaction(txns, transactionStatus, txnRow, transactionsColsTypes);
  }
  return txns;
}

async function isNoTransactionInDateRangeError(page: Page) {
  const hasErrorInfoElement = await elementPresentOnPage(page, `.${ERROR_MESSAGE_CLASS}`);
  if (hasErrorInfoElement) {
    const errorText = await page.$eval(`.${ERROR_MESSAGE_CLASS}`, (errorElement) => {
      return (errorElement as HTMLElement).innerText;
    });
    return errorText.trim() === NO_TRANSACTION_IN_DATE_RANGE_TEXT;
  }
  return false;
}

async function searchByDates(page: Page, startDate: Moment) {
  await clickButton(page, 'a#tabHeader4');
  await waitUntilElementFound(page, 'div#fibi_dates');
  await fillInput(
    page,
    'input#fromDate',
    startDate.format(DATE_FORMAT),
  );
  await clickButton(page, `button[class*=${CLOSE_SEARCH_BY_DATES_BUTTON_CLASS}]`);
  await clickButton(page, `input[value=${SHOW_SEARCH_BY_DATES_BUTTON_VALUE}]`);
  await waitForNavigation(page);
}

async function getAccountNumber(page: Page) {
  const selectedSnifAccount = await page.$eval(ACCOUNTS_NUMBER, (option) => {
    return (option as HTMLElement).innerText;
  });

  return selectedSnifAccount.replace('/', '_').trim();
}

async function checkIfHasNextPage(page: Page) {
  return elementPresentOnPage(page, NEXT_PAGE_LINK);
}

async function navigateToNextPage(page: Page) {
  await clickButton(page, NEXT_PAGE_LINK);
  await waitForNavigation(page);
}

/* Couldn't reproduce scenario with multiple pages of pending transactions - Should support if exists such case.
   needToPaginate is false if scraping pending transactions */
async function scrapeTransactions(page: Page, tableLocator: string, transactionStatus: TransactionStatuses, needToPaginate: boolean) {
  const txns = [];
  let hasNextPage = false;

  do {
    const currentPageTxns = await extractTransactions(page, tableLocator, transactionStatus);
    txns.push(...currentPageTxns);
    if (needToPaginate) {
      hasNextPage = await checkIfHasNextPage(page);
      if (hasNextPage) {
        await navigateToNextPage(page);
      }
    }
  } while (hasNextPage);

  return convertTransactions(txns);
}

async function getAccountTransactions(page: Page) {
  await Promise.race([
    waitUntilElementFound(page, 'div[id*=\'divTable\']', false),
    waitUntilElementFound(page, `.${ERROR_MESSAGE_CLASS}`, false),
  ]);

  const noTransactionInRangeError = await isNoTransactionInDateRangeError(page);
  if (noTransactionInRangeError) {
    return [];
  }

  const pendingTxns = await scrapeTransactions(page, PENDING_TRANSACTIONS_TABLE,
    TransactionStatuses.Pending, false);
  const completedTxns = await scrapeTransactions(page, COMPLETED_TRANSACTIONS_TABLE,
    TransactionStatuses.Completed, true);
  const txns = [
    ...pendingTxns,
    ...completedTxns,
  ];
  return txns;
}

async function getCurrentBalance(page: Page) {
  const balanceStr = await page.$eval(CURRENT_BALANCE, (option) => {
    return (option as HTMLElement).innerText;
  });
  return getAmountData(balanceStr);
}

export async function waitForPostLogin(page: Page) {
  return Promise.race([
    waitUntilElementFound(page, '#matafLogoutLink', true),
    waitUntilElementFound(page, '#validationMsg', true),
  ]);
}

async function fetchAccountData(page: Page, startDate: Moment) {
  await searchByDates(page, startDate);
  const accountNumber = await getAccountNumber(page);
  const balance = await getCurrentBalance(page);
  const txns = await getAccountTransactions(page);

  return {
    accountNumber,
    txns,
    balance,
  };
}

async function getAccountIdsBySelector(page: Page): Promise<string[]> {
  const accountsIds = await page.evaluate(() => {
    const selectElement = document.getElementById('account_num_select');
    const options = selectElement ? selectElement.querySelectorAll('option') : [];
    if (!options) return [];
    return Array.from(options, (option) => option.value);
  });
  return accountsIds;
}

async function fetchAccounts(page: Page, startDate: Moment) {
  const accounts: TransactionsAccount[] = [];
  const accountsIds = await getAccountIdsBySelector(page);
  if (accountsIds.length <= 1) {
    const accountData = await fetchAccountData(page, startDate);
    accounts.push(accountData);
  } else {
    for (const accountId of accountsIds) {
      await page.select('#account_num_select', accountId);
      await waitUntilElementFound(page, '#account_num_select', true);
      const accountData = await fetchAccountData(page, startDate);
      accounts.push(accountData);
    }
  }
  return accounts;
}

type ScraperSpecificCredentials = { username: string, password: string };

class BeinleumiGroupBaseScraper extends BaseScraperWithBrowser<ScraperSpecificCredentials> {
  BASE_URL = '';

  LOGIN_URL = '';

  TRANSACTIONS_URL = '';

  getLoginOptions(credentials: ScraperSpecificCredentials) {
    return {
      loginUrl: `${this.LOGIN_URL}`,
      fields: createLoginFields(credentials),
      submitButtonSelector: '#continueBtn',
      postAction: async () => waitForPostLogin(this.page),
      possibleResults: getPossibleLoginResults(),
      // HACK: For some reason, though the login button (#continueBtn) is present and visible, the click action does not perform.
      // Adding this delay fixes the issue.
      preAction: async () => {
        await sleep(1000);
      },
    };
  }

  async fetchData() {
    const defaultStartMoment = moment().subtract(1, 'years').add(1, 'day');
    const startDate = this.options.startDate || defaultStartMoment.toDate();
    const startMoment = moment.max(defaultStartMoment, moment(startDate));

    await this.navigateTo(this.TRANSACTIONS_URL);

    const accounts = await fetchAccounts(this.page, startMoment);

    return {
      success: true,
      accounts,
    };
  }
}

export default BeinleumiGroupBaseScraper;
