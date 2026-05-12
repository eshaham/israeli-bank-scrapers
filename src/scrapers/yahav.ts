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
import { TransactionTypes, type Transaction, type TransactionsAccount } from '../transactions';
import { BaseScraperWithBrowser, LoginResults, type PossibleLoginResults } from './base-scraper-with-browser';
import { type ScraperOptions } from './interface';
import { parseYahavTransactionRowCells, type YahavScrapedRow } from './yahav-parse';

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

function yahavDebugLog(message: string, extra?: Record<string, unknown>) {
  if (process.env.YAHAV_DEBUG_DOM !== '1' && process.env.YAHAV_DEBUG_DOM !== 'true') {
    return;
  }
  const suffix = extra ? ` ${JSON.stringify(extra)}` : '';
  // eslint-disable-next-line no-console
  console.warn(`[YAHAV_DEBUG_DOM] ${message}${suffix}`);
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
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

function getTxnAmount(txn: YahavScrapedRow) {
  const credit = getAmountData(txn.credit);
  const debit = getAmountData(txn.debit);
  return (Number.isNaN(credit) ? 0 : credit) - (Number.isNaN(debit) ? 0 : debit);
}

function convertTransactions(txns: YahavScrapedRow[], options?: ScraperOptions): Transaction[] {
  const out: Transaction[] = [];
  for (const txn of txns) {
    const m = moment(txn.date, DATE_FORMAT, true);
    if (!m.isValid()) {
      continue;
    }
    const convertedDate = m.toISOString();
    const convertedAmount = getTxnAmount(txn);
    const ref = (txn.reference ?? '').trim();
    /** Finance App: `referenceNumber` preferred in scraperHash (see ScraperService.generateTransactionHash). */
    const result: Transaction = {
      type: TransactionTypes.Normal,
      referenceNumber: ref || undefined,
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
    out.push(result);
  }
  return out;
}

type YahavRowEval = { id: string; cellTexts: string[] };

const YAHAV_ROW_SEL = '.list-item-holder .entire-content-ctr';

/**
 * Virtualized lists reuse row nodes; Yahav often responds to wheel events better than programmatic scrollTop.
 */
async function collectYahavTransactionRowsFromDom(page: Page): Promise<YahavRowEval[]> {
  const seen = new Set<string>();
  const ordered: string[] = [];

  const mergeBatch = (batch: string[]) => {
    for (const t of batch) {
      if (!seen.has(t)) {
        seen.add(t);
        ordered.push(t);
      }
    }
  };

  await page.evaluate(() => {
    document.querySelectorAll('.list-item-holder').forEach(h => {
      if (h instanceof HTMLElement) {
        h.scrollTop = 0;
      }
    });
  });
  await delay(180);

  const holder = await page.$('.list-item-holder');
  if (holder) {
    const box = await holder.boundingBox();
    if (box && box.height > 4) {
      const cx = box.x + box.width * 0.5;
      const cy = box.y + Math.min(box.height * 0.45, 140);
      await holder.click({ delay: 30 });
      await page.mouse.move(cx, cy);

      const wheelPass = async (deltaY: number, maxIter: number, stableLimit: number) => {
        let stable = 0;
        for (let i = 0; i < maxIter; i += 1) {
          const batch = await page.$$eval(YAHAV_ROW_SEL, els =>
            els.map(e => (e as HTMLElement).innerText.replace(/\s+/g, ' ').trim()).filter(t => t.length > 8),
          );
          const before = ordered.length;
          mergeBatch(batch);
          if (ordered.length === before) {
            stable += 1;
            if (stable >= stableLimit) {
              break;
            }
          } else {
            stable = 0;
          }
          await page.mouse.wheel({ deltaY });
          await delay(42);
        }
      };

      await wheelPass(340, 280, 40);
      await page.evaluate(() => {
        document.querySelectorAll('.list-item-holder').forEach(h => {
          if (h instanceof HTMLElement) {
            h.scrollTop = h.scrollHeight;
          }
        });
      });
      await delay(200);
      await page.mouse.move(cx, cy);
      await wheelPass(-340, 280, 40);
    }
  }

  if (ordered.length === 0) {
    const lines = await page.evaluate(async () => {
      const rowSel = YAHAV_ROW_SEL;
      const localSeen = new Set<string>();
      const out: string[] = [];
      const capture = () => {
        document.querySelectorAll(rowSel).forEach(el => {
          const t = (el as HTMLElement).innerText.replace(/\s+/g, ' ').trim();
          if (t.length > 8 && !localSeen.has(t)) {
            localSeen.add(t);
            out.push(t);
          }
        });
      };
      const scrollableAncestors = (start: Element | null): HTMLElement[] => {
        const roots: HTMLElement[] = [];
        let el: Element | null = start;
        while (el && el !== document.body) {
          if (el instanceof HTMLElement) {
            const st = getComputedStyle(el);
            const oy = st.overflowY;
            if ((oy === 'auto' || oy === 'scroll' || oy === 'overlay') && el.scrollHeight > el.clientHeight + 40) {
              roots.push(el);
            }
          }
          el = el.parentElement;
        }
        return roots;
      };
      const firstRow = document.querySelector(rowSel);
      const dynamicRoots = scrollableAncestors(firstRow);
      const listEl = document.querySelector('.list-item-holder');
      const listHolder =
        (listEl instanceof HTMLElement
          ? listEl
          : listEl?.parentElement instanceof HTMLElement
            ? listEl.parentElement
            : null) || null;
      const scrollRoots = [...new Set([listHolder, ...dynamicRoots].filter(Boolean))] as HTMLElement[];
      const step = 220;
      const scrollOne = async (root: HTMLElement | Window, maxIter: number) => {
        if (root instanceof Window) {
          for (let j = 0; j < maxIter; j += 1) {
            capture();
            root.scrollBy(0, step);
            await new Promise<void>(r => {
              setTimeout(r, 55);
            });
          }
          return;
        }
        for (let pass = 0; pass < 2; pass += 1) {
          root.scrollTop = pass === 0 ? 0 : root.scrollHeight;
          await new Promise<void>(r => {
            setTimeout(r, 120);
          });
          let pos = root.scrollTop;
          const maxScroll = root.scrollHeight;
          for (let j = 0; j < maxIter; j += 1) {
            capture();
            const next = pass === 0 ? Math.min(pos + step, maxScroll) : Math.max(pos - step, 0);
            if (next === pos) {
              break;
            }
            pos = next;
            root.scrollTop = pos;
            await new Promise<void>(r => {
              setTimeout(r, 55);
            });
          }
          capture();
        }
      };
      for (const root of scrollRoots) {
        await scrollOne(root, 200);
      }
      await scrollOne(window, 80);
      return out;
    });
    return lines.map((line, i) => ({ id: String(i), cellTexts: [line] }));
  }

  return ordered.map((line, i) => ({ id: String(i), cellTexts: [line] }));
}

async function scrollYahavTransactionListFully(page: Page) {
  const rowSelector = '.list-item-holder .entire-content-ctr';
  let lastCount = -1;
  let stableRounds = 0;
  for (let i = 0; i < 45; i += 1) {
    const count = await page.$$eval(rowSelector, els => els.length);
    await page.evaluate(rs => {
      const rows = document.querySelectorAll(rs);
      const last = rows[rows.length - 1];
      if (last instanceof HTMLElement) {
        last.scrollIntoView({ block: 'end' });
      }
      document.querySelectorAll('.list-item-holder').forEach(holder => {
        if (holder instanceof HTMLElement) {
          holder.scrollTop = holder.scrollHeight;
        }
      });
    }, rowSelector);
    await delay(120);
    if (count === lastCount) {
      stableRounds += 1;
      if (stableRounds >= 3) {
        break;
      }
    } else {
      stableRounds = 0;
      lastCount = count;
    }
  }
}

async function getAccountTransactions(page: Page, options?: ScraperOptions): Promise<Transaction[]> {
  await waitUntilElementFound(page, '.under-line-txn-table-header', true);

  yahavDebugLog('page snapshot', { url: page.url() });

  await scrollYahavTransactionListFully(page);

  let transactionsDivs = await collectYahavTransactionRowsFromDom(page);
  yahavDebugLog('virtualized collect', { uniqueRows: transactionsDivs.length });

  const rowSelectors = ['.list-item-holder .entire-content-ctr', '.entire-content-ctr'];

  for (const sel of rowSelectors) {
    if (transactionsDivs.length > 0) {
      break;
    }
    await scrollYahavTransactionListFully(page);
    const count = await page.$$eval(sel, els => els.length);
    yahavDebugLog('row selector probe', { selector: sel, count });
    transactionsDivs = await pageEvalAll<YahavRowEval[]>(page, sel, [], divs => {
      return (divs as HTMLElement[]).map(div => {
        const fromChildren = Array.from(div.children)
          .map(ch => (ch instanceof HTMLElement ? ch.innerText : '').replace(/\s+/g, ' ').trim())
          .filter(Boolean);
        let cellTexts = fromChildren;
        if (cellTexts.length < 4) {
          const directDivs = Array.from(div.querySelectorAll(':scope > div')).map(d =>
            (d as HTMLElement).innerText.replace(/\s+/g, ' ').trim(),
          );
          const uniq = directDivs.filter(Boolean);
          if (uniq.length > cellTexts.length) {
            cellTexts = uniq;
          }
        }
        return {
          id: div.getAttribute('id') || '',
          cellTexts,
        };
      });
    });
    if (transactionsDivs.length > 0) {
      break;
    }
  }

  yahavDebugLog('row cell preview (first rows)', {
    rows: transactionsDivs.slice(0, 4).map(r => ({
      id: r.id,
      cellCount: r.cellTexts.length,
      cells: r.cellTexts.map(t => t.slice(0, 80)),
    })),
  });

  const txns: YahavScrapedRow[] = [];
  const seen = new Set<string>();
  for (const txnRow of transactionsDivs) {
    const parsed = parseYahavTransactionRowCells(txnRow.cellTexts);
    if (!parsed) {
      continue;
    }
    const key = `${parsed.date}|${parsed.reference ?? ''}|${parsed.description}|${parsed.debit}|${parsed.credit}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    txns.push(parsed);
  }

  yahavDebugLog('parsed transactions', { count: txns.length });

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

async function clickYahavStatementSearchIfPresent(page: Page): Promise<void> {
  await page.evaluate(() => {
    const scope =
      document.querySelector('.statement-options') || document.querySelector('[class*="statement"]') || document.body;
    const buttons = Array.from(scope.querySelectorAll('button'));
    const match = buttons.find(b => {
      const t = (b.textContent || '').replace(/\s+/g, ' ').trim();
      return /חפש|חיפוש|הצג|עדכון/i.test(t);
    });
    if (match instanceof HTMLElement) {
      match.click();
    }
  });
  await delay(200);
}

/** Sets "from" on the first date cell input and "to" on the second when present (avoids hitting "to" only). */
async function setYahavDateRangeInputs(page: Page, fromFormatted: string, toFormatted: string): Promise<boolean> {
  return page.evaluate(
    (fromVal, toVal) => {
      const collectVisibleInputs = (root: Document | Element) => {
        const cells = Array.from(root.querySelectorAll('div.date-options-cell'));
        const out: HTMLInputElement[] = [];
        for (const cell of cells) {
          const inp = cell.querySelector('input:not([type="hidden"])');
          if (inp instanceof HTMLInputElement) {
            out.push(inp);
          }
        }
        return out;
      };
      let inputs = collectVisibleInputs(document.querySelector('.statement-options') || document.body);
      if (inputs.length === 0) {
        inputs = collectVisibleInputs(document.body);
      }
      if (inputs.length === 0) {
        inputs = Array.from(document.querySelectorAll('div.date-options-cell input:not([type="hidden"])')).filter(
          (el): el is HTMLInputElement => el instanceof HTMLInputElement,
        );
      }
      if (inputs.length === 0) {
        return false;
      }
      const apply = (input: HTMLInputElement, value: string) => {
        input.scrollIntoView({ block: 'center', inline: 'nearest' });
        input.focus();
        input.value = '';
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new Event('blur', { bubbles: true }));
      };
      apply(inputs[0], fromVal);
      if (inputs.length >= 2) {
        apply(inputs[1], toVal);
      }
      return true;
    },
    fromFormatted,
    toFormatted,
  );
}

// Manipulate the calendar drop down to choose the txs start date.
async function searchByDates(page: Page, startDate: Moment) {
  // Get the day number from startDate. 1-31 (usually 1)
  const startDateDay = startDate.format('D');
  const startDateMonth = startDate.format('M');
  const startDateYear = startDate.format('Y');

  const pickerMode = await runYahavStage('open from-date picker', () => openYahavFromDatePicker(page));
  if (pickerMode === 'input') {
    const formattedFrom = startDate.format(DATE_FORMAT);
    const formattedTo = moment().format(DATE_FORMAT);
    const setInput = await runYahavStage('set date range inputs', () =>
      setYahavDateRangeInputs(page, formattedFrom, formattedTo),
    );
    if (!setInput) {
      throw new Error('Yahav: fallback input mode selected but failed to set from/to date inputs.');
    }
    await runYahavStage('post-input search click', () => clickYahavStatementSearchIfPresent(page));
    await waitYahavLoadingSpinnerGoneIfPresent(page);
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

  let yearMatched = false;
  for (let i = 1; i < 13; i += 1) {
    const selector = `.pmu-years > div:nth-child(${i})`;
    const year = await page.$eval(selector, y => {
      return (y as HTMLElement).innerText;
    });
    if (startDateYear === year) {
      await runYahavStage(`select year ${startDateYear}`, () => clickButton(page, selector));
      yearMatched = true;
      break;
    }
  }
  if (!yearMatched) {
    throw new Error(`Yahav: calendar year ${startDateYear} not found in year grid.`);
  }

  // Select Month.
  await runYahavStage('wait month grid before selecting month', () =>
    waitUntilElementFound(page, '.pmu-months > div:nth-child(1)', true),
  );
  // The first element (1) is January.
  const monthSelector = `.pmu-months > div:nth-child(${startDateMonth})`;
  await runYahavStage(`select month ${startDateMonth}`, () => clickButton(page, monthSelector));

  let dayChosen = false;
  for (let i = 1; i < 43; i += 1) {
    const selector = `.pmu-days > div:nth-child(${i})`;
    const clicked = await page.evaluate(
      (sel: string, day: string) => {
        const el = document.querySelector(sel);
        if (!(el instanceof HTMLElement)) {
          return false;
        }
        if (el.classList.contains('pmu-disabled')) {
          return false;
        }
        if ((el.innerText || '').trim() !== day) {
          return false;
        }
        el.click();
        return true;
      },
      selector,
      startDateDay,
    );
    if (clicked) {
      dayChosen = true;
      break;
    }
  }
  if (!dayChosen) {
    throw new Error(`Yahav: calendar day ${startDateDay} not found in a non-disabled .pmu-days cell.`);
  }

  await runYahavStage('post-calendar search click', () => clickYahavStatementSearchIfPresent(page));
  await waitYahavLoadingSpinnerGoneIfPresent(page);
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
