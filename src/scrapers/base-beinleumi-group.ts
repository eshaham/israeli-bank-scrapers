import moment, { type Moment } from 'moment';
import { type Frame, type Page } from 'puppeteer';
import { SHEKEL_CURRENCY, SHEKEL_CURRENCY_SYMBOL } from '../constants';
import {
  clickButton,
  elementPresentOnPage,
  fillInput,
  pageEvalAll,
  waitUntilElementFound,
} from '../helpers/elements-interactions';
import { waitForNavigation } from '../helpers/navigation';
import { sleep } from '../helpers/waiting';
import { TransactionStatuses, TransactionTypes, type Transaction, type TransactionsAccount } from '../transactions';
import { BaseScraperWithBrowser, LoginResults, type PossibleLoginResults } from './base-scraper-with-browser';
import { type ScraperOptions } from './interface';

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
const IFRAME_NAME = 'iframe-old-pages';
const ELEMENT_RENDER_TIMEOUT_MS = 10000;

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
  urls[LoginResults.Success] = [
    /fibi.*accountSummary/, // New UI pattern
    /Resources\/PortalNG\/shell/, // New UI pattern
    /FibiMenu\/Online/, // Old UI pattern
  ];
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
  let amountStrCopy = amountStr.replace(SHEKEL_CURRENCY_SYMBOL, '');
  amountStrCopy = amountStrCopy.replaceAll(',', '');
  return parseFloat(amountStrCopy);
}

function getTxnAmount(txn: ScrapedTransaction) {
  const credit = getAmountData(txn.credit);
  const debit = getAmountData(txn.debit);
  return (Number.isNaN(credit) ? 0 : credit) - (Number.isNaN(debit) ? 0 : debit);
}

function convertTransactions(txns: ScrapedTransaction[], options?: ScraperOptions): Transaction[] {
  return txns.map((txn): Transaction => {
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
      result.rawTransaction = txn;
    }

    return result;
  });
}

function getTransactionDate(
  tds: TransactionsTrTds,
  transactionType: string,
  transactionsColsTypes: TransactionsColsTypes,
) {
  if (transactionType === 'completed') {
    return (tds[transactionsColsTypes[DATE_COLUMN_CLASS_COMPLETED]] || '').trim();
  }
  return (tds[transactionsColsTypes[DATE_COLUMN_CLASS_PENDING]] || '').trim();
}

function getTransactionDescription(
  tds: TransactionsTrTds,
  transactionType: string,
  transactionsColsTypes: TransactionsColsTypes,
) {
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

function extractTransactionDetails(
  txnRow: TransactionsTr,
  transactionStatus: TransactionStatuses,
  transactionsColsTypes: TransactionsColsTypes,
): ScrapedTransaction {
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

async function getTransactionsColsTypeClasses(
  page: Page | Frame,
  tableLocator: string,
): Promise<TransactionsColsTypes> {
  const result: TransactionsColsTypes = {};
  const typeClassesObjs = await pageEvalAll(page, `${tableLocator} tbody tr:first-of-type td`, null, tds => {
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

function extractTransaction(
  txns: ScrapedTransaction[],
  transactionStatus: TransactionStatuses,
  txnRow: TransactionsTr,
  transactionsColsTypes: TransactionsColsTypes,
) {
  const txn = extractTransactionDetails(txnRow, transactionStatus, transactionsColsTypes);
  if (txn.date !== '') {
    txns.push(txn);
  }
}

async function extractTransactions(page: Page | Frame, tableLocator: string, transactionStatus: TransactionStatuses) {
  const txns: ScrapedTransaction[] = [];
  const transactionsColsTypes = await getTransactionsColsTypeClasses(page, tableLocator);

  const transactionsRows = await pageEvalAll<TransactionsTr[]>(page, `${tableLocator} tbody tr`, [], trs => {
    return trs.map(tr => ({
      innerTds: Array.from(tr.getElementsByTagName('td')).map(td => td.innerText),
    }));
  });

  for (const txnRow of transactionsRows) {
    extractTransaction(txns, transactionStatus, txnRow, transactionsColsTypes);
  }
  return txns;
}

async function isNoTransactionInDateRangeError(page: Page | Frame) {
  const hasErrorInfoElement = await elementPresentOnPage(page, `.${ERROR_MESSAGE_CLASS}`);
  if (hasErrorInfoElement) {
    const errorText = await page.$eval(`.${ERROR_MESSAGE_CLASS}`, errorElement => {
      return (errorElement as HTMLElement).innerText;
    });
    return errorText.trim() === NO_TRANSACTION_IN_DATE_RANGE_TEXT;
  }
  return false;
}

async function searchByDates(page: Page | Frame, startDate: Moment) {
  await clickButton(page, 'a#tabHeader4');
  await waitUntilElementFound(page, 'div#fibi_dates');
  await fillInput(page, 'input#fromDate', startDate.format(DATE_FORMAT));
  await clickButton(page, `button[class*=${CLOSE_SEARCH_BY_DATES_BUTTON_CLASS}]`);
  await clickButton(page, `input[value=${SHOW_SEARCH_BY_DATES_BUTTON_VALUE}]`);
  await waitForNavigation(page);
}

async function getAccountNumber(page: Page | Frame): Promise<string> {
  // Wait until the account number element is present in the DOM
  await waitUntilElementFound(page, ACCOUNTS_NUMBER, true, ELEMENT_RENDER_TIMEOUT_MS);

  const selectedSnifAccount = await page.$eval(ACCOUNTS_NUMBER, option => {
    return (option as HTMLElement).innerText;
  });

  return selectedSnifAccount.replace('/', '_').trim();
}

async function checkIfHasNextPage(page: Page | Frame) {
  return elementPresentOnPage(page, NEXT_PAGE_LINK);
}

async function navigateToNextPage(page: Page | Frame) {
  await clickButton(page, NEXT_PAGE_LINK);
  await waitForNavigation(page);
}

/* Couldn't reproduce scenario with multiple pages of pending transactions - Should support if exists such case.
   needToPaginate is false if scraping pending transactions */
async function scrapeTransactions(
  page: Page | Frame,
  tableLocator: string,
  transactionStatus: TransactionStatuses,
  needToPaginate: boolean,
  options?: ScraperOptions,
) {
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

  return convertTransactions(txns, options);
}

async function getAccountTransactions(page: Page | Frame, options?: ScraperOptions) {
  await Promise.race([
    waitUntilElementFound(page, "div[id*='divTable']", false),
    waitUntilElementFound(page, `.${ERROR_MESSAGE_CLASS}`, false),
  ]);

  const noTransactionInRangeError = await isNoTransactionInDateRangeError(page);
  if (noTransactionInRangeError) {
    return [];
  }

  const pendingTxns = await scrapeTransactions(
    page,
    PENDING_TRANSACTIONS_TABLE,
    TransactionStatuses.Pending,
    false,
    options,
  );
  const completedTxns = await scrapeTransactions(
    page,
    COMPLETED_TRANSACTIONS_TABLE,
    TransactionStatuses.Completed,
    true,
    options,
  );
  const txns = [...pendingTxns, ...completedTxns];
  return txns;
}

async function getCurrentBalance(page: Page | Frame): Promise<number> {
  // Wait for the balance element to appear and be visible
  await waitUntilElementFound(page, CURRENT_BALANCE, true, ELEMENT_RENDER_TIMEOUT_MS);

  // Extract text content
  const balanceStr = await page.$eval(CURRENT_BALANCE, el => {
    return (el as HTMLElement).innerText;
  });

  return getAmountData(balanceStr);
}

export async function waitForPostLogin(page: Page) {
  return Promise.race([
    waitUntilElementFound(page, '#card-header', false), // New UI
    waitUntilElementFound(page, '#account_num', true), // New UI
    waitUntilElementFound(page, '#matafLogoutLink', true), // Old UI
    waitUntilElementFound(page, '#validationMsg', true), // Old UI
  ]);
}

async function fetchAccountData(page: Page | Frame, startDate: Moment, options?: ScraperOptions) {
  const accountNumber = await getAccountNumber(page);
  const balance = await getCurrentBalance(page);
  await searchByDates(page, startDate);
  const txns = await getAccountTransactions(page, options);

  return {
    accountNumber,
    txns,
    balance,
  };
}

async function getAccountIdsOldUI(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const selectElement = document.getElementById('account_num_select');
    const options = selectElement ? selectElement.querySelectorAll('option') : [];
    if (!options) return [];
    return Array.from(options, option => option.value);
  });
}

/**
 * Ensures the account dropdown is open, then returns the available account labels.
 *
 * This method:
 * - Checks if the dropdown is already open.
 * - If not open, clicks the account selector to open it.
 * - Waits for the dropdown to render.
 * - Extracts and returns the list of available account labels.
 *
 * Graceful handling:
 * - If any error occurs (e.g., selectors not found, timing issues, UI version changes),
 *   the function returns an empty list.
 *
 * @param page Puppeteer Page object.
 * @returns An array of available account labels (e.g., ["127 | XXXX1", "127 | XXXX2"]),
 *          or an empty array if something goes wrong.
 */
export async function clickAccountSelectorGetAccountIds(page: Page): Promise<string[]> {
  try {
    const accountSelector = 'div.current-account'; // Direct selector to clickable element
    const dropdownPanelSelector = 'div.mat-mdc-autocomplete-panel.account-select-dd'; // The dropdown list box
    const optionSelector = 'mat-option .mdc-list-item__primary-text'; // Account option labels

    // Check if dropdown is already open
    const dropdownVisible = await page
      .$eval(dropdownPanelSelector, el => {
        return el && window.getComputedStyle(el).display !== 'none' && el.offsetParent !== null;
      })
      .catch(() => false); // catch if dropdown is not in the DOM yet

    if (!dropdownVisible) {
      await waitUntilElementFound(page, accountSelector, true, ELEMENT_RENDER_TIMEOUT_MS);

      // Click the account selector to open the dropdown
      await clickButton(page, accountSelector);

      // Wait for the dropdown to open
      await waitUntilElementFound(page, dropdownPanelSelector, true, ELEMENT_RENDER_TIMEOUT_MS);
    }

    // Extract account labels from the dropdown options
    const accountLabels = await page.$$eval(optionSelector, options => {
      return options.map(option => option.textContent?.trim() || '').filter(label => label !== '');
    });

    return accountLabels;
  } catch (error) {
    return []; // Graceful fallback
  }
}

async function getAccountIdsBothUIs(page: Page): Promise<string[]> {
  let accountsIds: string[] = await clickAccountSelectorGetAccountIds(page);
  if (accountsIds.length === 0) {
    accountsIds = await getAccountIdsOldUI(page);
  }
  return accountsIds;
}

/**
 * Selects an account from the dropdown based on the provided account label.
 *
 * This method:
 * - Clicks the account selector button to open the dropdown.
 * - Retrieves the list of available account labels.
 * - Checks if the provided account label exists in the list.
 * - Finds and clicks the matching account option if found.
 *
 * @param page Puppeteer Page object.
 * @param accountLabel The text of the account to select (e.g., "127 | XXXXX").
 * @returns True if the account option was found and clicked; false otherwise.
 */
export async function selectAccountFromDropdown(page: Page, accountLabel: string): Promise<boolean> {
  // Call clickAccountSelector to get the available accounts and open the dropdown
  const availableAccounts = await clickAccountSelectorGetAccountIds(page);

  // Check if the account label exists in the available accounts
  if (!availableAccounts.includes(accountLabel)) {
    return false;
  }

  // Wait for the dropdown options to be rendered
  const optionSelector = 'mat-option .mdc-list-item__primary-text';
  await waitUntilElementFound(page, optionSelector, true, ELEMENT_RENDER_TIMEOUT_MS);

  // Query all matching options
  const accountOptions = await page.$$(optionSelector);

  // Find and click the option matching the accountLabel
  for (const option of accountOptions) {
    const text = await page.evaluate(el => el.textContent?.trim(), option);

    if (text === accountLabel) {
      const optionHandle = await option.evaluateHandle(el => el as HTMLElement);
      await page.evaluate((el: HTMLElement) => el.click(), optionHandle);
      return true;
    }
  }

  return false;
}

async function getTransactionsFrame(page: Page): Promise<Frame | null> {
  // Try a few times to find the iframe, as it might not be immediately available
  for (let attempt = 0; attempt < 3; attempt++) {
    await sleep(2000);
    const frames = page.frames();
    const targetFrame = frames.find(f => f.name() === IFRAME_NAME);

    if (targetFrame) {
      return targetFrame;
    }
  }

  return null;
}

async function selectAccountBothUIs(page: Page, accountId: string): Promise<void> {
  const accountSelected = await selectAccountFromDropdown(page, accountId);
  if (!accountSelected) {
    // Old UI format
    await page.select('#account_num_select', accountId);
    await waitUntilElementFound(page, '#account_num_select', true);
  }
}

async function fetchAccountDataBothUIs(
  page: Page,
  startDate: Moment,
  options?: ScraperOptions,
): Promise<TransactionsAccount> {
  // Try to get the iframe for the new UI
  const frame = await getTransactionsFrame(page);

  // Use the frame if available (new UI), otherwise use the page directly (old UI)
  const targetPage = frame || page;
  return fetchAccountData(targetPage, startDate, options);
}

async function fetchAccounts(page: Page, startDate: Moment, options?: ScraperOptions): Promise<TransactionsAccount[]> {
  const accountsIds = await getAccountIdsBothUIs(page);

  if (accountsIds.length === 0) {
    // In case accountsIds could no be parsed just return the transactions of the currently selected account
    const accountData = await fetchAccountDataBothUIs(page, startDate, options);
    return [accountData];
  }

  const accounts: TransactionsAccount[] = [];
  for (const accountId of accountsIds) {
    await selectAccountBothUIs(page, accountId);
    const accountData = await fetchAccountDataBothUIs(page, startDate, options);
    accounts.push(accountData);
  }

  return accounts;
}

type ScraperSpecificCredentials = { username: string; password: string };

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
    const startMomentLimit = moment({ year: 1600 });
    const startDate = this.options.startDate || defaultStartMoment.toDate();
    const startMoment = moment.max(startMomentLimit, moment(startDate));

    await this.navigateTo(this.TRANSACTIONS_URL);

    const accounts = await fetchAccounts(this.page, startMoment, this.options);

    return {
      success: true,
      accounts,
    };
  }
}

export default BeinleumiGroupBaseScraper;
