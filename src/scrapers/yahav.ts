import moment, { type Moment } from 'moment';
import { type Page } from 'puppeteer';
import { SHEKEL_CURRENCY } from '../constants';
import {
  clickButton,
  elementPresentOnPage,
  pageEvalAll,
  waitUntilElementDisappear,
  waitUntilElementFound,
} from '../helpers/elements-interactions';
import { waitForNavigation } from '../helpers/navigation';
import { getRawTransaction } from '../helpers/transactions';
import { TransactionStatuses, TransactionTypes, type Transaction, type TransactionsAccount } from '../transactions';
import { BaseScraperWithBrowser, LoginResults, type PossibleLoginResults } from './base-scraper-with-browser';
import { type ScraperOptions } from './interface';

const LOGIN_URL = 'https://login.yahav.co.il/login/';
const BASE_URL = 'https://digital.yahav.co.il/BaNCSDigitalUI/app/index.html#/';
const INVALID_DETAILS_SELECTOR = '.ui-dialog-buttons';
const CHANGE_PASSWORD_OLD_PASS = 'input#ef_req_parameter_old_credential';
const BASE_WELCOME_URL = `${BASE_URL}main/home`;

const ACCOUNT_ID_SELECTOR = 'span.portfolio-value[ng-if="mainController.data.portfolioList.length === 1"]';
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

async function runYahavStage<T>(stage: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Yahav stage '${stage}' failed: ${message}`);
  }
}

function getPossibleLoginResults(page: Page): PossibleLoginResults {
  // checkout file `base-scraper-with-browser.ts` for available result types
  const urls: PossibleLoginResults = {};
  urls[LoginResults.Success] = [`${BASE_WELCOME_URL}`];
  urls[LoginResults.InvalidPassword] = [
    async () => {
      return elementPresentOnPage(page, `${INVALID_DETAILS_SELECTOR}`);
    },
  ];

  urls[LoginResults.ChangePassword] = [
    async () => {
      return elementPresentOnPage(page, `${CHANGE_PASSWORD_OLD_PASS}`);
    },
  ];

  return urls;
}

async function getAccountID(page: Page): Promise<string> {
  try {
    const selectedSnifAccount = await page.$eval(ACCOUNT_ID_SELECTOR, (element: Element) => {
      return element.textContent as string;
    });

    return selectedSnifAccount;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to retrieve account ID. Possible outdated selector '${ACCOUNT_ID_SELECTOR}: ${errorMessage}`,
    );
  }
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

type TransactionsTr = { id: string; innerDivs: string[] };

function convertTransactions(txns: ScrapedTransaction[], options?: ScraperOptions): Transaction[] {
  return txns.map(txn => {
    const convertedDate = moment(txn.date, DATE_FORMAT).toISOString();
    const convertedAmount = getTxnAmount(txn);
    const result: Transaction = {
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

    if (options?.includeRawTransaction) {
      result.rawTransaction = getRawTransaction(txn);
    }

    return result;
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

async function getAccountTransactions(page: Page, options?: ScraperOptions): Promise<Transaction[]> {
  // Wait for transactions.
  await waitUntilElementFound(page, '.under-line-txn-table-header', true);

  const txns: ScrapedTransaction[] = [];
  const transactionsDivs = await pageEvalAll<TransactionsTr[]>(
    page,
    '.list-item-holder .entire-content-ctr',
    [],
    divs => {
      return (divs as HTMLElement[]).map(div => ({
        id: div.getAttribute('id') || '',
        innerDivs: Array.from(div.getElementsByTagName('div')).map(el => (el as HTMLElement).innerText),
      }));
    },
  );

  for (const txnRow of transactionsDivs) {
    handleTransactionRow(txns, txnRow);
  }

  return convertTransactions(txns, options);
}

function getPageActionTimeoutMs(page: Page): number {
  try {
    const getter = (page as unknown as { getDefaultTimeout?: () => number }).getDefaultTimeout;
    const ms = getter?.call(page);
    if (typeof ms === 'number' && ms > 0) {
      return ms;
    }
  } catch {
    /* ignore */
  }
  return 30000;
}

const LOADING_SPINNER = '.loading-bar-spinner';

/** If the spinner is absent, `waitForSelector(..., { hidden: true })` can burn the full default timeout. */
async function waitYahavLoadingSpinnerGoneIfPresent(page: Page) {
  const timeoutMs = getPageActionTimeoutMs(page);
  if (await elementPresentOnPage(page, LOADING_SPINNER)) {
    await waitUntilElementDisappear(page, LOADING_SPINNER, timeoutMs);
  }
}

/**
 * Opens the "from" date control.
 * Waits for a date-picker in the statement area (DOM presence), scrolls it into view, then clicks.
 * Avoids `visible: true` on the compound selector — Yahav often keeps the control in DOM before Puppeteer
 * considers it "visible", which caused `Waiting for selector div.date-options-cell date-picker failed`.
 */
async function openYahavFromDatePicker(page: Page): Promise<'calendar' | 'input'> {
  const timeoutMs = getPageActionTimeoutMs(page);

  await waitYahavLoadingSpinnerGoneIfPresent(page);
  try {
    await page.waitForFunction(
      () => {
        return !!(
          document.querySelector('div.date-options-cell date-picker') ||
          document.querySelector('div.date-options-cell input') ||
          document.querySelector('div.date-options-cell [role="button"]') ||
          document.querySelector('.date-options-cell span')
        );
      },
      { timeout: timeoutMs },
    );
  } catch (error) {
    const diagnostics = await page.evaluate(() => {
      const statement = document.querySelector('.statement-options');
      return {
        statementOptionsPresent: !!statement,
        dateOptionsCellCount: document.querySelectorAll('div.date-options-cell').length,
        datePickerCount: document.querySelectorAll('date-picker').length,
        dateInputCount: document.querySelectorAll('div.date-options-cell input, input[type="date"]').length,
        roleButtonCount: document.querySelectorAll('div.date-options-cell [role="button"]').length,
      };
    });
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Yahav date trigger not found in DOM before timeout. diagnostics=${JSON.stringify(diagnostics)}. original=${message}`,
    );
  }

  const triggerSelectors = [
    'div.date-options-cell date-picker > div:nth-child(1) > span:nth-child(2)',
    'div.date-options-cell date-picker span:nth-child(2)',
    'div.date-options-cell date-picker',
    '.statement-options date-picker > div:nth-child(1) > span:nth-child(2)',
    '.statement-options date-picker span:nth-child(2)',
    '.statement-options date-picker',
    'div.date-options-cell input',
    'div.date-options-cell [role="button"]',
  ];

  const calendarSelector = '.pmu-days > div:nth-child(1)';
  const shortTimeout = Math.min(timeoutMs, 7000);
  for (const selector of triggerSelectors) {
    const clicked = await page.evaluate((s: string) => {
      const el = document.querySelector(s);
      if (!(el instanceof HTMLElement)) {
        return false;
      }
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      el.click();
      return true;
    }, selector);

    if (!clicked) {
      continue;
    }

    try {
      await waitUntilElementFound(page, calendarSelector, true, shortTimeout);
      return 'calendar';
    } catch {
      // Try next trigger in case this click did not open the calendar.
    }
  }

  const hasDateInput = await page.evaluate(() => {
    return !!document.querySelector(
      'div.date-options-cell input, .statement-options input[type="date"], .statement-options input',
    );
  });
  if (hasDateInput) {
    return 'input';
  }

  throw new Error(
    'Yahav: failed to open from-date picker. No known trigger opened calendar and no date input was found.',
  );
}

async function setYahavFromDateInput(page: Page, dateValue: string): Promise<boolean> {
  const selectors = [
    'div.date-options-cell input',
    '.statement-options input[type="date"]',
    '.statement-options input',
  ];

  for (const selector of selectors) {
    const changed = await page.evaluate(
      (s: string, value: string) => {
        const input = document.querySelector(s);
        if (!(input instanceof HTMLInputElement)) {
          return false;
        }
        input.scrollIntoView({ block: 'center', inline: 'nearest' });
        input.focus();
        input.value = '';
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new Event('blur', { bubbles: true }));
        return true;
      },
      selector,
      dateValue,
    );

    if (changed) {
      return true;
    }
  }

  return false;
}

// Manipulate the calendar drop down to choose the txs start date.
async function searchByDates(page: Page, startDate: Moment) {
  // Get the day number from startDate. 1-31 (usually 1)
  const startDateDay = startDate.format('D');
  const startDateMonth = startDate.format('M');
  const startDateYear = startDate.format('Y');

  const pickerMode = await runYahavStage('open from-date picker', () => openYahavFromDatePicker(page));
  if (pickerMode === 'input') {
    const formattedDate = startDate.format(DATE_FORMAT);
    const setInput = await runYahavStage('set from-date input', () => setYahavFromDateInput(page, formattedDate));
    if (!setInput) {
      throw new Error('Yahav: fallback input mode selected but failed to set from-date input.');
    }
    return;
  }

  // Open Months options.
  const monthFromPick = '.pmu-month';
  await runYahavStage('wait month picker', () => waitUntilElementFound(page, monthFromPick, true));
  await runYahavStage('open month options', () => clickButton(page, monthFromPick));
  await runYahavStage('wait month grid', () => waitUntilElementFound(page, '.pmu-months > div:nth-child(1)', true));

  // Open Year options.
  // Use same selector... Yahav knows why...
  await runYahavStage('wait month picker for year switch', () => waitUntilElementFound(page, monthFromPick, true));
  await runYahavStage('open year options', () => clickButton(page, monthFromPick));
  await runYahavStage('wait year grid', () => waitUntilElementFound(page, '.pmu-years > div:nth-child(1)', true));

  // Select year from a 12 year grid.
  for (let i = 1; i < 13; i += 1) {
    const selector = `.pmu-years > div:nth-child(${i})`;
    const year = await page.$eval(selector, y => {
      return (y as HTMLElement).innerText;
    });
    if (startDateYear === year) {
      await runYahavStage(`select year ${startDateYear}`, () => clickButton(page, selector));
      break;
    }
  }

  // Select Month.
  await runYahavStage('wait month grid before selecting month', () =>
    waitUntilElementFound(page, '.pmu-months > div:nth-child(1)', true),
  );
  // The first element (1) is January.
  const monthSelector = `.pmu-months > div:nth-child(${startDateMonth})`;
  await runYahavStage(`select month ${startDateMonth}`, () => clickButton(page, monthSelector));

  // Select Day.
  // The calendar grid shows 7 days and 6 weeks = 42 days.
  // In theory, the first day of the month will be in the first row.
  // Let's check everything just in case...
  for (let i = 1; i < 42; i += 1) {
    const selector = `.pmu-days > div:nth-child(${i})`;
    const day = await page.$eval(selector, d => {
      return (d as HTMLElement).innerText;
    });

    if (startDateDay === day) {
      await runYahavStage(`select day ${startDateDay}`, () => clickButton(page, selector));
      break;
    }
  }
}

async function fetchAccountData(
  page: Page,
  startDate: Moment,
  accountID: string,
  options?: ScraperOptions,
): Promise<TransactionsAccount> {
  await runYahavStage('pre-search spinner wait', () => waitYahavLoadingSpinnerGoneIfPresent(page));
  await runYahavStage('search by dates', () => searchByDates(page, startDate));
  await runYahavStage('post-search spinner wait', () => waitYahavLoadingSpinnerGoneIfPresent(page));
  const txns = await runYahavStage('fetch account transactions', () => getAccountTransactions(page, options));

  return {
    accountNumber: accountID,
    txns,
  };
}

async function fetchAccounts(page: Page, startDate: Moment, options?: ScraperOptions): Promise<TransactionsAccount[]> {
  const accounts: TransactionsAccount[] = [];

  // TODO: get more accounts. Not sure is supported.
  const accountID = await getAccountID(page);
  const accountData = await fetchAccountData(page, startDate, accountID, options);
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
  await waitYahavLoadingSpinnerGoneIfPresent(page);
  const hasMessage = await elementPresentOnPage(page, '.messaging-links-container');
  if (hasMessage) {
    await clickButton(page, '.link-1');
  }

  const promise1 = page.waitForSelector(ACCOUNT_DETAILS_SELECTOR, { timeout: 30000 });
  const promise2 = page.waitForSelector(CHANGE_PASSWORD_OLD_PASS, { timeout: 30000 });
  const promises = [promise1, promise2];

  await Promise.race(promises);
  await waitYahavLoadingSpinnerGoneIfPresent(page);
}

type ScraperSpecificCredentials = { username: string; password: string; nationalID: string };

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
    await runYahavStage('wait account details card', () =>
      waitUntilElementFound(this.page, ACCOUNT_DETAILS_SELECTOR, true),
    );
    await runYahavStage('open account details', () => clickButton(this.page, ACCOUNT_DETAILS_SELECTOR));
    await runYahavStage('wait statement options', () =>
      waitUntilElementFound(this.page, '.statement-options .selected-item-top', true),
    );
    await runYahavStage('statement spinner wait', () => waitYahavLoadingSpinnerGoneIfPresent(this.page));

    const defaultStartMoment = moment().subtract(3, 'months').add(1, 'day');
    const startDate = this.options.startDate || defaultStartMoment.toDate();
    const startMoment = moment.max(defaultStartMoment, moment(startDate));

    const accounts = await runYahavStage('fetch accounts', () => fetchAccounts(this.page, startMoment, this.options));

    return {
      success: true,
      accounts,
    };
  }
}

export default YahavScraper;
