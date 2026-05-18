import moment, { type Moment } from 'moment';
import { type HTTPRequest, type HTTPResponse, type Page } from 'puppeteer';
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
/** Full-page "תנועות בחשבון עו"ש" (date filters + full table); home overlay often shows a short virtualized preview. */
const YAHAV_CURRENT_ACCOUNT_TXNS_HASH = 'main/accounts/current/';

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

function yahavNetLog(message: string, extra?: Record<string, unknown>) {
  if (process.env.YAHAV_DEBUG_NET !== '1' && process.env.YAHAV_DEBUG_NET !== 'true') {
    return;
  }
  const suffix = extra ? ` ${JSON.stringify(extra)}` : '';
  // eslint-disable-next-line no-console
  console.warn(`[YAHAV_DEBUG_NET] ${message}${suffix}`);
}

function isYahavHostUrl(url: string): boolean {
  return /(^https?:\/\/)?([a-z0-9-]+\.)*yahav\.co\.il/i.test(url);
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

/**
 * Headless Chromium in Docker (e.g. Finance App backend) defaults to ~800x600. The Yahav
 * virtualized statement list materializes only ~5 rows at that viewport regardless of
 * scroll, which masquerades as "the bank only returned a week" while in reality the rest
 * of the rows were never rendered. Force a wider viewport before navigating to statements.
 * Idempotent — caller can invoke multiple times.
 */
async function ensureYahavViewport(page: Page): Promise<void> {
  const desiredWidth = 1366;
  const desiredHeight = 900;
  try {
    const current = page.viewport();
    if (current && current.width >= desiredWidth && current.height >= desiredHeight) {
      return;
    }
    await page.setViewport({ width: desiredWidth, height: desiredHeight });
    yahavDebugLog('viewport set', { width: desiredWidth, height: desiredHeight });
  } catch (error) {
    yahavDebugLog('viewport set failed (continuing)', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function yahavStrictStatementEnabled(): boolean {
  return process.env.YAHAV_STRICT_STATEMENT !== '0' && process.env.YAHAV_STRICT_STATEMENT !== 'false';
}

function isYahavCurrentAccountTransactionsUrl(url: string): boolean {
  return /\/main\/accounts\/current/i.test(url);
}

type YahavStatementDomSnapshot = {
  url: string;
  onCurrentAccountPage: boolean;
  listRowCount: number;
  dateInputs: Array<{ value: string; placeholder: string }>;
  scopeSelectedText: string;
  dateTokenCount2026: number;
  hasSalaryWord: boolean;
  oldestDateToken: string | null;
};

type YahavCoverageDiagnostics = {
  requestedStartDate: string;
  minTxnDate: string | null;
  maxTxnDate: string | null;
  txnsCount: number;
  coverageGapDays: number;
  suspiciousCoverage: boolean;
};

export function buildYahavCoverageDiagnostics(
  accounts: TransactionsAccount[],
  requestedStartMoment: Moment,
  suspiciousGapDays: number,
): YahavCoverageDiagnostics {
  const txns = accounts.flatMap(acc => acc.txns || []);
  const dates = txns
    .map(txn => moment(txn.date))
    .filter(m => m.isValid())
    .sort((a, b) => a.valueOf() - b.valueOf());
  const minTxn = dates[0];
  const maxTxn = dates[dates.length - 1];
  const coverageGapDays = minTxn
    ? Math.max(0, minTxn.startOf('day').diff(requestedStartMoment.clone().startOf('day'), 'days'))
    : 0;
  const suspiciousCoverage = txns.length > 0 && coverageGapDays >= suspiciousGapDays;

  return {
    requestedStartDate: requestedStartMoment.format('YYYY-MM-DD'),
    minTxnDate: minTxn ? minTxn.format('YYYY-MM-DD') : null,
    maxTxnDate: maxTxn ? maxTxn.format('YYYY-MM-DD') : null,
    txnsCount: txns.length,
    coverageGapDays,
    suspiciousCoverage,
  };
}

async function countYahavListRows(page: Page): Promise<number> {
  try {
    return await page.$$eval('.list-item-holder .entire-content-ctr', els => els.length);
  } catch {
    return 0;
  }
}

async function readYahavStatementDomSnapshot(page: Page): Promise<YahavStatementDomSnapshot> {
  return page.evaluate(() => {
    const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
    const visibleText = document.body.innerText || '';
    const dates = visibleText.match(/\d{2}\/\d{2}\/20\d{2}/g) || [];
    const sorted = [...dates].sort();
    const scopeEl =
      document.querySelector('.statement-options .selected-item-top') ||
      document.querySelector('.statement-options .selected-item');
    return {
      url: window.location.href,
      onCurrentAccountPage: /\/main\/accounts\/current/i.test(window.location.href),
      listRowCount: document.querySelectorAll('.list-item-holder .entire-content-ctr').length,
      dateInputs: Array.from(document.querySelectorAll('div.date-options-cell input:not([type="hidden"])'))
        .filter((el): el is HTMLInputElement => el instanceof HTMLInputElement)
        .map(el => ({ value: el.value, placeholder: el.placeholder || '' })),
      scopeSelectedText: norm(scopeEl?.textContent || ''),
      dateTokenCount2026: dates.filter(d => d.endsWith('/2026')).length,
      hasSalaryWord: /משכורת/.test(visibleText),
      oldestDateToken: sorted[0] ?? null,
    };
  });
}

function normalizeYahavUiDate(value: string): string {
  const m = value.trim().match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) {
    return value.trim();
  }
  const day = m[1].padStart(2, '0');
  const month = m[2].padStart(2, '0');
  return `${day}/${month}/${m[3]}`;
}

async function assertYahavDateInputsOnScreen(page: Page, formattedFrom: string, formattedTo: string): Promise<void> {
  const expectedFrom = normalizeYahavUiDate(formattedFrom);
  const expectedTo = normalizeYahavUiDate(formattedTo);
  const rawValues = await page.evaluate(() => {
    const isRtl = (): boolean => {
      const d = getComputedStyle(document.documentElement).direction;
      const b = getComputedStyle(document.body).direction;
      return d === 'rtl' || b === 'rtl' || document.documentElement.getAttribute('dir') === 'rtl';
    };
    const score = (inp: HTMLInputElement) => {
      const r = inp.getBoundingClientRect();
      return isRtl() ? r.right : r.left;
    };
    const inputs = Array.from(document.querySelectorAll('div.date-options-cell input:not([type="hidden"])')).filter(
      (el): el is HTMLInputElement => el instanceof HTMLInputElement,
    );
    return inputs
      .map(inp => ({ inp, s: score(inp) }))
      .sort((a, b) => b.s - a.s)
      .map(p => p.inp.value);
  });
  if (rawValues.length === 0) {
    throw new Error('Yahav: no date inputs visible on statement page for from/to assert.');
  }
  const values = rawValues.map(normalizeYahavUiDate);
  const fromVal = values[0] || '';
  const toVal = values[1] || values[0] || '';
  if (fromVal !== expectedFrom) {
    throw new Error(
      `Yahav: from-date on screen is "${fromVal}" but expected "${expectedFrom}" (inputs=${JSON.stringify(values)})`,
    );
  }
  if (values.length >= 2 && toVal !== expectedTo) {
    throw new Error(
      `Yahav: to-date on screen is "${toVal}" but expected "${expectedTo}" (inputs=${JSON.stringify(values)})`,
    );
  }
  yahavDebugLog('date inputs assert ok', { expectedFrom, expectedTo, values });
}

async function waitYahavStatementListRowsAtLeast(page: Page, minRows: number, timeoutMs = 25000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  let last = 0;
  while (Date.now() < deadline) {
    last = await countYahavListRows(page);
    if (last >= minRows) {
      return last;
    }
    await delay(350);
  }
  return last;
}

function waitYahavAccountStatementPost(page: Page, timeoutMs = 30000): Promise<HTTPResponse | undefined> {
  return page
    .waitForResponse(
      res => {
        if (!/BaNCSDigitalApp\/account/i.test(res.url())) {
          return false;
        }
        return res.request().method() === 'POST' && res.status() === 200;
      },
      { timeout: timeoutMs },
    )
    .catch(() => undefined);
}

async function ensureYahavOnCurrentAccountTransactionsPage(page: Page): Promise<void> {
  if (!isYahavCurrentAccountTransactionsUrl(page.url())) {
    await gotoYahavCurrentAccountTransactionsPage(page);
    return;
  }
  const hasHeader = await elementPresentOnPage(page, '.under-line-txn-table-header');
  const hasDateCell = await page.evaluate(() => document.querySelectorAll('div.date-options-cell').length > 0);
  if (!hasHeader || !hasDateCell) {
    await gotoYahavCurrentAccountTransactionsPage(page);
  }
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
const YAHAV_ROW_FALLBACK_SELS = ['.list-item-holder .entire-content-ctr', '.entire-content-ctr'];

async function captureYahavRowInnerTexts(page: Page): Promise<string[]> {
  return page.evaluate((sels: string[]) => {
    const seen = new Set<string>();
    const out: string[] = [];
    sels.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => {
        const t = (el as HTMLElement).innerText.replace(/\s+/g, ' ').trim();
        if (t.length > 8 && !seen.has(t)) {
          seen.add(t);
          out.push(t);
        }
      });
    });
    return out;
  }, YAHAV_ROW_FALLBACK_SELS);
}

/**
 * Fallback collector for Yahav host-app layouts where virtual list wrappers differ.
 * Scans broadly for row-like elements that contain date tokens and amount-like values.
 */
async function collectYahavRowsByDatePatternFallback(page: Page): Promise<YahavRowEval[]> {
  const lines = await page.evaluate(() => {
    const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
    const dateRx = /\b\d{2}\/\d{2}\/20\d{2}\b/;
    const amountRx = /-?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})/;
    const selectors = [
      '.entire-content-ctr',
      '.list-item-holder > *',
      '.cdk-virtual-scroll-content-wrapper > *',
      '[class*="statement"] [class*="row"]',
      '[class*="transaction"] [class*="row"]',
      '.list-item-holder li',
    ];
    const seenLine = new Set<string>();
    const out: string[] = [];

    selectors.forEach(sel => {
      document.querySelectorAll(sel).forEach(node => {
        if (!(node instanceof HTMLElement)) {
          return;
        }
        const line = norm(node.innerText || '');
        if (!line || line.length < 12 || line.length > 420) {
          return;
        }
        if (!dateRx.test(line) || !amountRx.test(line)) {
          return;
        }
        if (!seenLine.has(line)) {
          seenLine.add(line);
          out.push(line);
        }
      });
    });

    return out;
  });

  return lines.map((line, i) => ({ id: `fallback-${i}`, cellTexts: [line] }));
}

/** Scroll the element with the largest vertical overflow under the statement / account area (virtual list viewport). */
async function scrollYahavTransactionViewport(page: Page, delta: number): Promise<void> {
  await page.evaluate((step: number) => {
    const anchor =
      document.querySelector('.under-line-txn-table-header') ||
      document.querySelector('.list-item-holder') ||
      document.querySelector('.statement-options');
    const root =
      (anchor instanceof Element && (anchor.closest('[class*="account"]') || anchor.closest('main'))) || document.body;
    let best: HTMLElement | null = null;
    let maxExtra = 0;
    const nodes = root.querySelectorAll('*');
    for (let i = 0; i < nodes.length; i += 1) {
      const el = nodes[i];
      if (!(el instanceof HTMLElement)) {
        continue;
      }
      const oy = getComputedStyle(el).overflowY;
      if (oy !== 'auto' && oy !== 'scroll' && oy !== 'overlay') {
        continue;
      }
      const extra = el.scrollHeight - el.clientHeight;
      if (extra > maxExtra && extra > 40) {
        maxExtra = extra;
        best = el;
      }
    }
    if (best === null) {
      return;
    }
    const max = Math.max(0, best.scrollHeight - best.clientHeight);
    best.scrollTop = Math.min(Math.max(0, best.scrollTop + step), max);
  }, delta);
}

/**
 * Virtualized lists reuse row nodes; combine programmatic scroll, wheel, scrollIntoView, and in-page capture passes.
 */
async function primeYahavVirtualScrollPort(page: Page): Promise<void> {
  await page.evaluate(() => {
    const vps = document.querySelectorAll(
      'cdk-virtual-scroll-viewport, [class*="virtual-scroll-viewport"], [class*="VirtualScroll"]',
    );
    vps.forEach(vp => {
      const api = vp as unknown as { scrollToOffset?: (n: number) => void; scrollToIndex?: (n: number) => void };
      try {
        api.scrollToOffset?.(9e6);
      } catch {
        /* ignore */
      }
      try {
        api.scrollToIndex?.(99999);
      } catch {
        /* ignore */
      }
    });
  });
  await delay(120);
}

async function dispatchYahavWheelOnRowScrollParent(page: Page, iterations: number, deltaY: number): Promise<void> {
  await page.evaluate(
    async (args: { iterations: number; deltaY: number; rowSel: string }) => {
      const { iterations: it, deltaY: dy, rowSel } = args;
      const first = document.querySelector(rowSel);
      if (!(first instanceof HTMLElement)) {
        return;
      }
      let best: HTMLElement | null = null;
      let maxExtra = 0;
      let p: HTMLElement | null = first.parentElement;
      for (let d = 0; d < 30 && p; d += 1) {
        const st = getComputedStyle(p).overflowY;
        const extra = p.scrollHeight - p.clientHeight;
        if (
          (st === 'auto' || st === 'scroll' || st === 'overlay') &&
          extra > maxExtra &&
          extra > 20 &&
          p.querySelector('.entire-content-ctr')
        ) {
          maxExtra = extra;
          best = p;
        }
        p = p.parentElement;
      }
      const holder = document.querySelector('.list-item-holder');
      const target = best || (holder instanceof HTMLElement ? holder : null);
      if (!target) {
        return;
      }
      const raf = () =>
        new Promise<void>(resolve => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      for (let i = 0; i < it; i += 1) {
        target.dispatchEvent(new WheelEvent('wheel', { deltaY: dy, bubbles: true, cancelable: true }));
        await raf();
      }
    },
    { iterations, deltaY, rowSel: YAHAV_ROW_SEL },
  );
}

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

  // "הצג פרטים נוספים" often sits below the first screen; scroll down before expand, then reset for a full sweep.
  await page.evaluate(() => {
    document.querySelectorAll('.list-item-holder').forEach(h => {
      if (h instanceof HTMLElement) {
        h.scrollTop = h.scrollHeight;
      }
    });
  });
  await delay(350);
  await expandYahavStatementTable(page);

  await page.evaluate(() => {
    document.querySelectorAll('.list-item-holder').forEach(h => {
      if (h instanceof HTMLElement) {
        h.scrollTop = 0;
      }
    });
  });
  await delay(200);
  await expandYahavStatementTable(page);

  await primeYahavVirtualScrollPort(page);
  await dispatchYahavWheelOnRowScrollParent(page, 260, 160);
  await dispatchYahavWheelOnRowScrollParent(page, 260, -160);
  mergeBatch(await captureYahavRowInnerTexts(page));

  const holder = await page.$('.list-item-holder');
  if (holder) {
    const box = await holder.boundingBox();
    if (box && box.height > 4) {
      const cx = box.x + box.width * 0.5;
      const cy = box.y + Math.min(box.height * 0.45, 140);
      await holder.click({ delay: 30 });
      await page.mouse.move(cx, cy);
      for (let k = 0; k < 120; k += 1) {
        mergeBatch(await captureYahavRowInnerTexts(page));
        await page.keyboard.press('PageDown');
        await delay(45);
      }
      for (let k = 0; k < 40; k += 1) {
        mergeBatch(await captureYahavRowInnerTexts(page));
        await page.keyboard.press('PageUp');
        await delay(45);
      }

      const wheelPass = async (deltaY: number, maxIter: number, stableLimit: number) => {
        let stable = 0;
        for (let i = 0; i < maxIter; i += 1) {
          const before = ordered.length;
          mergeBatch(await captureYahavRowInnerTexts(page));
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

      await wheelPass(340, 320, 45);
      await page.evaluate(() => {
        document.querySelectorAll('.list-item-holder').forEach(h => {
          if (h instanceof HTMLElement) {
            h.scrollTop = h.scrollHeight;
          }
        });
      });
      await delay(200);
      await page.mouse.move(cx, cy);
      await wheelPass(-340, 320, 45);
    }
  }

  for (let i = 0; i < 320; i += 1) {
    mergeBatch(await captureYahavRowInnerTexts(page));
    await scrollYahavTransactionViewport(page, 72);
    await delay(32);
  }
  for (let i = 0; i < 320; i += 1) {
    mergeBatch(await captureYahavRowInnerTexts(page));
    await scrollYahavTransactionViewport(page, -72);
    await delay(32);
  }

  if (holder) {
    const box = await holder.boundingBox();
    if (box && box.height > 4) {
      const cx = box.x + box.width * 0.5;
      const cy = box.y + Math.min(box.height * 0.45, 140);
      await page.mouse.move(cx, cy);
      const wheelPass2 = async (deltaY: number, maxIter: number, stableLimit: number) => {
        let stable = 0;
        for (let i = 0; i < maxIter; i += 1) {
          const before = ordered.length;
          mergeBatch(await captureYahavRowInnerTexts(page));
          if (ordered.length === before) {
            stable += 1;
            if (stable >= stableLimit) {
              break;
            }
          } else {
            stable = 0;
          }
          await page.mouse.wheel({ deltaY });
          await delay(40);
        }
      };
      await wheelPass2(340, 200, 35);
      await page.mouse.move(cx, cy);
      await wheelPass2(-340, 200, 35);
    }
  }

  for (let i = 0; i < 160; i += 1) {
    mergeBatch(await captureYahavRowInnerTexts(page));
    await page.evaluate(rs => {
      const rows = document.querySelectorAll(rs);
      const first = rows[0];
      const last = rows[rows.length - 1];
      if (first instanceof HTMLElement) {
        first.scrollIntoView({ block: 'start' });
      }
      if (last instanceof HTMLElement) {
        last.scrollIntoView({ block: 'end' });
      }
      document.querySelectorAll('.list-item-holder').forEach(holder => {
        if (holder instanceof HTMLElement) {
          holder.scrollTop = Math.min(holder.scrollTop + 180, holder.scrollHeight);
        }
      });
    }, YAHAV_ROW_SEL);
    await delay(55);
  }

  const linesFromEvaluate = await page.evaluate(async (rowSel: string) => {
    const raf = () =>
      new Promise<void>(resolve => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
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
    const wrapsTxnList = (node: HTMLElement) =>
      node.matches('.list-item-holder') || !!node.querySelector('.list-item-holder') || !!node.querySelector(rowSel);

    const anchor =
      document.querySelector('.under-line-txn-table-header') ||
      document.querySelector('.list-item-holder') ||
      document.querySelector('.statement-options');
    const root =
      (anchor instanceof Element && (anchor.closest('[class*="account"]') || anchor.closest('main'))) || document.body;

    let best: HTMLElement | null = null;
    let maxExtra = 0;
    const rowNodes = document.querySelectorAll(rowSel);
    if (rowNodes[0] instanceof HTMLElement) {
      let p: HTMLElement | null = rowNodes[0].parentElement;
      for (let depth = 0; depth < 28 && p; depth += 1) {
        const st = getComputedStyle(p).overflowY;
        const extra = p.scrollHeight - p.clientHeight;
        if (
          (st === 'auto' || st === 'scroll' || st === 'overlay') &&
          extra > maxExtra &&
          extra > 40 &&
          p.clientHeight > 60 &&
          p.clientHeight < 2400
        ) {
          maxExtra = extra;
          best = p;
        }
        p = p.parentElement;
      }
    }
    if (!best) {
      root.querySelectorAll('*').forEach(node => {
        if (!(node instanceof HTMLElement)) {
          return;
        }
        if (!wrapsTxnList(node)) {
          return;
        }
        const oy = getComputedStyle(node).overflowY;
        if (oy !== 'auto' && oy !== 'scroll' && oy !== 'overlay') {
          return;
        }
        const extra = node.scrollHeight - node.clientHeight;
        if (extra > maxExtra && extra > 40 && node.clientHeight > 60 && node.clientHeight < 2400) {
          maxExtra = extra;
          best = node;
        }
      });
    }

    const scrollAndCapture = async (el: HTMLElement) => {
      const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
      if (maxScroll <= 0) {
        capture();
        await raf();
        return;
      }
      const step = Math.max(24, Math.min(96, Math.ceil(maxScroll / 180)));
      const maxSteps = 220;
      let steps = 0;
      for (let pos = 0; pos <= maxScroll && steps < maxSteps; pos += step) {
        el.scrollTop = Math.min(pos, maxScroll);
        el.dispatchEvent(new Event('scroll', { bubbles: true }));
        capture();
        await raf();
        steps += 1;
      }
      el.scrollTop = maxScroll;
      el.dispatchEvent(new Event('scroll', { bubbles: true }));
      capture();
      await raf();
      steps = 0;
      for (let pos = maxScroll; pos >= 0 && steps < maxSteps; pos -= step) {
        el.scrollTop = Math.max(pos, 0);
        el.dispatchEvent(new Event('scroll', { bubbles: true }));
        capture();
        await raf();
        steps += 1;
      }
      el.scrollTop = 0;
      el.dispatchEvent(new Event('scroll', { bubbles: true }));
      capture();
      await raf();
    };

    if (best instanceof HTMLElement) {
      await scrollAndCapture(best);
    }

    for (const vp of document.querySelectorAll('cdk-virtual-scroll-viewport, .cdk-virtual-scroll-viewport')) {
      if (vp instanceof HTMLElement) {
        await scrollAndCapture(vp);
      }
    }

    if (!best) {
      capture();
    }
    return out;
  }, YAHAV_ROW_SEL);
  mergeBatch(linesFromEvaluate);

  return ordered.map((line, i) => ({ id: String(i), cellTexts: [line] }));
}

/**
 * Yahav often shows a short list first; "הצג פרטים נוספים" / similar controls load the full statement into the DOM.
 * Clicks matching controls until none appear for several consecutive passes (max iterations cap).
 */
async function expandYahavStatementTable(page: Page): Promise<void> {
  let idlePasses = 0;
  for (let i = 0; i < 28; i += 1) {
    const clicked = await page.evaluate(() => {
      const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
      const matchesLabel = (raw: string) =>
        /פרטים נוספים|הצג פרטים|הצג עוד|עוד תנועות|טען עוד|הצג הכל|כל התנועות|הרחב|מידע נוסף|לחץ להרחבה/i.test(raw);
      const tableRoot =
        (document.querySelector('.list-item-holder') instanceof Element &&
          document.querySelector('.list-item-holder')!.closest('main')) ||
        document.querySelector('.statement-options') ||
        document.querySelector('main') ||
        document.body;

      // First pass: phrase match on *any* visible element text, then climb to clickable ancestor.
      const broadPhraseNode = Array.from(tableRoot.querySelectorAll('*')).find(el => {
        if (!(el instanceof HTMLElement)) {
          return false;
        }
        const t = norm(el.textContent || '');
        if (!t || t.length > 220) {
          return false;
        }
        return /פרטים נוספים|הצג פרטים נוספים|עוד תנועות|הצג עוד/i.test(t);
      });
      if (broadPhraseNode instanceof HTMLElement) {
        const closestClickable = broadPhraseNode.closest(
          'a, button, [role="button"], [ng-click], [data-ng-click], .link',
        );
        const clickable = closestClickable instanceof HTMLElement ? closestClickable : broadPhraseNode;
        const raw = norm(clickable.textContent || broadPhraseNode.textContent || '');
        clickable.scrollIntoView({ block: 'center', inline: 'nearest' });
        clickable.click();
        return { hit: true as const, label: raw.slice(0, 90), candidateCount: -1, strategy: 'broad-phrase' };
      }

      const collect = (root: Element): HTMLElement[] => {
        const out: HTMLElement[] = [];
        root.querySelectorAll('a, button, [role="button"], span, div[ng-click], .link').forEach(el => {
          if (!(el instanceof HTMLElement)) {
            return;
          }
          const raw = (el.textContent || '').replace(/\s+/g, ' ').trim();
          if (raw.length < 3 || raw.length > 200) {
            return;
          }
          if (!matchesLabel(raw)) {
            return;
          }
          out.push(el);
        });
        return out;
      };

      let candidates = collect(tableRoot);
      if (candidates.length === 0 && tableRoot !== document.body) {
        candidates = collect(document.body);
        candidates = candidates.filter(el => {
          const raw = (el.textContent || '').replace(/\s+/g, ' ').trim();
          return /פרטים נוספים|הצג פרטים נוספים|עוד תנועות/i.test(raw);
        });
      }
      candidates.sort((a, b) => {
        const la = (a.textContent || '').replace(/\s+/g, ' ').trim().length;
        const lb = (b.textContent || '').replace(/\s+/g, ' ').trim().length;
        return la - lb;
      });
      const pick =
        candidates.find(el => {
          const tag = el.tagName;
          return tag === 'A' || tag === 'BUTTON' || el.matches('[role="button"], [ng-click], .link');
        }) || candidates[0];
      if (pick) {
        const raw = norm(pick.textContent || '');
        pick.scrollIntoView({ block: 'center', inline: 'nearest' });
        pick.click();
        return {
          hit: true as const,
          label: raw.slice(0, 90),
          candidateCount: candidates.length,
          strategy: 'selector-candidate',
        };
      }
      return { hit: false as const, candidateCount: candidates.length, strategy: 'none' };
    });
    if (!clicked.hit) {
      idlePasses += 1;
      if (idlePasses >= 4) {
        break;
      }
    } else {
      idlePasses = 0;
      yahavDebugLog('expand statement control', {
        label: clicked.label,
        candidateCount: clicked.candidateCount,
        strategy: clicked.strategy,
      });
    }
    await delay(520);
    await waitYahavLoadingSpinnerGoneIfPresent(page);
  }
}

async function scrollYahavTransactionListFully(page: Page) {
  const rowSelector = '.list-item-holder .entire-content-ctr';
  let lastCount = -1;
  let stableRounds = 0;
  for (let i = 0; i < 120; i += 1) {
    const count = await page.$$eval(rowSelector, els => els.length);
    await page.evaluate(rs => {
      const rows = document.querySelectorAll(rs);
      const first = rows[0];
      const last = rows[rows.length - 1];
      if (first instanceof HTMLElement) {
        first.scrollIntoView({ block: 'start' });
      }
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

function countYahavParsedRows(rows: YahavRowEval[]): number {
  const seenKeys = new Set<string>();
  let n = 0;
  for (const txnRow of rows) {
    const parsed = parseYahavTransactionRowCells(txnRow.cellTexts);
    if (!parsed) {
      continue;
    }
    const key = `${parsed.date}|${parsed.reference ?? ''}|${parsed.description}|${parsed.debit}|${parsed.credit}`;
    if (seenKeys.has(key)) {
      continue;
    }
    seenKeys.add(key);
    n += 1;
  }
  return n;
}

async function gotoYahavCurrentAccountTransactionsPage(page: Page): Promise<void> {
  const target = `${BASE_URL}${YAHAV_CURRENT_ACCOUNT_TXNS_HASH}`;
  if (/\/main\/accounts\/current/i.test(page.url())) {
    await waitYahavLoadingSpinnerGoneIfPresent(page);
    await waitUntilElementFound(page, '.under-line-txn-table-header', true, 60000);
    return;
  }
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await waitYahavLoadingSpinnerGoneIfPresent(page);
  await waitUntilElementFound(page, '.under-line-txn-table-header', true, 90000);
}

async function getAccountTransactions(page: Page, options?: ScraperOptions): Promise<Transaction[]> {
  await waitUntilElementFound(page, '.under-line-txn-table-header', true);

  yahavDebugLog('page snapshot', { url: page.url() });
  yahavDebugLog('dom text probe', {
    probe: await page.evaluate(() => {
      const visibleText = document.body.innerText || '';
      const rawText = document.body.textContent || '';
      const datesVisible = (visibleText.match(/\d{2}\/\d{2}\/2026/g) || []).length;
      const datesRaw = (rawText.match(/\d{2}\/\d{2}\/2026/g) || []).length;
      return {
        datesVisible,
        datesRaw,
        hasSalaryVisible: /משכורת/.test(visibleText),
        hasSalaryRaw: /משכורת/.test(rawText),
        lenVisible: visibleText.length,
        lenRaw: rawText.length,
        hasMoreDetailsVisible: /פרטים נוספים|הצג פרטים/.test(visibleText),
        hasMoreDetailsRaw: /פרטים נוספים|הצג פרטים/.test(rawText),
      };
    }),
  });

  await scrollYahavTransactionListFully(page);
  await expandYahavStatementTable(page);
  await scrollYahavTransactionListFully(page);
  await expandYahavStatementTable(page);

  let transactionsDivs = await collectYahavTransactionRowsFromDom(page);
  yahavDebugLog('virtualized collect', { uniqueRows: transactionsDivs.length });

  const rowSelectors = ['.list-item-holder .entire-content-ctr', '.entire-content-ctr'];

  for (const sel of rowSelectors) {
    await scrollYahavTransactionListFully(page);
    await expandYahavStatementTable(page);
    const count = await page.$$eval(sel, els => els.length);
    yahavDebugLog('row selector probe', { selector: sel, count });
    const snapshotDivs = await pageEvalAll<YahavRowEval[]>(page, sel, [], divs => {
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
    const collectParsed = countYahavParsedRows(transactionsDivs);
    const snapParsed = countYahavParsedRows(snapshotDivs);
    if (snapshotDivs.length > 0 && snapParsed > collectParsed) {
      yahavDebugLog('prefer DOM snapshot rows', { selector: sel, snapParsed, collectParsed });
      transactionsDivs = snapshotDivs;
    }
  }

  const minRowsAfterCollection = Math.max(8, parseInt(process.env.YAHAV_MIN_STATEMENT_ROWS || '10', 10) || 10);
  const parsedBeforeFallback = countYahavParsedRows(transactionsDivs);
  if (parsedBeforeFallback < minRowsAfterCollection) {
    const fallbackRows = await collectYahavRowsByDatePatternFallback(page);
    const fallbackParsed = countYahavParsedRows(fallbackRows);
    yahavDebugLog('fallback row collector', {
      parsedBeforeFallback,
      fallbackRows: fallbackRows.length,
      fallbackParsed,
      threshold: minRowsAfterCollection,
    });
    if (fallbackParsed > parsedBeforeFallback) {
      transactionsDivs = fallbackRows;
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
  if (txns.length > 0) {
    const dates = txns.map(t => t.date).sort((a, b) => a.localeCompare(b));
    yahavDebugLog('parsed date span', {
      minDate: dates[0],
      maxDate: dates[dates.length - 1],
      salaryLikeRows: txns
        .filter(t => /משכורת|שכר/i.test(t.description || ''))
        .map(t => ({ date: t.date, desc: t.description.slice(0, 64), credit: t.credit, debit: t.debit }))
        .slice(0, 8),
    });
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
      yahavDebugLog('openYahavFromDatePicker: calendar opened', {
        pickerOpenedBy: selector,
      });
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
    yahavDebugLog('openYahavFromDatePicker: input mode', { pickerOpenedBy: 'input-fallback' });
    return 'input';
  }

  throw new Error(
    'Yahav: failed to open from-date picker. No known trigger opened calendar and no date input was found.',
  );
}

async function clickYahavStatementSearchIfPresent(page: Page): Promise<void> {
  const probe = await page.evaluate(() => {
    const scope =
      document.querySelector('.statement-options') || document.querySelector('[class*="statement"]') || document.body;
    const clickable = Array.from(
      scope.querySelectorAll('button, [role="button"], a, input[type="submit"], .btn, .search-button, .link'),
    );
    const allCandidates = clickable
      .filter((el): el is HTMLElement => el instanceof HTMLElement)
      .map(el => ((el.textContent || '').replace(/\s+/g, ' ').trim() || '<empty>').slice(0, 60))
      .slice(0, 25);
    const match = clickable.find(el => {
      if (!(el instanceof HTMLElement)) {
        return false;
      }
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      return /חפש|חיפוש|הצג|עדכון|החל|סנן|אישור|בצע|הצגה/i.test(t);
    });
    if (match instanceof HTMLElement) {
      match.scrollIntoView({ block: 'center', inline: 'nearest' });
      match.click();
      return {
        matched: (match.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
        candidates: allCandidates,
      };
    }
    return { matched: null, candidates: allCandidates };
  });
  yahavDebugLog('clickYahavStatementSearchIfPresent', {
    matched: probe.matched,
    matchedNone: probe.matched === null,
    buttonsSeen: probe.candidates,
  });
  await delay(200);
}

/** Extra clicks for Angular/ng-click controls that do not use native buttons (statement may stay on a short slice until this runs). */
async function clickYahavStatementSearchHard(page: Page): Promise<void> {
  await page.evaluate(() => {
    const roots = [
      document.querySelector('.statement-options'),
      document.querySelector('.under-line-txn-table-header')?.parentElement,
      document.querySelector('[class*="current-account"]'),
      document.querySelector('main'),
    ].filter((r): r is Element => r instanceof Element);
    const seen = new Set<EventTarget>();
    for (const root of roots) {
      const nodes = Array.from(
        root.querySelectorAll(
          'button, [type="submit"], [role="button"], a, span[ng-click], div[ng-click], i[class*="search"], [class*="search-btn"]',
        ),
      );
      for (const el of nodes) {
        if (!(el instanceof HTMLElement) || seen.has(el)) {
          continue;
        }
        const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
        const oc = `${el.getAttribute('ng-click') || ''}${el.getAttribute('data-ng-click') || ''}`;
        if (t.length > 140) {
          continue;
        }
        if (
          /חפש|חיפוש|הצג|עדכון|החל|מצא|סנן|אישור|בצע|הצגה/i.test(t) ||
          /search|refresh|submit|display|filter|findStatement|getTxn|transactions/i.test(oc)
        ) {
          el.scrollIntoView({ block: 'center', inline: 'nearest' });
          el.click();
          seen.add(el);
        }
      }
    }
  });
  await delay(450);
}

/** Handles icon-only search/refresh controls (no visible text). */
async function clickYahavStatementSearchIconIfPresent(page: Page): Promise<void> {
  const clicked = await page.evaluate(() => {
    const scope = document.querySelector('.statement-options') || document.querySelector('main') || document.body;
    const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
    const nodes = Array.from(scope.querySelectorAll('button, a, [role="button"], i, span, div'));
    for (const n of nodes) {
      if (!(n instanceof HTMLElement)) {
        continue;
      }
      const text = norm(n.textContent || '');
      const attrs = norm(
        [
          n.className || '',
          n.id || '',
          n.getAttribute('title') || '',
          n.getAttribute('aria-label') || '',
          n.getAttribute('ng-click') || '',
          n.getAttribute('data-ng-click') || '',
          n.getAttribute('data-original-title') || '',
        ].join(' '),
      );
      const hay = `${text} ${attrs}`.toLowerCase();
      if (!hay) {
        continue;
      }
      if (/print|printer|pdf|excel|csv|download|ייצוא|הדפס/.test(hay)) {
        continue;
      }
      if (
        !/search|חפש|חיפוש|filter|submit|refresh|icon-search|fa-search|glyphicon-search|magnifier|display|show/i.test(
          hay,
        )
      ) {
        continue;
      }
      const target = n.closest('button, a, [role="button"], [ng-click], [data-ng-click]') || n;
      if (!(target instanceof HTMLElement)) {
        continue;
      }
      target.scrollIntoView({ block: 'center', inline: 'nearest' });
      target.click();
      return { hit: true as const, text: text.slice(0, 80), attrs: attrs.slice(0, 160) };
    }
    return { hit: false as const };
  });
  if (clicked.hit) {
    yahavDebugLog('icon search click', { text: clicked.text, attrs: clicked.attrs });
    await delay(350);
    await waitYahavLoadingSpinnerGoneIfPresent(page);
  }
}

async function debugYahavStatementControls(page: Page, stage: string): Promise<void> {
  if (process.env.YAHAV_DEBUG_DOM !== '1' && process.env.YAHAV_DEBUG_DOM !== 'true') {
    return;
  }
  const snapshot = await page.evaluate(() => {
    const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
    const scope = document.querySelector('.statement-options') || document.querySelector('main') || document.body;
    const controls = Array.from(
      scope.querySelectorAll('button, a, [role="button"], [ng-click], [data-ng-click], i, span, div'),
    )
      .filter((el): el is HTMLElement => el instanceof HTMLElement)
      .map(el => {
        const text = norm(el.textContent || '');
        const cls = norm(el.className || '');
        const title = norm(el.getAttribute('title') || el.getAttribute('aria-label') || '');
        const ng = norm(el.getAttribute('ng-click') || el.getAttribute('data-ng-click') || '');
        return {
          tag: el.tagName,
          text: text.slice(0, 80),
          cls: cls.slice(0, 120),
          title: title.slice(0, 80),
          ng: ng.slice(0, 120),
        };
      })
      .filter(c => c.text || c.title || c.ng || /search|icon|btn|select|dropdown|filter/i.test(c.cls))
      .slice(0, 120);
    return {
      controls,
      rowCount: document.querySelectorAll('.list-item-holder .entire-content-ctr').length,
      optionLikeTexts: Array.from(scope.querySelectorAll('*'))
        .map(el => norm((el as HTMLElement).innerText || ''))
        .filter(t => t && t.length <= 40 && /בחר|כל|תנועות|חיפוש|הצג|פרטים/i.test(t))
        .slice(0, 60),
    };
  });
  yahavDebugLog(`statement controls snapshot: ${stage}`, snapshot);
}

async function debugYahavDateToolbarCandidates(page: Page, stage: string): Promise<void> {
  if (process.env.YAHAV_DEBUG_DOM !== '1' && process.env.YAHAV_DEBUG_DOM !== 'true') {
    return;
  }
  const snapshot = await page.evaluate(() => {
    const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
    const firstDateCell = document.querySelector('div.date-options-cell');
    if (!(firstDateCell instanceof HTMLElement)) {
      return { hasDateCell: false };
    }
    let row: HTMLElement | null = firstDateCell.parentElement;
    for (let i = 0; i < 7 && row; i += 1) {
      if (row.querySelectorAll('div.date-options-cell').length >= 2) {
        break;
      }
      row = row.parentElement;
    }
    if (!(row instanceof HTMLElement)) {
      return { hasDateCell: true, hasRow: false };
    }
    const rows = Array.from(
      row.querySelectorAll('button, a, [role="button"], [ng-click], [data-ng-click], i, span, div'),
    )
      .filter((el): el is HTMLElement => el instanceof HTMLElement)
      .map(el => {
        const text = norm(el.textContent || '');
        const cls = norm(el.className || '');
        const title = norm(el.getAttribute('title') || el.getAttribute('aria-label') || '');
        const ng = norm(el.getAttribute('ng-click') || el.getAttribute('data-ng-click') || '');
        const dataTitle = norm(el.getAttribute('data-original-title') || '');
        return { text, cls, title, ng, dataTitle };
      })
      .filter(item => {
        const hay = `${item.text} ${item.cls} ${item.title} ${item.ng} ${item.dataTitle}`.toLowerCase();
        if (!hay) {
          return false;
        }
        if (/print|pdf|excel|csv|download|הדפס|ייצוא/.test(hay)) {
          return false;
        }
        return /icon|btn|search|filter|submit|refresh|apply|forward|back|next|prev|left|right|calendar|date|ng-click|חפש|הצג|סנן|החל|חודש/.test(
          hay,
        );
      })
      .slice(0, 120);
    return { hasDateCell: true, hasRow: true, candidates: rows };
  });
  yahavDebugLog(`date toolbar candidates: ${stage}`, snapshot);
}

/** In some Yahav builds, the active filter action is an icon next to date inputs (not text button). */
async function clickYahavDateRangeToolbarAction(page: Page): Promise<void> {
  const clicked = await page.evaluate(() => {
    const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
    const firstDateCell = document.querySelector('div.date-options-cell');
    if (!(firstDateCell instanceof HTMLElement)) {
      return { hit: false as const };
    }
    let row: HTMLElement | null = firstDateCell.parentElement;
    for (let i = 0; i < 6 && row; i += 1) {
      if (row.querySelectorAll('div.date-options-cell').length >= 2) {
        break;
      }
      row = row.parentElement;
    }
    if (!(row instanceof HTMLElement)) {
      return { hit: false as const };
    }
    const candidates = Array.from(
      row.querySelectorAll('button, a, [role="button"], [ng-click], [data-ng-click], i, span, div'),
    ).filter((el): el is HTMLElement => el instanceof HTMLElement);
    const picks: Array<{ text: string; attrs: string }> = [];
    for (const node of candidates) {
      const text = norm(node.textContent || '');
      const attrs = norm(
        [
          node.className || '',
          node.id || '',
          node.getAttribute('title') || '',
          node.getAttribute('aria-label') || '',
          node.getAttribute('ng-click') || '',
          node.getAttribute('data-ng-click') || '',
          node.getAttribute('data-original-title') || '',
        ].join(' '),
      );
      const hay = `${text} ${attrs}`.toLowerCase();
      if (!hay) {
        continue;
      }
      if (/print|printer|pdf|excel|csv|download|ייצוא|הדפס/.test(hay)) {
        continue;
      }
      // Include icon-only controls near date cells.
      if (!/search|חפש|חיפוש|refresh|apply|submit|filter|update|icon|glyph|fa-|material/i.test(hay)) {
        continue;
      }
      const target = node.closest('button, a, [role="button"], [ng-click], [data-ng-click]') || node;
      if (!(target instanceof HTMLElement)) {
        continue;
      }
      target.scrollIntoView({ block: 'center', inline: 'nearest' });
      target.click();
      picks.push({ text: text.slice(0, 60), attrs: attrs.slice(0, 140) });
      if (picks.length >= 2) {
        break;
      }
    }
    return { hit: picks.length > 0, picks };
  });
  if (clicked.hit) {
    yahavDebugLog('date-range toolbar action click', { picks: clicked.picks });
    await delay(450);
    await waitYahavLoadingSpinnerGoneIfPresent(page);
  }
}

/** Types into visible date inputs with real keyboard events (Angular bindings sometimes ignore direct value assignment). */
async function typeYahavDateRangeInputsWithKeyboard(
  page: Page,
  fromFormatted: string,
  toFormatted: string,
): Promise<boolean> {
  const handles = await page.$$('div.date-options-cell input:not([type="hidden"])');
  if (handles.length === 0) {
    return false;
  }
  const withBoxes: Array<{ h: (typeof handles)[number]; x: number }> = [];
  for (const h of handles) {
    const box = await h.boundingBox();
    withBoxes.push({ h, x: box?.x ?? 0 });
  }
  // RTL screens: rightmost field is usually "מ" (from), next is "עד" (to).
  withBoxes.sort((a, b) => b.x - a.x);
  const fromInput = withBoxes[0]?.h;
  const toInput = withBoxes[1]?.h;
  if (!fromInput) {
    return false;
  }
  const typeDate = async (h: (typeof handles)[number], value: string) => {
    await h.click({ clickCount: 3, delay: 25 });
    await page.keyboard.press('Backspace').catch(() => undefined);
    await h.type(value, { delay: 45 });
    await page.keyboard.press('Tab').catch(() => undefined);
  };
  await typeDate(fromInput, fromFormatted);
  if (toInput) {
    await typeDate(toInput, toFormatted);
    // Many date widgets commit the range only on Enter from the "to" field.
    await page.keyboard.press('Enter').catch(() => undefined);
  }
  await delay(220);
  return true;
}

async function closeYahavOpenDatePickers(page: Page): Promise<void> {
  await page.evaluate(() => {
    const isVisible = (el: HTMLElement) => {
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    };
    const closeNodes = Array.from(
      document.querySelectorAll('.datepicker-close, .datepicker-close-wrap, [title*="סגור"], [aria-label*="סגור"]'),
    ).filter((el): el is HTMLElement => el instanceof HTMLElement);
    for (const n of closeNodes) {
      if (!isVisible(n)) {
        continue;
      }
      n.click();
    }
  });
  await page.keyboard.press('Escape').catch(() => undefined);
  await delay(180);
}

async function applyYahavDateRangeViaVisibleCalendars(page: Page, fromDate: Moment, toDate: Moment): Promise<void> {
  const fromDay = fromDate.date();
  const toDay = toDate.date();
  const toMonth = toDate.month() + 1;
  const toYear = toDate.year();
  const result = await page.evaluate(
    (fromD: number, toD: number, month: number, year: number) => {
      const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
      const monthIndex = (label: string): number => {
        const t = norm(label);
        const months: Array<[RegExp, number]> = [
          [/ינואר/i, 1],
          [/פברואר/i, 2],
          [/מרץ/i, 3],
          [/אפריל/i, 4],
          [/מאי/i, 5],
          [/יוני/i, 6],
          [/יולי/i, 7],
          [/אוגוסט/i, 8],
          [/ספטמבר/i, 9],
          [/אוקטובר/i, 10],
          [/נובמבר/i, 11],
          [/דצמבר/i, 12],
        ];
        for (const [rx, idx] of months) {
          if (rx.test(t)) {
            return idx;
          }
        }
        return -1;
      };
      const panels = Array.from(document.querySelectorAll('.date-picker-box, .datepicker-calendar, .date-options-cell'))
        .filter((el): el is HTMLElement => el instanceof HTMLElement)
        .map(el => {
          const labelNode = el.querySelector('.datepicker-month-wrap, .datepicker-button.datepicker-month');
          const label = norm((labelNode as HTMLElement | null)?.innerText || '');
          return { el, label, month: monthIndex(label) };
        })
        .filter(p => p.label && p.month > 0);

      const toPanel =
        panels.find(p => p.month === month && p.label.includes(String(year))) || panels[panels.length - 1];
      if (!toPanel) {
        return { applied: false as const, reason: 'no-calendar-panels' };
      }

      const clickDay = (panel: HTMLElement, day: number): boolean => {
        const targets = Array.from(panel.querySelectorAll('button, td, span, a, div')).filter(
          (el): el is HTMLElement => el instanceof HTMLElement,
        );
        for (const n of targets) {
          const t = norm(n.innerText || '');
          const cls = (n.className || '').toString().toLowerCase();
          if (t !== String(day)) {
            continue;
          }
          if (/disabled|old|new|outside|off/.test(cls)) {
            continue;
          }
          const rect = n.getBoundingClientRect();
          if (rect.width <= 2 || rect.height <= 2) {
            continue;
          }
          n.click();
          return true;
        }
        return false;
      };

      const first = clickDay(toPanel.el, fromD);
      const second = clickDay(toPanel.el, toD);
      return {
        applied: first && second,
        clickedFrom: first,
        clickedTo: second,
        panelLabel: toPanel.label,
      };
    },
    fromDay,
    toDay,
    toMonth,
    toYear,
  );
  yahavDebugLog('datepicker cell range apply', result);
  await delay(220);
}

/**
 * Some Yahav layouts keep a statement-type dropdown on "בחר" (choose), which can leave the table on a short preview.
 * Try selecting an "all transactions"-like option before applying date filters.
 */
async function selectYahavStatementScopeAllIfPresent(page: Page): Promise<void> {
  const minRowsAfterScope = Math.max(8, parseInt(process.env.YAHAV_MIN_STATEMENT_ROWS || '10', 10) || 10);

  const pickScopeOnce = async () => {
    const xhrWait = waitYahavAccountStatementPost(page);
    const result = await page.evaluate(() => {
      const scope = document.querySelector('.statement-options') || document.querySelector('main') || document.body;
      const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
      const selectedCandidates = Array.from(
        scope.querySelectorAll(
          'select, .selected-item-top, [class*="selected-item"], [class*="dropdown-toggle"], [role="combobox"], [aria-haspopup="listbox"]',
        ),
      ).filter((el): el is HTMLElement => el instanceof HTMLElement);

      const selectedTexts = selectedCandidates.map(el => norm(el.textContent || '')).filter(Boolean);
      let opened = false;
      for (const el of selectedCandidates) {
        const t = norm(el.textContent || '');
        if (/^בחר$|בחר/.test(t) || el.matches('.selected-item-top, [role="combobox"], [aria-haspopup="listbox"]')) {
          el.scrollIntoView({ block: 'center', inline: 'nearest' });
          el.click();
          opened = true;
          break;
        }
      }

      const selects = Array.from(scope.querySelectorAll('select')).filter(
        (el): el is HTMLSelectElement => el instanceof HTMLSelectElement,
      );
      for (const sel of selects) {
        const options = Array.from(sel.options);
        const target =
          options.find(o => /מתחילת החודש|חודש נוכחי|current month/i.test(norm(o.text))) ||
          options.find(o => /כל|all|תנועות|עו"ש/i.test(norm(o.text))) ||
          options.find(o => /3 חודשים אחרונים|last 3/i.test(norm(o.text)));
        if (target && sel.value !== target.value) {
          sel.value = target.value;
          sel.dispatchEvent(new Event('input', { bubbles: true }));
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          return {
            changed: true as const,
            mode: 'native-select',
            selectedTexts,
            targetText: norm(target.text),
            opened,
          };
        }
      }

      const optionNodes = Array.from(
        scope.querySelectorAll(
          '.drop-down-item, .drop-down-item-top, .dropdown-menu li, .dropdown-menu a, [role="option"], li[ng-repeat], .selected-item-holder li',
        ),
      ).filter((el): el is HTMLElement => el instanceof HTMLElement);

      const pickOption = (pattern: RegExp) =>
        optionNodes.find(el => {
          const t = norm(el.textContent || '');
          if (!t || t.length > 120 || /^בחר$/.test(t)) {
            return false;
          }
          return pattern.test(t);
        });

      const option =
        pickOption(/מתחילת החודש|חודש נוכחי|current month/i) ||
        pickOption(/כל|all|תנועות|עו"ש/i) ||
        pickOption(/3 חודשים אחרונים|last 3/i);

      if (option) {
        const optionText = norm(option.textContent || '');
        option.scrollIntoView({ block: 'center', inline: 'nearest' });
        option.click();
        return { changed: true as const, mode: 'menu-option', selectedTexts, targetText: optionText, opened };
      }

      return { changed: false as const, selectedTexts, opened };
    });
    await xhrWait;
    return result;
  };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const rowsBefore = await countYahavListRows(page);
    const result = await pickScopeOnce();
    if (result.changed) {
      await delay(400);
      await waitYahavLoadingSpinnerGoneIfPresent(page);
    }
    const rowsAfter = await waitYahavStatementListRowsAtLeast(page, Math.max(minRowsAfterScope, rowsBefore + 2), 22000);
    const scopeLabel = await page.evaluate(() => {
      const el =
        document.querySelector('.statement-options .selected-item-top') ||
        document.querySelector('.statement-options .selected-item');
      return (el?.textContent || '').replace(/\s+/g, ' ').trim();
    });
    const scopeOk = scopeLabel.length > 0 && !/^בחר$/.test(scopeLabel);
    yahavDebugLog('statement scope selector', { attempt, rowsBefore, rowsAfter, scopeLabel, scopeOk, ...result });
    if (scopeOk && rowsAfter >= minRowsAfterScope) {
      return;
    }
    await delay(500);
  }
}

/** Sets "from" / "to" on visible statement date inputs. RTL: "מ" is usually right of "עד" — order by bounding box, not DOM index. */
async function setYahavDateRangeInputs(page: Page, fromFormatted: string, toFormatted: string): Promise<boolean> {
  return page.evaluate(
    (fromVal, toVal) => {
      const isRtl = (): boolean => {
        const d = getComputedStyle(document.documentElement).direction;
        const b = getComputedStyle(document.body).direction;
        return d === 'rtl' || b === 'rtl' || document.documentElement.getAttribute('dir') === 'rtl';
      };
      const rtl = isRtl();
      const score = (inp: HTMLInputElement) => {
        const r = inp.getBoundingClientRect();
        return rtl ? r.right : r.left;
      };
      const collectPairs = (root: Document | Element): HTMLInputElement[] => {
        const cells = Array.from(root.querySelectorAll('div.date-options-cell'));
        const pairs: { input: HTMLInputElement; s: number }[] = [];
        for (const cell of cells) {
          const inp = cell.querySelector('input:not([type="hidden"])');
          if (inp instanceof HTMLInputElement) {
            pairs.push({ input: inp, s: score(inp) });
          }
        }
        pairs.sort((a, b) => b.s - a.s);
        return pairs.map(p => p.input);
      };

      const stmt = document.querySelector('.statement-options');
      let ordered: HTMLInputElement[] = collectPairs(stmt || document.body);
      if (ordered.length < 2 && stmt) {
        const bare = Array.from(stmt.querySelectorAll('input:not([type="hidden"])')).filter(
          (el): el is HTMLInputElement => el instanceof HTMLInputElement,
        );
        if (bare.length >= 2) {
          ordered = bare
            .map(inp => ({ input: inp, s: score(inp) }))
            .sort((a, b) => b.s - a.s)
            .map(p => p.input);
        }
      }
      if (ordered.length < 2) {
        ordered = collectPairs(document.body);
      }
      if (ordered.length === 0) {
        ordered = Array.from(document.querySelectorAll('div.date-options-cell input:not([type="hidden"])')).filter(
          (el): el is HTMLInputElement => el instanceof HTMLInputElement,
        );
        if (ordered.length >= 2) {
          ordered = ordered
            .map(inp => ({ input: inp, s: score(inp) }))
            .sort((a, b) => b.s - a.s)
            .map(p => p.input);
        }
      }
      if (ordered.length === 0) {
        return false;
      }

      const apply = (input: HTMLInputElement, value: string) => {
        input.scrollIntoView({ block: 'center', inline: 'nearest' });
        input.focus();
        const proto = window.HTMLInputElement.prototype;
        const desc = Object.getOwnPropertyDescriptor(proto, 'value');
        if (desc?.set) {
          desc.set.call(input, value);
        } else {
          input.value = value;
        }
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        try {
          input.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertFromPaste' }));
        } catch {
          /* InputEvent not constructible in very old contexts */
        }
        input.dispatchEvent(new Event('blur', { bubbles: true }));
      };

      if (ordered.length === 1) {
        apply(ordered[0], fromVal);
        return true;
      }
      apply(ordered[0], fromVal);
      apply(ordered[1], toVal);
      return true;
    },
    fromFormatted,
    toFormatted,
  );
}

function parseYahavUiDateToken(token: string | null): Moment | null {
  if (!token) {
    return null;
  }
  const m = moment(token, DATE_FORMAT, true);
  return m.isValid() ? m : null;
}

/** Applies from/to date controls and search nudges (scope dropdown must already be set). */
async function applyYahavDateFilterOnly(page: Page, startDate: Moment): Promise<void> {
  const formattedFrom = startDate.format(DATE_FORMAT);
  const formattedTo = moment().format(DATE_FORMAT);
  const startDateDay = startDate.format('D');
  const startDateMonth = startDate.format('M');
  const startDateYear = startDate.format('Y');

  const pickerMode = await runYahavStage('open from-date picker', () => openYahavFromDatePicker(page));
  yahavDebugLog('applyYahavDateFilterOnly picker mode', { pickerMode, formattedFrom, formattedTo });

  if (pickerMode === 'input') {
    const setInput = await runYahavStage('set date range inputs', () =>
      setYahavDateRangeInputs(page, formattedFrom, formattedTo),
    );
    if (!setInput) {
      throw new Error('Yahav: input mode selected but failed to set from/to date inputs.');
    }
    await runYahavStage('type date range inputs with keyboard', () =>
      typeYahavDateRangeInputsWithKeyboard(page, formattedFrom, formattedTo),
    );
    await runYahavStage('apply range via visible calendar cells', () =>
      applyYahavDateRangeViaVisibleCalendars(page, startDate, moment()),
    );
    await runYahavStage('close open date pickers', () => closeYahavOpenDatePickers(page));
  } else {
    const monthFromPick = '.pmu-month';
    await runYahavStage('wait month picker', () => waitUntilElementFound(page, monthFromPick, true));
    await runYahavStage('open month options', () => clickButton(page, monthFromPick));
    await runYahavStage('wait month grid', () => waitUntilElementFound(page, '.pmu-months > div:nth-child(1)', true));
    await runYahavStage('wait month picker for year switch', () => waitUntilElementFound(page, monthFromPick, true));
    await runYahavStage('open year options', () => clickButton(page, monthFromPick));
    await runYahavStage('wait year grid', () => waitUntilElementFound(page, '.pmu-years > div:nth-child(1)', true));

    let yearMatched = false;
    for (let i = 1; i < 13; i += 1) {
      const selector = `.pmu-years > div:nth-child(${i})`;
      const year = await page.$eval(selector, y => (y as HTMLElement).innerText);
      if (startDateYear === year) {
        await runYahavStage(`select year ${startDateYear}`, () => clickButton(page, selector));
        yearMatched = true;
        break;
      }
    }
    if (!yearMatched) {
      throw new Error(`Yahav: calendar year ${startDateYear} not found in year grid.`);
    }

    await runYahavStage('wait month grid before selecting month', () =>
      waitUntilElementFound(page, '.pmu-months > div:nth-child(1)', true),
    );
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
  }

  await runYahavStage('post-filter search click', () => clickYahavStatementSearchIfPresent(page));
  await runYahavStage('post-filter search icon click', () => clickYahavStatementSearchIconIfPresent(page));
  if (process.env.YAHAV_DATE_TOOLBAR_NUDGE === '1' || process.env.YAHAV_DATE_TOOLBAR_NUDGE === 'true') {
    await runYahavStage('date-range toolbar click', () => clickYahavDateRangeToolbarAction(page));
  }
  await runYahavStage('post-filter hard search nudge', () => clickYahavStatementSearchHard(page));
  await waitYahavLoadingSpinnerGoneIfPresent(page);
}

async function enforceYahavStatementLoaded(page: Page, startDate: Moment): Promise<void> {
  const minRows = Math.min(30, Math.max(8, parseInt(process.env.YAHAV_MIN_STATEMENT_ROWS || '10', 10) || 10));
  const formattedFrom = startDate.format(DATE_FORMAT);
  const formattedTo = moment().format(DATE_FORMAT);

  const isIncomplete = (snap: YahavStatementDomSnapshot): boolean => {
    const oldest = parseYahavUiDateToken(snap.oldestDateToken);
    if (!snap.onCurrentAccountPage) {
      return true;
    }
    if (/^בחר$/.test(snap.scopeSelectedText)) {
      const hasEnoughRows = snap.listRowCount >= minRows;
      const hasRichDateFootprint = snap.dateTokenCount2026 >= Math.max(12, minRows);
      const coversRequestedFromDate = !oldest || !startDate.isBefore(oldest, 'day');
      // In some Yahav overlays the visible scope label stays "בחר" even when full statement rows are loaded.
      if (!(hasEnoughRows && coversRequestedFromDate && (hasRichDateFootprint || snap.hasSalaryWord))) {
        return true;
      }
    }
    if (snap.listRowCount < minRows) {
      return true;
    }
    if (oldest && startDate.isBefore(oldest, 'day')) {
      return true;
    }
    return false;
  };

  let snap = await readYahavStatementDomSnapshot(page);
  yahavDebugLog('statement enforce: initial', snap);

  for (let attempt = 0; attempt < 3 && isIncomplete(snap); attempt += 1) {
    yahavDebugLog('statement enforce: recovery', { attempt, snap });
    await ensureYahavOnCurrentAccountTransactionsPage(page);
    await selectYahavStatementScopeAllIfPresent(page);
    await applyYahavDateFilterOnly(page, startDate);
    await page.waitForNetworkIdle({ idleTime: 500, timeout: 35000 }).catch(() => undefined);
    await waitYahavStatementListRowsAtLeast(page, minRows, 25000);
    try {
      await assertYahavDateInputsOnScreen(page, formattedFrom, formattedTo);
    } catch (err) {
      yahavDebugLog('statement enforce: date assert warning', {
        attempt,
        message: err instanceof Error ? err.message : String(err),
      });
    }
    snap = await readYahavStatementDomSnapshot(page);
    yahavDebugLog('statement enforce: after recovery', { attempt, snap });
  }

  if (yahavStrictStatementEnabled() && isIncomplete(snap)) {
    throw new Error(
      `Yahav: statement data incomplete after date search (expected from ${formattedFrom}). ` +
        `Still on preview or wrong period — snapshot=${JSON.stringify(snap)}. ` +
        'Host apps must land on #/main/accounts/current/ and show full statement rows for the requested from-date.',
    );
  }
}

// Manipulate the calendar drop down to choose the txs start date.
async function searchByDates(page: Page, startDate: Moment) {
  const formattedFrom = startDate.format(DATE_FORMAT);
  const formattedTo = moment().format(DATE_FORMAT);
  const debugDom = process.env.YAHAV_DEBUG_DOM === '1' || process.env.YAHAV_DEBUG_DOM === 'true';

  await runYahavStage('ensure current account transactions page', () =>
    ensureYahavOnCurrentAccountTransactionsPage(page),
  );

  if (debugDom) {
    await debugYahavStatementControls(page, 'before-scope-select');
  }
  await runYahavStage('set statement scope to all if present', () => selectYahavStatementScopeAllIfPresent(page));
  if (debugDom) {
    await debugYahavStatementControls(page, 'after-scope-select');
    await debugYahavDateToolbarCandidates(page, 'after-scope-select');
  }

  const dateInputCount = await page.evaluate(() => {
    const inCells = document.querySelectorAll('div.date-options-cell input:not([type="hidden"])').length;
    const stmt = document.querySelector('.statement-options');
    const inStmt = stmt ? stmt.querySelectorAll('input:not([type="hidden"])').length : 0;
    return Math.max(inCells, inStmt);
  });
  yahavDebugLog('searchByDates', { dateInputCount, url: page.url(), formattedFrom, formattedTo });

  await runYahavStage('apply date filter', () => applyYahavDateFilterOnly(page, startDate));

  if (debugDom) {
    await debugYahavDateToolbarCandidates(page, 'after-input-set');
    const dateInputs = await page.evaluate(() =>
      Array.from(document.querySelectorAll('div.date-options-cell input:not([type="hidden"])'))
        .filter((el): el is HTMLInputElement => el instanceof HTMLInputElement)
        .map(el => ({
          value: el.value,
          placeholder: el.placeholder || '',
          className: (el.className || '').slice(0, 120),
        })),
    );
    yahavDebugLog('searchByDates input values after set', { dateInputs });
  }

  await runYahavStage('assert date inputs on screen', () =>
    assertYahavDateInputsOnScreen(page, formattedFrom, formattedTo),
  );
  await runYahavStage('enforce full statement loaded', () => enforceYahavStatementLoaded(page, startDate));
  await page.waitForNetworkIdle({ idleTime: 500, timeout: 35000 }).catch(() => undefined);

  if (debugDom) {
    const postSearchDom = await page.evaluate(() => {
      const list = document.querySelector('.list-item-holder');
      const listSelectorPresent = !!list;
      const listItemHolderInnerText = (list instanceof HTMLElement ? list.innerText : '')
        .replace(/\s+/g, ' ')
        .slice(0, 400);
      const buttonsTextSeen = Array.from(document.querySelectorAll('button, [role="button"]'))
        .map(el => ((el as HTMLElement).innerText || el.textContent || '').replace(/\s+/g, ' ').trim())
        .filter(t => t.length > 0 && t.length < 60)
        .slice(0, 25);
      const dateTokenCount = (
        listItemHolderInnerText.match(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/g) || []
      ).length;
      return { listSelectorPresent, listItemHolderInnerText, buttonsTextSeen, dateTokenCount };
    });
    yahavDebugLog('searchByDates: post-search dom', postSearchDom);
  }
}

async function fetchAccountData(
  page: Page,
  startDate: Moment,
  accountID: string,
  options?: ScraperOptions,
): Promise<TransactionsAccount> {
  let detachNet: (() => void) | undefined;
  if (process.env.YAHAV_DEBUG_NET === '1' || process.env.YAHAV_DEBUG_NET === 'true') {
    // Reduce silent cache hits while debugging network flow.
    await page.setCacheEnabled(false).catch(() => undefined);
    const requestHandler = (req: HTTPRequest) => {
      const u = req.url();
      if (!isYahavHostUrl(u)) {
        return;
      }
      const pd = req.postData?.();
      yahavNetLog('request', {
        method: req.method(),
        resourceType: req.resourceType(),
        url: u.slice(0, 360),
        postData: pd ? pd.replace(/\s+/g, ' ').slice(0, 1200) : undefined,
      });
    };
    const responseHandler = (res: HTTPResponse) => {
      const u = res.url();
      if (!isYahavHostUrl(u)) {
        return;
      }
      const req = res.request();
      const ct = (res.headers()['content-type'] || '').toLowerCase();
      yahavNetLog('response', {
        status: res.status(),
        method: req.method(),
        resourceType: req.resourceType(),
        url: u.slice(0, 360),
        contentType: ct.slice(0, 120),
      });
      if (
        (process.env.YAHAV_DEBUG_NET_BODY === '1' || process.env.YAHAV_DEBUG_NET_BODY === 'true') &&
        /BaNCSDigitalApp\/account/i.test(u)
      ) {
        void res
          .text()
          .then(body => {
            const compact = body.replace(/\s+/g, ' ');
            const dates = (compact.match(/\d{2}\/\d{2}\/20\d{2}/g) || []).length;
            yahavNetLog('responseBody', {
              url: u.slice(0, 220),
              hasPayloadDataEncrypted: /"DataEn"/.test(compact),
              hasPayloadDataClear: /"DataCl"|PayloadData|transactions|txn|statement/i.test(compact),
              dateTokenCount: dates,
              hasSalaryWord: /משכורת/.test(compact),
              snippet: compact.slice(0, 700),
            });
          })
          .catch(() => undefined);
      }
    };
    const failedHandler = (req: HTTPRequest) => {
      const u = req.url();
      if (!isYahavHostUrl(u)) {
        return;
      }
      yahavNetLog('requestfailed', {
        method: req.method(),
        resourceType: req.resourceType(),
        url: u.slice(0, 360),
        errorText: req.failure()?.errorText,
      });
    };
    page.on('request', requestHandler);
    page.on('response', responseHandler);
    page.on('requestfailed', failedHandler);
    detachNet = () => {
      page.off('request', requestHandler);
      page.off('response', responseHandler);
      page.off('requestfailed', failedHandler);
    };
  }
  try {
    await runYahavStage('pre-search spinner wait', () => waitYahavLoadingSpinnerGoneIfPresent(page));
    yahavNetLog('marker', { stage: 'before-searchByDates', url: page.url() });
    await runYahavStage('search by dates', () => searchByDates(page, startDate));
    yahavNetLog('marker', { stage: 'after-searchByDates', url: page.url() });
    if (process.env.YAHAV_DATE_TOOLBAR_NUDGE === '1' || process.env.YAHAV_DATE_TOOLBAR_NUDGE === 'true') {
      await runYahavStage('date-range toolbar action nudge', () => clickYahavDateRangeToolbarAction(page));
    }
    await runYahavStage('statement icon search nudge', () => clickYahavStatementSearchIconIfPresent(page));
    await runYahavStage('statement hard search nudge', () => clickYahavStatementSearchHard(page));
    await runYahavStage('post-search spinner wait', () => waitYahavLoadingSpinnerGoneIfPresent(page));
    await runYahavStage('network idle after statement search', () =>
      page.waitForNetworkIdle({ idleTime: 500, timeout: 35000 }).catch(() => undefined),
    );
    await runYahavStage('final statement enforce', () => enforceYahavStatementLoaded(page, startDate));
    await delay(400);
    const txns = await runYahavStage('fetch account transactions', () => getAccountTransactions(page, options));

    return {
      accountNumber: accountID,
      txns,
    };
  } finally {
    detachNet?.();
  }
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
    // Headless Chromium in Docker defaults to ~800x600, which collapses the virtualized statement
    // list to ~5 rows regardless of scroll. Force a wider viewport BEFORE any DOM probe.
    await runYahavStage('ensure viewport', () => ensureYahavViewport(this.page));

    // Goto statements page
    await runYahavStage('wait account details card', () =>
      waitUntilElementFound(this.page, ACCOUNT_DETAILS_SELECTOR, true),
    );
    await runYahavStage('open account details', () => clickButton(this.page, ACCOUNT_DETAILS_SELECTOR));
    await runYahavStage('wait statement options', () =>
      waitUntilElementFound(this.page, '.statement-options .selected-item-top', true),
    );
    await runYahavStage('goto current-account transactions page', () =>
      gotoYahavCurrentAccountTransactionsPage(this.page),
    );
    await runYahavStage('statement spinner wait', () => waitYahavLoadingSpinnerGoneIfPresent(this.page));

    const monthsRaw = process.env.YAHAV_STATEMENT_MONTHS_BACK;
    const monthsBack =
      monthsRaw && !Number.isNaN(parseInt(monthsRaw, 10)) ? Math.min(24, Math.max(1, parseInt(monthsRaw, 10))) : 4;
    const defaultStartMoment = moment().subtract(monthsBack, 'months').add(1, 'day');
    const startDate = this.options.startDate || defaultStartMoment.toDate();
    const startMoment = moment.max(defaultStartMoment, moment(startDate));

    const accounts = await runYahavStage('fetch accounts', () => fetchAccounts(this.page, startMoment, this.options));
    const suspiciousGapDays =
      process.env.YAHAV_COVERAGE_GAP_DAYS && !Number.isNaN(parseInt(process.env.YAHAV_COVERAGE_GAP_DAYS, 10))
        ? Math.max(1, parseInt(process.env.YAHAV_COVERAGE_GAP_DAYS, 10))
        : 5;
    const coverage = buildYahavCoverageDiagnostics(accounts, startMoment, suspiciousGapDays);
    const warnings: string[] = [];
    if (coverage.suspiciousCoverage) {
      const warning =
        `Yahav coverage anomaly: requestedStartDate=${coverage.requestedStartDate}, ` +
        `minTxnDate=${coverage.minTxnDate ?? 'null'}, txnsCount=${coverage.txnsCount}, ` +
        `coverageGapDays=${coverage.coverageGapDays}.`;
      warnings.push(warning);
      yahavDebugLog('coverage anomaly detected', {
        warning,
        diagnostics: coverage,
      });
    }

    return {
      success: true,
      accounts,
      partial: coverage.suspiciousCoverage,
      warnings: warnings.length > 0 ? warnings : undefined,
      diagnostics: {
        requestedStartDate: coverage.requestedStartDate,
        minTxnDate: coverage.minTxnDate,
        maxTxnDate: coverage.maxTxnDate,
        txnsCount: coverage.txnsCount,
        coverageGapDays: coverage.coverageGapDays,
      },
    };
  }
}

export default YahavScraper;
