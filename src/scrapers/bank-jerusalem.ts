import moment, { type Moment } from 'moment';
import { type Page } from 'puppeteer';
import { SHEKEL_CURRENCY } from '../constants';
import {
  clickButton,
  dropdownSelect,
  elementPresentOnPage,
  fillInput,
  pageEval,
  pageEvalAll,
  waitUntilElementFound,
} from '../helpers/elements-interactions';
import { getRawTransaction } from '../helpers/transactions';
import { sleep, waitUntil } from '../helpers/waiting';
import { TransactionStatuses, TransactionTypes, type Transaction, type TransactionsAccount } from '../transactions';
import { BaseScraperWithBrowser, LoginResults, type PossibleLoginResults } from './base-scraper-with-browser';
import { type ScraperOptions } from './interface';

const BASE_URL = 'https://services.bankjerusalem.co.il';
const LOGIN_URL = `${BASE_URL}/Pages/Login.aspx`;
const ACCOUNT_URL = `${BASE_URL}/currentaccount/pages/current.aspx`;
const DEPOSITS_URL = `${BASE_URL}/savingsanddeposits/pages/deposits-savings.aspx`;

// The login page has a second tab, for logging in with a code sent to the mobile.
const PASSWORD_TAB_TEXTS = ['כניסה עם שם משתמש וסיסמה', 'שם משתמש וסיסמה', 'כניסה עם סיסמה'];
const SUBMIT_TEXTS = ['כניסה', 'כניסה לחשבון', 'התחברות', 'התחבר', 'המשך'];
// The login form's fields are marked by markLoginForm(), so the selectors don't depend
// on the form's generated ids.
const USERNAME_SELECTOR = '[data-ibs-login="username"]';
const PASSWORD_SELECTOR = '[data-ibs-login="password"]';
const SUBMIT_SELECTOR = '[data-ibs-login="submit"]';
// "אחד או יותר מפרטי הזהות שהזנת שגוי. אנא הזן את הפרטים שנית."
const INVALID_PASSWORD_TEXT = /אחד או יותר מפרטי הזהות שהזנת שגוי/;

const LOGOUT_SELECTOR = 'input.logoutAndPersonalDetailsBtn, .LogoutAndPersonalDetails a.logout';
const HOME_BALANCE_SELECTOR = '#HPCurrentAccountZone .TotalRevaluedBalance';
const TXN_TABLE_SELECTOR = 'table.CurrentAccountLastTransactions';
const ACCOUNT_LINE_SELECTOR = '.LayoutWidePageTitles span';
const PERIOD_SELECTOR = 'select#PeriodFilter';
const PERIOD_DATE_RANGE = 'none'; // "בחירת טווח תאריכים"
const FROM_DATE_SELECTOR = 'input#fromDate';
const CONTINUE_SELECTOR = '.ContinueButton button';
const SEARCH_DATE_FORMAT = 'DD.MM.YYYY';
const DEPOSIT_CARD_SELECTOR = '.depositsAndLoans.Deposits .depositsEntry';

const DATE_FORMATS = ['DD/MM/YYYY', 'DD/MM/YY', 'DD.MM.YYYY', 'DD.MM.YY'];
const LOGIN_RESULT_TIMEOUT = 60000;

type ScraperSpecificCredentials = {
  username: string;
  password: string;
};

export interface ScrapedTable {
  headers: string[];
  rows: string[][];
}

export interface ScrapedDepositCard {
  name: string;
  number: string;
  fields: [string, string][];
}

interface ScrapedTransaction {
  date: Moment;
  description: string;
  reference: string;
  amount: number;
  balance: number | null;
}

const clean = (text: string | null | undefined) =>
  (text ?? '')
    .replace(/[‎‏‪-‮]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

// "1,234.56", "₪ -1,234.56", "1,234.56-" (the bank prints the minus after the number) or "(1,234.56)".
export function parseAmount(text: string | null | undefined): number | null {
  const t = clean(text).replace(/−/g, '-');
  const match = /(-)?\s*(?:₪|ש["״]ח)?\s*(-)?\s*(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(-)?/.exec(t);
  if (!match) {
    return null;
  }
  const value = Number(match[3].replace(/,/g, '') + (match[4] ?? ''));
  if (!Number.isFinite(value)) {
    return null;
  }
  const negative = !!(match[1] || match[2] || match[5]) || /^\(.*\)$/.test(t);
  return Math.round((negative ? -value : value) * 100) / 100 || 0;
}

export function parseDate(text: string | null | undefined): Moment | null {
  const date = moment(clean(text), DATE_FORMATS, true);
  return date.isValid() ? date : null;
}

// The account page's table (תאריך, תיאור, אסמכתא, סכום, יתרה), its columns found by their headings.
function transactionsFromTable({ headers, rows }: ScrapedTable): ScrapedTransaction[] {
  const column = (re: RegExp) => headers.findIndex(h => re.test(clean(h)));
  const dateColumn = headers.findIndex(h => /תאריך/.test(h) && !/ערך/.test(h));
  const descriptionColumn = column(/תיאור/);
  const referenceColumn = column(/אסמכתא/);
  const amountColumn = column(/סכום/);
  const balanceColumn = column(/יתרה/);
  if (dateColumn < 0 || amountColumn < 0) {
    return [];
  }
  return rows.flatMap(row => {
    const date = parseDate(row[dateColumn]);
    const amount = parseAmount(row[amountColumn]);
    if (!date || amount === null) {
      return [];
    }
    return [
      {
        date,
        description: clean(row[descriptionColumn]),
        reference: clean(row[referenceColumn]).replace(/\D/g, ''),
        amount,
        balance: balanceColumn >= 0 ? parseAmount(row[balanceColumn]) : null,
      },
    ];
  });
}

export function convertTransactions(
  table: ScrapedTable,
  startMoment: Moment,
  options?: Pick<ScraperOptions, 'includeRawTransaction'>,
): Transaction[] {
  return transactionsFromTable(table)
    .filter(txn => !txn.date.isBefore(startMoment, 'day'))
    .map(txn => {
      const date = txn.date.toISOString();
      const result: Transaction = {
        type: TransactionTypes.Normal,
        identifier: txn.reference ? Number(txn.reference) : undefined,
        date,
        processedDate: date,
        originalAmount: txn.amount,
        originalCurrency: SHEKEL_CURRENCY,
        chargedAmount: txn.amount,
        description: txn.description,
        status: TransactionStatuses.Completed,
      };
      if (options?.includeRawTransaction) {
        result.rawTransaction = getRawTransaction({ ...txn, date: txn.date.format('YYYY-MM-DD') });
      }
      return result;
    });
}

// The balance after the newest transaction. The page lists them oldest first, so on a day with
// several, the last row is the newest.
export function newestBalance(table: ScrapedTable): number | null {
  const withBalance = transactionsFromTable(table).filter(txn => txn.balance !== null);
  const newest = withBalance.reduce<ScrapedTransaction | null>(
    (latest, txn) => (!latest || !txn.date.isBefore(latest.date, 'day') ? txn : latest),
    null,
  );
  return newest?.balance ?? null;
}

// "… 012-345678901 | ₪ | …" under the account page's title.
export function parseAccountNumber(line: string): string | null {
  return /\d+-\d{4,}/.exec(clean(line))?.[0] ?? null;
}

// Each deposit is its own savings account, as the Leumi scraper reports them. Its balance is
// the revalued balance (יתרה משוערכת), or the deposited amount when the card doesn't show one.
export function convertDepositCards(accountNumber: string, cards: ScrapedDepositCard[]): TransactionsAccount[] {
  return cards.map(card => {
    const field = (re: RegExp) => card.fields.find(([name]) => re.test(clean(name)))?.[1];
    const number = clean(card.number).replace(/\D/g, '');
    const balance = parseAmount(field(/^יתרה משוערכת\s*\(ליום/)) ?? parseAmount(field(/^סכום מקורי/));
    return {
      accountNumber: `${accountNumber}-${number}`,
      savingsAccount: true,
      balance: balance ?? undefined,
      currency: SHEKEL_CURRENCY,
      txns: [],
    };
  });
}

async function pageText(page: Page) {
  return page.evaluate(() => document.body?.innerText ?? '').catch(() => '');
}

async function isLoggedIn(page: Page) {
  const url = new URL(page.url());
  if (url.hostname !== new URL(BASE_URL).hostname || /\/login\.aspx$/i.test(url.pathname)) {
    return false;
  }
  // The page can be in the middle of navigating, which makes the check throw.
  return elementPresentOnPage(page, LOGOUT_SELECTOR).catch(() => false);
}

function getPossibleLoginResults(page: Page): PossibleLoginResults {
  return {
    [LoginResults.Success]: [async () => isLoggedIn(page)],
    [LoginResults.InvalidPassword]: [async () => INVALID_PASSWORD_TEXT.test(await pageText(page))],
  };
}

// The account page shows the last 30 days: picks a date range from startMoment to today.
async function searchByDates(page: Page, startMoment: Moment) {
  await dropdownSelect(page, PERIOD_SELECTOR, PERIOD_DATE_RANGE);
  await fillInput(page, FROM_DATE_SELECTOR, startMoment.format(SEARCH_DATE_FORMAT));
  await page.$eval(FROM_DATE_SELECTOR, input => (input as HTMLElement).blur());
  // The rows of the last 30 days are marked, to tell when the date range's rows replace them.
  await page.$$eval(`${TXN_TABLE_SELECTOR} tr`, rows => rows.forEach(row => row.setAttribute('data-ibs-old', '')));
  await clickButton(page, CONTINUE_SELECTOR);
  await waitUntil(
    () =>
      page
        .$$eval(
          `${TXN_TABLE_SELECTOR} tr`,
          rows => rows.length > 0 && rows.every(row => !row.hasAttribute('data-ibs-old')),
        )
        // The page can be in the middle of loading, which makes the check throw.
        .catch(() => false),
    'transactions for the date range',
    30000,
    500,
  );
}

// Waits until the login is done or the page says the password is wrong.
async function waitForLoginResult(page: Page) {
  await waitUntil(
    async () => (await isLoggedIn(page)) || INVALID_PASSWORD_TEXT.test(await pageText(page)),
    'login result',
    LOGIN_RESULT_TIMEOUT,
    1000,
  );
}

// Picks the username and password tab if it isn't open, and marks the form's fields and its
// submit button with data-ibs-login: the visible password input, the visible text input before
// it, and the button that says one of SUBMIT_TEXTS (or the form's submit button).
async function markLoginForm(page: Page) {
  await page.evaluate(tabTexts => {
    const tab = [...document.querySelectorAll<HTMLElement>('a, button, [role=tab]')].find(el =>
      tabTexts.some(text => el.innerText?.trim() === text),
    );
    if (tab && tab.getAttribute('aria-selected') !== 'true') tab.click();
  }, PASSWORD_TAB_TEXTS);

  await waitUntil(
    () =>
      page
        .evaluate(submitTexts => {
          const shown = (el: Element) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          };
          const inputs = [...document.querySelectorAll('input')].filter(shown);
          const password = inputs.find(el => el.type === 'password');
          if (!password) return false;
          const before = inputs.slice(0, inputs.indexOf(password));
          const username = before.reverse().find(el => ['text', 'email', 'tel', ''].includes(el.type));
          const scope = password.form ?? document;
          const buttons = [...scope.querySelectorAll<HTMLElement>('button, input[type=submit], [role=button]')].filter(
            shown,
          );
          const label = (el: HTMLElement) => (el instanceof HTMLInputElement ? el.value : el.innerText).trim();
          const submit =
            buttons.find(el => submitTexts.includes(label(el))) ??
            buttons.find(el => (el as HTMLButtonElement).type === 'submit');
          if (!username || !submit) return false;
          username.setAttribute('data-ibs-login', 'username');
          password.setAttribute('data-ibs-login', 'password');
          submit.setAttribute('data-ibs-login', 'submit');
          return true;
        }, SUBMIT_TEXTS)
        // The bot check reloads the login page, which makes evaluate throw.
        .catch(() => false),
    'login form to show',
    30000,
    1000,
  );
}

class BankJerusalemScraper extends BaseScraperWithBrowser<ScraperSpecificCredentials> {
  getLoginOptions(credentials: ScraperSpecificCredentials) {
    return {
      loginUrl: LOGIN_URL,
      checkReadiness: async () => markLoginForm(this.page),
      fields: [
        { selector: USERNAME_SELECTOR, value: credentials.username },
        { selector: PASSWORD_SELECTOR, value: credentials.password },
      ],
      submitButtonSelector: SUBMIT_SELECTOR,
      postAction: async () => waitForLoginResult(this.page),
      possibleResults: getPossibleLoginResults(this.page),
    };
  }

  async fetchData() {
    const defaultStartMoment = moment().subtract(1, 'years').add(1, 'day');
    const startMoment = moment.max(defaultStartMoment, moment(this.options.startDate || defaultStartMoment.toDate()));

    // The home page, where the login ends, shows the current account's balance.
    // It shows up after the page has loaded.
    await waitUntilElementFound(this.page, HOME_BALANCE_SELECTOR, true, 15000).catch(() => {});
    const homeBalance = parseAmount(
      await pageEval(this.page, HOME_BALANCE_SELECTOR, '', el => (el as HTMLElement).innerText),
    );

    await this.navigateTo(ACCOUNT_URL);
    await waitUntilElementFound(this.page, TXN_TABLE_SELECTOR, true, 30000);
    await searchByDates(this.page, startMoment);
    const table = await pageEval(this.page, TXN_TABLE_SELECTOR, { headers: [], rows: [] }, el => {
      const text = (cell: Element) => (cell as HTMLElement).innerText.replace(/\s+/g, ' ').trim();
      // An amount the site marks as negative (by its class, or a minus in its aria-label, "סכום - -12.34")
      // gets a minus if its text has none.
      const cellText = (cell: HTMLTableCellElement) => {
        const value = text(cell);
        const label = cell.querySelector('[aria-label]')?.getAttribute('aria-label') ?? '';
        const negative = /\bNegative\b/.test(cell.className) || /^[^-]+-\s+-/.test(label);
        return negative && /\d/.test(value) && !/[-−(]/.test(value) ? `-${value}` : value;
      };
      const tableEl = el as HTMLTableElement;
      return {
        headers: [...(tableEl.tHead?.rows[0]?.cells ?? [])].map(text),
        rows: [...tableEl.tBodies].flatMap(body => [...body.rows]).map(row => [...row.cells].map(cellText)),
      };
    });
    const txns = convertTransactions(table, startMoment, this.options);
    const balance = homeBalance ?? newestBalance(table);
    const titleLines = await pageEvalAll(this.page, ACCOUNT_LINE_SELECTOR, [], spans =>
      spans.map(span => span.textContent ?? ''),
    );
    const accountNumber = parseAccountNumber(titleLines.find(line => line.includes('|')) ?? '') ?? 'unknown';

    await this.navigateTo(DEPOSITS_URL);
    await sleep(2000);
    // A card's fields under "למידע נוסף" are hidden until it's opened: textContent reads them anyway.
    const cards = await pageEvalAll(this.page, DEPOSIT_CARD_SELECTOR, [], elements =>
      elements.map(card => {
        const all = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
        return {
          name: all(card.querySelector('.depositTitleName')),
          number: all(card.querySelector('.depositTitleNumber')),
          fields: [...card.querySelectorAll('.detailsName')]
            .map((name): [string, string] => [all(name), all(name.parentElement?.querySelector('.detailsValue'))])
            .filter(([name]) => name),
        };
      }),
    );

    const accounts: TransactionsAccount[] = [
      { accountNumber, balance: balance ?? undefined, currency: SHEKEL_CURRENCY, txns },
      ...convertDepositCards(accountNumber, cards),
    ];
    return { success: true, accounts };
  }
}

export default BankJerusalemScraper;
