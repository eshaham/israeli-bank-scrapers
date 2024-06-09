// eslint-disable-next-line import/named
import moment, { Moment } from 'moment';
import { Page } from 'puppeteer';
import { SHEKEL_CURRENCY } from '../constants';
import {
  clickButton, elementPresentOnPage,
  pageEvalAll, waitUntilElementDisappear, waitUntilElementFound,
} from '../helpers/elements-interactions';
import { waitForNavigation } from '../helpers/navigation';
import {
  Transaction,
  TransactionStatuses, TransactionTypes,
  TransactionsAccount,
} from '../transactions';
import {
  BaseScraperWithBrowser,
  LoginResults,
  PossibleLoginResults,
} from './base-scraper-with-browser';

const LOGIN_URL = 'https://login.yahav.co.il/login/';
const BASE_URL = 'https://digital.yahav.co.il/BaNCSDigitalUI/app/index.html#/';
const INVALID_DETAILS_SELECTOR = '.ui-dialog-buttons';
const CHANGE_PASSWORD_OLD_PASS = 'input#ef_req_parameter_old_credential';
const BASE_WELCOME_URL = `${BASE_URL}main/home`;

const ACCOUNT_ID_SELECTOR = '.dropdown-dir .selected-item-top';
const ACCOUNT_DETAILS_SELECTOR = '.account-details';
const DATE_FORMAT = 'DD/MM/YYYY';

const USER_ELEM = '#username';
const PASSWD_ELEM = '#password';
const NATIONALID_ELEM = '#pinno';
const SUBMIT_LOGIN_SELECTOR = '.btn';

interface ScrapedTransaction {
  credit: string;
  debit: string;
  date: string;
  reference?: string;
  description: string;
  memo: string;
  status: TransactionStatuses;
}

function getPossibleLoginResults(page: Page): PossibleLoginResults {
  // checkout file `base-scraper-with-browser.ts` for available result types
  const urls: PossibleLoginResults = {};
  urls[LoginResults.Success] = [
    `${BASE_WELCOME_URL}`,
  ];
  urls[LoginResults.InvalidPassword] = [async () => {
    return elementPresentOnPage(page, `${INVALID_DETAILS_SELECTOR}`);
  }];

  urls[LoginResults.ChangePassword] = [async () => {
    return elementPresentOnPage(page, `${CHANGE_PASSWORD_OLD_PASS}`);
  }];

  return urls;
}

async function getAccountID(page: Page) {
  const selectedSnifAccount = await page.$eval(`${ACCOUNT_ID_SELECTOR}`, (option) => {
    return (option as HTMLElement).innerText;
  });

  return selectedSnifAccount;
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

type TransactionsTr = { id: string, innerDivs: string[] };

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

function handleTransactionRow(txns: ScrapedTransaction[], txnRow: TransactionsTr) {
  const div = txnRow.innerDivs;

  // Remove anything except digits.
  const regex = /\D+/gm;

  const tx: ScrapedTransaction = {
    date: div[1],
    reference: div[2].replace(regex, ''),
    memo: '',
    description: div[3],
    debit: div[4],
    credit: div[5],
    status: TransactionStatuses.Completed,
  };

  txns.push(tx);
}

async function getAccountTransactions(page: Page): Promise<Transaction[]> {
  // Wait for transactions.
  await waitUntilElementFound(page, '.under-line-txn-table-header', true);

  const txns: ScrapedTransaction[] = [];
  const transactionsDivs = await pageEvalAll<TransactionsTr[]>(page, '.list-item-holder .entire-content-ctr', [], (divs) => {
    return (divs as HTMLElement[]).map((div) => ({
      id: (div).getAttribute('id') || '',
      innerDivs: Array.from(div.getElementsByTagName('div')).map((el) => (el as HTMLElement).innerText),
    }));
  });

  for (const txnRow of transactionsDivs) {
    handleTransactionRow(txns, txnRow);
  }

  return convertTransactions(txns);
}

// Manipulate the calendar drop down to choose the txs start date.
async function searchByDates(page: Page, startDate: Moment) {
  // Get the day number from startDate. 1-31 (usually 1)
  const startDateDay = startDate.format('D');
  const startDateMonth = startDate.format('M');
  const startDateYear = startDate.format('Y');

  // Open the calendar date picker
  const dateFromPick = 'div.date-options-cell:nth-child(7) > date-picker:nth-child(1) > div:nth-child(1) > span:nth-child(2)';
  await waitUntilElementFound(page, dateFromPick, true);
  await clickButton(page, dateFromPick);

  // Wait until first day appear.
  await waitUntilElementFound(page, '.pmu-days > div:nth-child(1)', true);

  // Open Months options.
  const monthFromPick = '.pmu-month';
  await waitUntilElementFound(page, monthFromPick, true);
  await clickButton(page, monthFromPick);
  await waitUntilElementFound(page, '.pmu-months > div:nth-child(1)', true);

  // Open Year options.
  // Use same selector... Yahav knows why...
  await waitUntilElementFound(page, monthFromPick, true);
  await clickButton(page, monthFromPick);
  await waitUntilElementFound(page, '.pmu-years > div:nth-child(1)', true);

  // Select year from a 12 year grid.
  for (let i = 1; i < 13; i += 1) {
    const selector = `.pmu-years > div:nth-child(${i})`;
    const year = await page.$eval(selector, (y) => {
      return (y as HTMLElement).innerText;
    });
    if (startDateYear === year) {
      await clickButton(page, selector);
      break;
    }
  }

  // Select Month.
  await waitUntilElementFound(page, '.pmu-months > div:nth-child(1)', true);
  // The first element (1) is January.
  const monthSelector = `.pmu-months > div:nth-child(${startDateMonth})`;
  await clickButton(page, monthSelector);

  // Select Day.
  // The calendar grid shows 7 days and 6 weeks = 42 days.
  // In theory, the first day of the month will be in the first row.
  // Let's check everything just in case...
  for (let i = 1; i < 42; i += 1) {
    const selector = `.pmu-days > div:nth-child(${i})`;
    const day = await page.$eval(selector, (d) => {
      return (d as HTMLElement).innerText;
    });

    if (startDateDay === day) {
      await clickButton(page, selector);
      break;
    }
  }
}

async function fetchAccountData(page: Page, startDate: Moment, accountID: string): Promise<TransactionsAccount> {
  await waitUntilElementDisappear(page, '.loading-bar-spinner');
  await searchByDates(page, startDate);
  await waitUntilElementDisappear(page, '.loading-bar-spinner');
  const txns = await getAccountTransactions(page);

  return {
    accountNumber: accountID,
    txns,
  };
}

async function fetchAccounts(page: Page, startDate: Moment): Promise<TransactionsAccount[]> {
  const accounts: TransactionsAccount[] = [];

  // TODO: get more accounts. Not sure is supported.
  const accountID = await getAccountID(page);
  const accountData = await fetchAccountData(page, startDate, accountID);
  accounts.push(accountData);

  return accounts;
}

async function waitReadinessForAll(page: Page) {
  await waitUntilElementFound(page, `${USER_ELEM}`, true);
  await waitUntilElementFound(page, `${PASSWD_ELEM}`, true);
  await waitUntilElementFound(page, `${NATIONALID_ELEM}`, true);
  await waitUntilElementFound(page, `${SUBMIT_LOGIN_SELECTOR}`, true);
}

async function redirectOrDialog(page: Page) {
  // Click on bank messages if any.
  await waitForNavigation(page);
  await waitUntilElementDisappear(page, '.loading-bar-spinner');
  const hasMessage = await elementPresentOnPage(page, '.messaging-links-container');
  if (hasMessage) {
    await clickButton(page, '.link-1');
  }

  const promise1 = page.waitForSelector(ACCOUNT_DETAILS_SELECTOR, { timeout: 30000 });
  const promise2 = page.waitForSelector(CHANGE_PASSWORD_OLD_PASS, { timeout: 30000 });
  const promises = [promise1, promise2];

  await Promise.race(promises);
  await waitUntilElementDisappear(page, '.loading-bar-spinner');
}

type ScraperSpecificCredentials = { username: string, password: string, nationalID: string };

class YahavScraper extends BaseScraperWithBrowser<ScraperSpecificCredentials> {
  getLoginOptions(credentials: ScraperSpecificCredentials) {
    return {
      loginUrl: `${LOGIN_URL}`,
      fields: [
        { selector: `${USER_ELEM}`, value: credentials.username },
        { selector: `${PASSWD_ELEM}`, value: credentials.password },
        { selector: `${NATIONALID_ELEM}`, value: credentials.nationalID },
      ],
      submitButtonSelector: `${SUBMIT_LOGIN_SELECTOR}`,
      checkReadiness: async () => waitReadinessForAll(this.page),
      postAction: async () => redirectOrDialog(this.page),
      possibleResults: getPossibleLoginResults(this.page),
    };
  }

  async fetchData() {
    // Goto statements page
    await waitUntilElementFound(this.page, ACCOUNT_DETAILS_SELECTOR, true);
    await clickButton(this.page, ACCOUNT_DETAILS_SELECTOR);
    await waitUntilElementFound(this.page, '.statement-options .selected-item-top', true);

    const defaultStartMoment = moment().subtract(3, 'months').add(1, 'day');
    const startDate = this.options.startDate || defaultStartMoment.toDate();
    const startMoment = moment.max(defaultStartMoment, moment(startDate));

    const accounts = await fetchAccounts(this.page, startMoment);

    return {
      success: true,
      accounts,
    };
  }
}

export default YahavScraper;
