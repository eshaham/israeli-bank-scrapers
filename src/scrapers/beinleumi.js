import moment from 'moment';
import { BaseScraperWithBrowser, LOGIN_RESULT } from './base-scraper-with-browser';
import {
  fillInput,
  clickButton,
  waitUntilElementFound,
  pageEvalAll,
  elementPresentOnPage,
} from '../helpers/elements-interactions';
import { waitForNavigation } from '../helpers/navigation';
import { SHEKEL_CURRENCY, NORMAL_TXN_TYPE, TRANSACTION_STATUS } from '../constants';

const BASE_URL = 'https://online.fibi.co.il';
const LOGIN_URL = `${BASE_URL}/MatafLoginService/MatafLoginServlet?bankId=FIBIPORTAL&site=Private&KODSAFA=HE`;
const TRANSACTIONS_URL = `${BASE_URL}/wps/myportal/FibiMenu/Online/OnAccountMngment/OnBalanceTrans/PrivateAccountFlow`;
const DATE_FORMAT = 'DD/MM/YYYY';
const NO_TRANSACTION_IN_DATE_RANGE_TEXT = 'לא נמצאו נתונים בנושא המבוקש';
const DATE_COLUMN_CLASS = 'date first';
const DESCRIPTION_COLUMN_CLASS = 'reference wrap_normal';
const REFERENCE_COLUMN_CLASS = 'details';
const DEBIT_COLUMN_CLASS = 'debit';
const CREDIT_COLUMN_CLASS = 'credit';
const ERROR_MESSAGE_CLASS = 'NO_DATA';
const ACCOUNTS_NUMBER = 'div.fibi_account span.acc_num';
const CLOSE_SEARCH_BY_DATES_BUTTON_CLASS = 'ui-datepicker-close';
const SHOW_SEARCH_BY_DATES_BUTTON_VALUE = 'הצג';
const TRANSACTIONS_TABLE = 'table[id*=\'dataTable\']';
const TRANSACTIONS_PAGINATION_LIMIT = 20;
const NEXT_PAGE_LINK = 'a#Npage.paging';

function getPossibleLoginResults() {
  const urls = {};
  urls[LOGIN_RESULT.SUCCESS] = [/FibiMenu\/Online/];
  urls[LOGIN_RESULT.INVALID_PASSWORD] = [/FibiMenu\/Marketing\/Private\/Home/];
  return urls;
}

function createLoginFields(credentials) {
  return [
    { selector: '#username', value: credentials.username },
    { selector: '#password', value: credentials.password },
  ];
}

function getAmountData(amountStr) {
  const amountStrCopy = amountStr.replace(',', '');
  return parseFloat(amountStrCopy);
}

function getTxnAmount(txn) {
  const credit = getAmountData(txn.credit);
  const debit = getAmountData(txn.debit);
  return (Number.isNaN(credit) ? 0 : credit) - (Number.isNaN(debit) ? 0 : debit);
}

function convertTransactions(txns) {
  return txns.map((txn) => {
    const convertedDate = moment(txn.date, DATE_FORMAT).toISOString();
    const convertedAmount = getTxnAmount(txn);
    return {
      type: NORMAL_TXN_TYPE,
      identifier: txn.reference ? parseInt(txn.reference, 10) : null,
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

function getTransactionDate(tds, transactionsColsTypes) {
  return (tds[transactionsColsTypes[DATE_COLUMN_CLASS]] || '').trim();
}

function getTransactionDescription(tds, transactionsColsTypes) {
  return (tds[transactionsColsTypes[DESCRIPTION_COLUMN_CLASS]] || '').trim();
}

function getTransactionReference(tds, transactionsColsTypes) {
  return (tds[transactionsColsTypes[REFERENCE_COLUMN_CLASS]] || '').trim();
}

function getTransactionDebit(tds, transactionsColsTypes) {
  return (tds[transactionsColsTypes[DEBIT_COLUMN_CLASS]] || '').trim();
}

function getTransactionCredit(tds, transactionsColsTypes) {
  return (tds[transactionsColsTypes[CREDIT_COLUMN_CLASS]] || '').trim();
}

function extractTransactionDetails(txnRow, transactionsColsTypes) {
  const tds = txnRow.innerTds;
  return {
    status: TRANSACTION_STATUS.COMPLETED,
    date: getTransactionDate(tds, transactionsColsTypes),
    description: getTransactionDescription(tds, transactionsColsTypes),
    reference: getTransactionReference(tds, transactionsColsTypes),
    debit: getTransactionDebit(tds, transactionsColsTypes),
    credit: getTransactionCredit(tds, transactionsColsTypes),
  };
}

async function getTransactionsColsTypeClasses(page) {
  const typeClassesMap = [];
  const typeClassesObjs = await pageEvalAll(page, `${TRANSACTIONS_TABLE} tbody tr:first-of-type td`, null, (tds) => {
    return tds.map((td, index) => ({
      colClass: td.getAttribute('class'),
      index,
    }));
  });

  for (const typeClassObj of typeClassesObjs) {
    typeClassesMap[typeClassObj.colClass] = typeClassObj.index;
  }
  return typeClassesMap;
}

function extractTransaction(txns, txnRow, transactionsColsTypes) {
  const txn = extractTransactionDetails(txnRow, transactionsColsTypes);
  if (txn.date !== '') {
    txns.push(txn);
  }
}

async function extractTransactions(page) {
  const txns = [];
  const transactionsColsTypes = await getTransactionsColsTypeClasses(page);

  const transactionsRows = await pageEvalAll(page, `${TRANSACTIONS_TABLE} tbody tr`, [], (trs) => {
    return trs.map((tr) => ({
      innerTds: Array.from(tr.getElementsByTagName('td')).map((td) => td.innerText),
    }));
  });

  for (const txnRow of transactionsRows) {
    extractTransaction(txns, txnRow, transactionsColsTypes);
  }
  return txns;
}

async function isNoTransactionInDateRangeError(page) {
  const hasErrorInfoElement = await elementPresentOnPage(page, `.${ERROR_MESSAGE_CLASS}`);
  if (hasErrorInfoElement) {
    const errorText = await page.$eval(`.${ERROR_MESSAGE_CLASS}`, (errorElement) => {
      return errorElement.innerText;
    });
    return errorText.trim() === NO_TRANSACTION_IN_DATE_RANGE_TEXT;
  }
  return false;
}

async function searchByDates(page, startDate) {
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

async function getAccountNumber(page) {
  const selectedSnifAccount = await page.$eval(ACCOUNTS_NUMBER, (option) => {
    return option.innerText;
  });

  return selectedSnifAccount.replace('/', '_');
}

async function checkIfHasNextPage(page) {
  return elementPresentOnPage(page, NEXT_PAGE_LINK);
}

async function navigateToNextPage(page) {
  await clickButton(page, NEXT_PAGE_LINK);
  await waitForNavigation(page);
}

async function scrapeTransactions(page) {
  const txns = [];
  let hasNextPage = false;
  for (let i = 0; i < TRANSACTIONS_PAGINATION_LIMIT; i += 1) {
    const currentPageTxns = await extractTransactions(page);
    txns.push(...currentPageTxns);
    hasNextPage = await checkIfHasNextPage(page);
    if (hasNextPage) {
      await navigateToNextPage(page);
    } else {
      break;
    }
  }
  return convertTransactions(txns);
}

async function getAccountTransactions(page) {
  await Promise.race([
    waitUntilElementFound(page, 'div[id*=\'divTable\']', false),
    waitUntilElementFound(page, `.${ERROR_MESSAGE_CLASS}`, false),
  ]);

  const noTransactionInRangeError = await isNoTransactionInDateRangeError(page);
  if (noTransactionInRangeError) {
    return [];
  }

  return scrapeTransactions(page);
}

async function fetchAccountData(page, startDate) {
  await searchByDates(page, startDate);
  const accountNumber = await getAccountNumber(page);
  const txns = await getAccountTransactions(page);
  return {
    accountNumber,
    txns,
  };
}

// TODO: Add support of multiple accounts
async function fetchAccounts(page, startDate) {
  const accounts = [];
  const accountData = await fetchAccountData(page, startDate);
  accounts.push(accountData);
  return accounts;
}

async function waitForPostLogin(page) {
  return Promise.race([
    waitUntilElementFound(page, '#matafLogoutLink', true),
    waitUntilElementFound(page, '#validationMsg', true),
  ]);
}

class BeinleumiScraper extends BaseScraperWithBrowser {
  getLoginOptions(credentials) {
    return {
      loginUrl: `${LOGIN_URL}`,
      fields: createLoginFields(credentials),
      submitButtonSelector: '#continueBtn',
      postAction: async () => waitForPostLogin(this.page),
      possibleResults: getPossibleLoginResults(),
    };
  }

  async fetchData() {
    const defaultStartMoment = moment().subtract(1, 'years').add(1, 'day');
    const startDate = this.options.startDate || defaultStartMoment.toDate();
    const startMoment = moment.max(defaultStartMoment, moment(startDate));

    await this.navigateTo(TRANSACTIONS_URL);

    const accounts = await fetchAccounts(this.page, startMoment);

    return {
      success: true,
      accounts,
    };
  }
}

export default BeinleumiScraper;
