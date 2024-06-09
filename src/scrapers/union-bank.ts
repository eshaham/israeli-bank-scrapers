// eslint-disable-next-line import/named
import moment, { Moment } from 'moment';
import { Page } from 'puppeteer';
import { SHEKEL_CURRENCY } from '../constants';
import {
  clickButton,
  dropdownElements,
  dropdownSelect,
  elementPresentOnPage,
  fillInput,
  pageEvalAll,
  waitUntilElementFound,
} from '../helpers/elements-interactions';
import { waitForNavigation } from '../helpers/navigation';
import {
  Transaction, TransactionStatuses,
  TransactionTypes,
  TransactionsAccount,
} from '../transactions';
import { BaseScraperWithBrowser, LoginResults, PossibleLoginResults } from './base-scraper-with-browser';

const BASE_URL = 'https://hb.unionbank.co.il';
const TRANSACTIONS_URL = `${BASE_URL}/eBanking/Accounts/ExtendedActivity.aspx#/`;
const DATE_FORMAT = 'DD/MM/YY';
const NO_TRANSACTION_IN_DATE_RANGE_TEXT = 'לא קיימות תנועות מתאימות על פי הסינון שהוגדר';
const DATE_HEADER = 'תאריך';
const DESCRIPTION_HEADER = 'תיאור';
const REFERENCE_HEADER = 'אסמכתא';
const DEBIT_HEADER = 'חובה';
const CREDIT_HEADER = 'זכות';
const PENDING_TRANSACTIONS_TABLE_ID = 'trTodayActivityNapaTableUpper';
const COMPLETED_TRANSACTIONS_TABLE_ID = 'ctlActivityTable';
const ERROR_MESSAGE_CLASS = 'errInfo';
const ACCOUNTS_DROPDOWN_SELECTOR = 'select#ddlAccounts_m_ddl';

function getPossibleLoginResults() {
  const urls: PossibleLoginResults = {};
  urls[LoginResults.Success] = [/eBanking\/Accounts/];
  urls[LoginResults.InvalidPassword] = [/InternalSite\/CustomUpdate\/leumi\/LoginPage.ASP/];
  return urls;
}

function createLoginFields(credentials: ScraperSpecificCredentials) {
  return [
    { selector: '#uid', value: credentials.username },
    { selector: '#password', value: credentials.password },
  ];
}

function getAmountData(amountStr: string) {
  const amountStrCopy = amountStr.replace(',', '');
  return parseFloat(amountStrCopy);
}

interface ScrapedTransaction {
  credit: string;
  debit: string;
  date: string;
  reference?: string;
  description: string;
  memo: string;
  status: TransactionStatuses;
}

function getTxnAmount(txn: ScrapedTransaction) {
  const credit = getAmountData(txn.credit);
  const debit = getAmountData(txn.debit);
  return (Number.isNaN(credit) ? 0 : credit) - (Number.isNaN(debit) ? 0 : debit);
}

function convertTransactions(txns: ScrapedTransaction[]): Transaction[] {
  return txns.map((txn) => {
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

type TransactionsTr = { id: string, innerTds: TransactionsTrTds };
type TransactionTableHeaders = Record<string, number>;
type TransactionsTrTds = string[];

function getTransactionDate(tds: TransactionsTrTds, txnsTableHeaders: TransactionTableHeaders) {
  return (tds[txnsTableHeaders[DATE_HEADER]] || '').trim();
}

function getTransactionDescription(tds: TransactionsTrTds, txnsTableHeaders: TransactionTableHeaders) {
  return (tds[txnsTableHeaders[DESCRIPTION_HEADER]] || '').trim();
}

function getTransactionReference(tds: TransactionsTrTds, txnsTableHeaders: TransactionTableHeaders) {
  return (tds[txnsTableHeaders[REFERENCE_HEADER]] || '').trim();
}

function getTransactionDebit(tds: TransactionsTrTds, txnsTableHeaders: TransactionTableHeaders) {
  return (tds[txnsTableHeaders[DEBIT_HEADER]] || '').trim();
}

function getTransactionCredit(tds: TransactionsTrTds, txnsTableHeaders: TransactionTableHeaders) {
  return (tds[txnsTableHeaders[CREDIT_HEADER]] || '').trim();
}

function extractTransactionDetails(txnRow: TransactionsTr, txnsTableHeaders: TransactionTableHeaders, txnStatus: TransactionStatuses): ScrapedTransaction {
  const tds = txnRow.innerTds;
  return {
    status: txnStatus,
    date: getTransactionDate(tds, txnsTableHeaders),
    description: getTransactionDescription(tds, txnsTableHeaders),
    reference: getTransactionReference(tds, txnsTableHeaders),
    debit: getTransactionDebit(tds, txnsTableHeaders),
    credit: getTransactionCredit(tds, txnsTableHeaders),
    memo: '',
  };
}

function isExpandedDescRow(txnRow: TransactionsTr) {
  return txnRow.id === 'rowAdded';
}

/* eslint-disable no-param-reassign */
function editLastTransactionDesc(txnRow: TransactionsTr, lastTxn: ScrapedTransaction): ScrapedTransaction {
  lastTxn.description = `${lastTxn.description} ${txnRow.innerTds[0]}`;
  return lastTxn;
}

function handleTransactionRow(txns: ScrapedTransaction[], txnsTableHeaders: TransactionTableHeaders, txnRow: TransactionsTr, txnType: TransactionStatuses) {
  if (isExpandedDescRow(txnRow)) {
    const lastTransaction = txns.pop();
    if (lastTransaction) {
      txns.push(editLastTransactionDesc(txnRow, lastTransaction));
    } else {
      throw new Error('internal union-bank error');
    }
  } else {
    txns.push(extractTransactionDetails(txnRow, txnsTableHeaders, txnType));
  }
}

async function getTransactionsTableHeaders(page: Page, tableTypeId: string) {
  const headersMap: Record<string, any> = [];
  const headersObjs = await pageEvalAll(page, `#WorkSpaceBox #${tableTypeId} tr[class='header'] th`, null, (ths) => {
    return ths.map((th, index) => ({
      text: (th as HTMLElement).innerText.trim(),
      index,
    }));
  });

  for (const headerObj of headersObjs) {
    headersMap[headerObj.text] = headerObj.index;
  }
  return headersMap;
}

async function extractTransactionsFromTable(page: Page, tableTypeId: string, txnType: TransactionStatuses): Promise<ScrapedTransaction[]> {
  const txns: ScrapedTransaction[] = [];
  const transactionsTableHeaders = await getTransactionsTableHeaders(page, tableTypeId);

  const transactionsRows = await pageEvalAll<TransactionsTr[]>(page, `#WorkSpaceBox #${tableTypeId} tr[class]:not([class='header'])`, [], (trs) => {
    return (trs as HTMLElement[]).map((tr) => ({
      id: (tr).getAttribute('id') || '',
      innerTds: Array.from(tr.getElementsByTagName('td')).map((td) => (td as HTMLElement).innerText),
    }));
  });

  for (const txnRow of transactionsRows) {
    handleTransactionRow(txns, transactionsTableHeaders, txnRow, txnType);
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

async function chooseAccount(page: Page, accountId: string) {
  const hasDropDownList = await elementPresentOnPage(page, ACCOUNTS_DROPDOWN_SELECTOR);
  if (hasDropDownList) {
    await dropdownSelect(page, ACCOUNTS_DROPDOWN_SELECTOR, accountId);
  }
}

async function searchByDates(page: Page, startDate: Moment) {
  await dropdownSelect(page, 'select#ddlTransactionPeriod', '004');
  await waitUntilElementFound(page, 'select#ddlTransactionPeriod');
  await fillInput(
    page,
    'input#dtFromDate_textBox',
    startDate.format(DATE_FORMAT),
  );
  await clickButton(page, 'input#btnDisplayDates');
  await waitForNavigation(page);
}

async function getAccountNumber(page: Page) {
  const selectedSnifAccount = await page.$eval('#ddlAccounts_m_ddl option[selected="selected"]', (option) => {
    return (option as HTMLElement).innerText;
  });

  return selectedSnifAccount.replace('/', '_');
}

async function expandTransactionsTable(page: Page) {
  const hasExpandAllButton = await elementPresentOnPage(page, "a[id*='lnkCtlExpandAll']");
  if (hasExpandAllButton) {
    await clickButton(page, "a[id*='lnkCtlExpandAll']");
  }
}

async function scrapeTransactionsFromTable(page: Page): Promise<Transaction[]> {
  const pendingTxns = await extractTransactionsFromTable(page, PENDING_TRANSACTIONS_TABLE_ID,
    TransactionStatuses.Pending);
  const completedTxns = await extractTransactionsFromTable(page, COMPLETED_TRANSACTIONS_TABLE_ID,
    TransactionStatuses.Completed);
  const txns = [
    ...pendingTxns,
    ...completedTxns,
  ];
  return convertTransactions(txns);
}

async function getAccountTransactions(page: Page): Promise<Transaction[]> {
  await Promise.race([
    waitUntilElementFound(page, `#${COMPLETED_TRANSACTIONS_TABLE_ID}`, false),
    waitUntilElementFound(page, `.${ERROR_MESSAGE_CLASS}`, false),
  ]);

  const noTransactionInRangeError = await isNoTransactionInDateRangeError(page);
  if (noTransactionInRangeError) {
    return [];
  }

  await expandTransactionsTable(page);
  return scrapeTransactionsFromTable(page);
}

async function fetchAccountData(page: Page, startDate: Moment, accountId: string): Promise<TransactionsAccount> {
  await chooseAccount(page, accountId);
  await searchByDates(page, startDate);
  const accountNumber = await getAccountNumber(page);
  const txns = await getAccountTransactions(page);
  return {
    accountNumber,
    txns,
  };
}

async function fetchAccounts(page: Page, startDate: Moment) {
  const accounts: TransactionsAccount[] = [];
  const accountsList = await dropdownElements(page, ACCOUNTS_DROPDOWN_SELECTOR);
  for (const account of accountsList) {
    if (account.value !== '-1') { // Skip "All accounts" option
      const accountData = await fetchAccountData(page, startDate, account.value);
      accounts.push(accountData);
    }
  }
  return accounts;
}

async function waitForPostLogin(page: Page) {
  return Promise.race([
    waitUntilElementFound(page, '#signoff', true),
    waitUntilElementFound(page, '#restore', true),
  ]);
}

type ScraperSpecificCredentials = { username: string, password: string };

class UnionBankScraper extends BaseScraperWithBrowser<ScraperSpecificCredentials> {
  getLoginOptions(credentials: ScraperSpecificCredentials) {
    return {
      loginUrl: `${BASE_URL}`,
      fields: createLoginFields(credentials),
      submitButtonSelector: '#enter',
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

export default UnionBankScraper;
