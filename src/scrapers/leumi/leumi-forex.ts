import moment, { type Moment } from 'moment';
import { type Page } from 'puppeteer';
import { DOLLAR_CURRENCY, EURO_CURRENCY, SHEKEL_CURRENCY } from '../../constants';
import { getDebug } from '../../helpers/debug';
import { clickButton, fillInput, waitUntilElementFound } from '../../helpers/elements-interactions';
import { getRawTransaction } from '../../helpers/transactions';
import { TransactionStatuses, TransactionTypes, type Transaction, type TransactionsAccount } from '../../transactions';
import { type ScraperOptions } from '../interface';

const debug = getDebug('leumi-forex');
const BASE_URL = 'https://hb2.bankleumi.co.il';
const FOREIGN_CURRENCY_URL = `${BASE_URL}/eBanking/ForeignCurrency/DisplayForeignAccountsActivity.aspx`;

const FOREIGN_ACCOUNTS_SELECTOR = '#ddlAccounts_m_ddl';
const FOREIGN_PERIOD_SELECTOR = '#ddlTransactionPeriod';
const FOREIGN_FROM_DATE_SELECTOR = '#dtFromDate_textBox';
const FOREIGN_SUBMIT_SELECTOR = '#btnDisplayDates';
const FOREIGN_ACTIVITY_TABLE_SELECTOR = '#ctlActivityTable';
const FOREIGN_CURRENCY_LABEL_SELECTOR = '#lblCurrencyVal';
const FOREIGN_OPENING_BALANCE_SELECTOR = '#lblOpeningBalanceVal';
const FOREIGN_NO_DATA_SELECTOR = '#NOINFORMATIONREGIONSERVERSIDEERROR';

// value of the "by dates" option in the transaction period dropdown
const FOREIGN_PERIOD_BY_DATES = '3';
const FOREIGN_NO_DATA_MSG = 'לא קיימות תנועות מתאימות על פי הסינון שהוגדר';
const FOREIGN_DATE_FORMAT = 'DD/MM/YY';

// Both the activity table and the "no transactions" notice are waited on together, so once
// one of them is visible a second, very short wait is enough to tell which one it was.
const FOREIGN_SETTLED_TIMEOUT = 1000;

// column layout of the foreign currency activity table
const FOREIGN_COLUMN_DATE = 0;
const FOREIGN_COLUMN_DESCRIPTION = 1;
const FOREIGN_COLUMN_REFERENCE = 2;
const FOREIGN_COLUMN_DEBIT = 3;
const FOREIGN_COLUMN_CREDIT = 4;
const FOREIGN_COLUMN_BALANCE = 5;
const FOREIGN_COLUMN_COUNT = 6;

const DATE_FORMAT = 'DD.MM.YY';

function removeSpecialCharacters(str: string): string {
  return str.replace(/[^0-9/-]/g, '');
}

function hangProcess(timeout: number) {
  return new Promise<void>(resolve => {
    setTimeout(() => {
      resolve();
    }, timeout);
  });
}

const FOREIGN_CURRENCY_BY_LABEL: Record<string, string> = {
  דולר: DOLLAR_CURRENCY,
  'דולר ארהב': DOLLAR_CURRENCY,
  אירו: EURO_CURRENCY,
  יורו: EURO_CURRENCY,
  'לירה שטרלינג': 'GBP',
  'פרנק שוויצרי': 'CHF',
  'יין יפני': 'JPY',
  'דולר קנדי': 'CAD',
  'דולר אוסטרלי': 'AUD',
  'כתר שוודי': 'SEK',
  'כתר נורווגי': 'NOK',
  'כתר דני': 'DKK',
  רנד: 'ZAR',
  שקל: SHEKEL_CURRENCY,
  שח: SHEKEL_CURRENCY,
};

/**
 * Leumi renders the currency as a Hebrew label rather than an ISO code, and the exact
 * punctuation varies (for example `דולר ארה"ב` vs `דולר ארה''ב`), so quotes and
 * whitespace are stripped before matching.
 */
export function mapForeignCurrency(label: string): string | undefined {
  const normalized = label
    .replace(/["'`׳״]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) {
    return undefined;
  }

  if (FOREIGN_CURRENCY_BY_LABEL[normalized]) {
    return FOREIGN_CURRENCY_BY_LABEL[normalized];
  }

  // Longest label first, otherwise `דולר קנדי` would match the `דולר` entry.
  const match = Object.keys(FOREIGN_CURRENCY_BY_LABEL)
    .sort((a, b) => b.length - a.length)
    .find(key => normalized.includes(key));
  return match ? FOREIGN_CURRENCY_BY_LABEL[match] : undefined;
}

export function parseForeignAmount(cellText: string): number {
  const parsed = parseFloat((cellText || '').replace(/,/g, '').replace(/[^\d.-]/g, ''));
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * A row carries the amount in either the debit or the credit column, never both.
 */
export function getForeignTransactionAmount(debitCellText: string, creditCellText: string): number {
  const credit = parseForeignAmount(creditCellText);
  if (credit > 0) {
    return credit;
  }

  return -parseForeignAmount(debitCellText);
}

export function mapForeignTransaction(cells: string[], currency: string, options?: ScraperOptions): Transaction {
  const date = moment(cells[FOREIGN_COLUMN_DATE], FOREIGN_DATE_FORMAT).milliseconds(0).toISOString();
  const amount = getForeignTransactionAmount(cells[FOREIGN_COLUMN_DEBIT], cells[FOREIGN_COLUMN_CREDIT]);

  const transaction: Transaction = {
    type: TransactionTypes.Normal,
    identifier: cells[FOREIGN_COLUMN_REFERENCE] || undefined,
    date,
    processedDate: date,
    originalAmount: amount,
    originalCurrency: currency,
    chargedAmount: amount,
    chargedCurrency: currency,
    description: cells[FOREIGN_COLUMN_DESCRIPTION] || '',
    status: TransactionStatuses.Completed,
  };

  if (options?.includeRawTransaction) {
    transaction.rawTransaction = getRawTransaction(cells);
  }

  return transaction;
}

async function readTrimmedText(page: Page, selector: string): Promise<string> {
  try {
    return await page.$eval(selector, node => (node as HTMLElement).innerText.trim());
  } catch (error) {
    debug('could not read %s: %s', selector, error);
    return '';
  }
}

/**
 * Resolves to true when the activity table rendered, false when Leumi reported that the
 * account has no transactions in the requested range. Both outcomes render their own
 * element, so waiting on either avoids paying the full timeout for empty accounts.
 */
async function waitForForeignActivityTable(page: Page): Promise<boolean> {
  try {
    await waitUntilElementFound(page, `${FOREIGN_ACTIVITY_TABLE_SELECTOR}, ${FOREIGN_NO_DATA_SELECTOR}`, true);
    await waitUntilElementFound(page, FOREIGN_ACTIVITY_TABLE_SELECTOR, true, FOREIGN_SETTLED_TIMEOUT);
    return true;
  } catch (error) {
    debug('no activity table found, looking for the "no matching transactions" notice');
  }

  const message = await readTrimmedText(page, FOREIGN_NO_DATA_SELECTOR);
  if (!message.includes(FOREIGN_NO_DATA_MSG)) {
    debug('unexpected foreign currency page state, message: "%s"', message);
  }

  return false;
}

async function fetchForeignCurrencyAccount(
  page: Page,
  startDate: Moment,
  account: { value: string; text: string },
  options: ScraperOptions,
): Promise<TransactionsAccount | null> {
  debug('fetching foreign currency account %s', account.text);

  await page.select(FOREIGN_ACCOUNTS_SELECTOR, account.value);
  await page.select(FOREIGN_PERIOD_SELECTOR, FOREIGN_PERIOD_BY_DATES);
  await fillInput(page, FOREIGN_FROM_DATE_SELECTOR, startDate.format(DATE_FORMAT));
  await clickButton(page, FOREIGN_SUBMIT_SELECTOR);

  const hasActivityTable = await waitForForeignActivityTable(page);

  // The currency and balance labels describe the account that is currently displayed,
  // so they must be read only after the selection above has been submitted.
  const currencyLabel = await readTrimmedText(page, FOREIGN_CURRENCY_LABEL_SELECTOR);
  const currency = mapForeignCurrency(currencyLabel);
  if (!currency) {
    debug('skipping account %s, unrecognised currency "%s"', account.text, currencyLabel);
    return null;
  }

  const openingBalance = parseForeignAmount(await readTrimmedText(page, FOREIGN_OPENING_BALANCE_SELECTOR));
  const accountId = removeSpecialCharacters(account.text);
  if (!accountId) {
    debug('skipping account option "%s", it does not contain an account number', account.text);
    return null;
  }

  const accountNumber = `${accountId}-${currency}`;

  if (!hasActivityTable) {
    debug('account %s has no transactions in the requested range', accountNumber);
    return openingBalance === 0 ? null : { accountNumber, balance: openingBalance, currency, txns: [] };
  }

  const rows = await page.$$eval(`${FOREIGN_ACTIVITY_TABLE_SELECTOR} tr:not(.header)`, trs =>
    Array.from(trs, tr => Array.from(tr.querySelectorAll('td'), column => column.innerText.trim() || '')),
  );

  const parsedRows = rows
    .filter(cells => cells.length >= FOREIGN_COLUMN_COUNT)
    .map(cells => ({
      transaction: mapForeignTransaction(cells, currency, options),
      runningBalance: parseForeignAmount(cells[FOREIGN_COLUMN_BALANCE]),
    }));

  // Leumi reports a running balance per row; the row holding the current balance is
  // therefore whichever end of the table is the most recent. Comparing the two ends
  // detects the sort direction without assuming one, and keeps DOM order as the
  // tie-breaker for several transactions sharing a date.
  const firstRow = parsedRows[0];
  const lastRow = parsedRows[parsedRows.length - 1];
  const latestRow = firstRow && lastRow && firstRow.transaction.date > lastRow.transaction.date ? firstRow : lastRow;

  const balance = latestRow ? latestRow.runningBalance : openingBalance;
  if (balance === 0 && parsedRows.length === 0) {
    debug('skipping account %s, it is empty', accountNumber);
    return null;
  }

  debug('found %d transactions for account %s', parsedRows.length, accountNumber);

  return {
    accountNumber,
    balance,
    currency,
    txns: parsedRows.map(row => row.transaction),
  };
}

export async function fetchForeignCurrencyAccounts(
  page: Page,
  startDate: Moment,
  options: ScraperOptions,
): Promise<TransactionsAccount[]> {
  debug('========== FETCHING FOREIGN CURRENCY ACCOUNTS ==========');
  const accounts: TransactionsAccount[] = [];

  try {
    await page.goto(FOREIGN_CURRENCY_URL, { waitUntil: 'networkidle2' });

    // DEVELOPER NOTICE the account number received from the server is being altered at
    // runtime for some accounts after 1-2 seconds so we need to hang the process for a short while.
    await hangProcess(4000);

    await waitUntilElementFound(page, FOREIGN_ACCOUNTS_SELECTOR, true);

    const accountOptions = await page.$$eval(`${FOREIGN_ACCOUNTS_SELECTOR} option`, elements =>
      Array.from(elements, element => ({ value: element.value, text: element.text })).filter(option => !!option.value),
    );

    debug('found %d foreign currency accounts', accountOptions.length);

    // Each iteration drives the same page, so the accounts must be fetched sequentially.
    for (const accountOption of accountOptions) {
      try {
        const account = await fetchForeignCurrencyAccount(page, startDate, accountOption, options);
        if (account) {
          accounts.push(account);
        }
      } catch (error) {
        debug('error fetching foreign currency account %s: %s', accountOption.text, error);
      }
    }
  } catch (error) {
    debug('error fetching foreign currency accounts: %s', error);
  }

  debug('returning %d foreign currency accounts', accounts.length);
  return accounts;
}
