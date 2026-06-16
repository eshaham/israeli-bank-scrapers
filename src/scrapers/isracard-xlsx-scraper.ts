import * as XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import os from 'os';
import moment, { type Moment } from 'moment';
import { type Page } from 'puppeteer';
import { SHEKEL_CURRENCY } from '../constants';
import { ScraperProgressTypes } from '../definitions';
import { getDebug } from '../helpers/debug';
import getAllMonthMoments from '../helpers/dates';
import { filterOldTransactions, fixInstallments } from '../helpers/transactions';
import {
  TransactionStatuses,
  TransactionTypes,
  type Transaction,
  type TransactionInstallments,
  type TransactionsAccount,
} from '../transactions';
import { BaseScraperWithBrowser } from './base-scraper-with-browser';
import { ScraperErrorTypes } from './errors';
import { type ScraperScrapingResult } from './interface';

const BASE_URL = 'https://digital.isracard.co.il';
const TRANSACTIONS_URL = 'https://web.isracard.co.il/transactions';

const INSTALLMENTS_KEYWORD = 'תשלום';
const DATE_FORMAT = 'DD.MM.YY';

const CURRENCY_MAP: Record<string, string> = {
  '₪': SHEKEL_CURRENCY,
  $: 'USD',
  '€': 'EUR',
  '£': 'GBP',
};

const SELECTORS = {
  passwordLoginToggleText: 'או כניסה עם סיסמה קבועה',
  idInput: 'input#otpLoginId_ID',
  card6Input: 'input#cardnum',
  passwordInput: 'input#otpLoginPwd',
};

const debug = getDebug('isracard-xlsx');

type ScraperSpecificCredentials = { id: string; password: string; card6Digits: string };

// --- XLSX Parsing Helpers ---

function parseDate(ddmmyy: string): Moment | null {
  if (!ddmmyy || typeof ddmmyy !== 'string') return null;
  const m = moment(ddmmyy, DATE_FORMAT);
  return m.isValid() ? m : null;
}

function parseBillingDate(cellValue: string | undefined, yearContext: string): Moment | null {
  if (!cellValue) return null;
  // Format: "לחיוב ב-DD.MM"
  const match = cellValue.match(/(\d{2})\.(\d{2})/);
  if (!match) return null;
  const day = parseInt(match[1], 10);
  const month = parseInt(match[2], 10) - 1;
  return moment({ year: parseInt(yearContext, 10), month, day });
}

function parseCurrency(symbol: string | undefined): string {
  if (!symbol) return SHEKEL_CURRENCY;
  const trimmed = symbol.trim();
  return CURRENCY_MAP[trimmed] || trimmed;
}

function parseInstallments(memo: string | undefined): TransactionInstallments | undefined {
  if (!memo || !memo.includes(INSTALLMENTS_KEYWORD)) return undefined;
  // Match "תשלום X מתוך Y"
  const match = memo.match(/תשלום\s+(\d+)\s+מתוך\s+(\d+)/);
  if (!match) return undefined;
  return { number: parseInt(match[1], 10), total: parseInt(match[2], 10) };
}

function parseXlsx(
  buffer: Buffer,
  monthContext: string,
  yearContext: string,
): { processedDate: Moment | null; transactions: Transaction[] } {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames.find(n => n.includes('פירוט')) || workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  if (!sheet || !sheet['!ref']) {
    debug(`empty sheet in xlsx for ${monthContext}.${yearContext}`);
    return { processedDate: null, transactions: [] };
  }

  // Extract billing date from row 6 (0-indexed row 5)
  const billingCell =
    sheet[XLSX.utils.encode_cell({ r: 5, c: 7 })]?.v || sheet[XLSX.utils.encode_cell({ r: 5, c: 0 })]?.v;
  const processedDate = parseBillingDate(billingCell, yearContext);

  const ref = sheet['!ref'];
  const range = XLSX.utils.decode_range(ref);
  const transactions: Transaction[] = [];

  // Find the header row (contains "תאריך רכישה")
  let dataStartRow = -1;
  for (let r = 0; r <= Math.min(range.e.r, 20); r++) {
    const cellVal = sheet[XLSX.utils.encode_cell({ r, c: 0 })]?.v;
    if (cellVal && typeof cellVal === 'string' && cellVal.includes('תאריך רכישה')) {
      dataStartRow = r + 1;
      break;
    }
  }

  if (dataStartRow === -1) {
    debug(`could not find header row in xlsx for ${monthContext}.${yearContext}`);
    return { processedDate, transactions: [] };
  }

  for (let r = dataStartRow; r <= range.e.r; r++) {
    const dateVal = sheet[XLSX.utils.encode_cell({ r, c: 0 })]?.v;
    const nameVal = sheet[XLSX.utils.encode_cell({ r, c: 1 })]?.v;

    // Stop at summary row
    if (!dateVal && nameVal && typeof nameVal === 'string' && nameVal.includes('סה"כ')) break;
    if (!dateVal) continue;

    const originalAmount = sheet[XLSX.utils.encode_cell({ r, c: 2 })]?.v;
    const originalCurrency = sheet[XLSX.utils.encode_cell({ r, c: 3 })]?.v;
    const chargedAmount = sheet[XLSX.utils.encode_cell({ r, c: 4 })]?.v;
    const chargedCurrency = sheet[XLSX.utils.encode_cell({ r, c: 5 })]?.v;
    const voucherNumber = sheet[XLSX.utils.encode_cell({ r, c: 6 })]?.v || '';
    const memo: string = sheet[XLSX.utils.encode_cell({ r, c: 7 })]?.v || '';

    const installments = parseInstallments(memo);
    const parsedDate = parseDate(dateVal);
    if (!parsedDate || !nameVal) continue;

    const txnProcessedDate = processedDate ? processedDate.toISOString() : parsedDate.toISOString();

    transactions.push({
      type: installments ? TransactionTypes.Installments : TransactionTypes.Normal,
      identifier: String(voucherNumber),
      date: parsedDate.toISOString(),
      processedDate: txnProcessedDate,
      originalAmount: -(originalAmount || chargedAmount || 0),
      originalCurrency: parseCurrency(originalCurrency),
      chargedAmount: -(chargedAmount || originalAmount || 0),
      chargedCurrency: parseCurrency(chargedCurrency),
      description: String(nameVal).trim(),
      memo: String(memo).replace(/\n/g, ' ').trim(),
      status: TransactionStatuses.Completed,
      installments,
    });
  }

  return { processedDate, transactions };
}

// --- Browser Helpers ---

async function waitForFile(dir: string, timeoutMs = 30000): Promise<Buffer | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.xlsx') && !f.startsWith('.'));
    if (files.length > 0) {
      const filePath = path.join(dir, files[0]);
      await new Promise(r => setTimeout(r, 1000));
      const buf = fs.readFileSync(filePath);
      fs.unlinkSync(filePath);
      return buf;
    }
    await new Promise(r => setTimeout(r, 500));
  }
  return null;
}

async function clickElementByText(page: Page, text: string): Promise<{ x: number; y: number } | null> {
  const coords = await page.evaluate((searchText: string) => {
    const elements = document.querySelectorAll('a, button, span, div, label, p');
    let target: Element | null = null;
    for (const el of elements) {
      if (el.textContent?.includes(searchText)) {
        target = el;
      }
    }
    if (!target) return null;
    const rect = target.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }, text);
  return coords;
}

async function fillField(page: Page, selector: string, value: string): Promise<void> {
  await page.waitForSelector(selector, { visible: true, timeout: 5000 });
  // Clear the field using DOM manipulation (cross-platform, no OS-specific key combos)
  await page.$eval(selector, el => {
    const input = el as HTMLInputElement;
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await new Promise(r => setTimeout(r, 200));
  await page.type(selector, String(value), { delay: 80 });
  await new Promise(r => setTimeout(r, 500));
}

// --- Scraper ---

class IsracardXlsxScraper extends BaseScraperWithBrowser<ScraperSpecificCredentials> {
  private downloadDir: string = '';

  async login(credentials: ScraperSpecificCredentials): Promise<ScraperScrapingResult> {
    // Apply stealth overrides to avoid WAF detection
    const chromeVersion = await this.page
      .browser()
      .version()
      .then(v => {
        const match = v.match(/Chrome\/(\d+)/);
        return match ? match[1] : '127';
      });
    const fullVersion = `${chromeVersion}.0.0.0`;
    const userAgent = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${fullVersion} Safari/537.36`;

    await this.page.setUserAgent(userAgent);

    await this.page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    debug('navigating to Isracard login');
    await this.navigateTo(`${BASE_URL}/personalarea/login`, 'networkidle2');

    this.emitProgress(ScraperProgressTypes.LoggingIn);

    // Click "או כניסה עם סיסמה קבועה" to switch to password login mode
    debug('looking for password login toggle');
    const toggleCoords = await clickElementByText(this.page, SELECTORS.passwordLoginToggleText);
    if (!toggleCoords) {
      return {
        success: false,
        errorType: ScraperErrorTypes.General,
        errorMessage: 'Could not find password login toggle',
      };
    }
    await this.page.mouse.click(toggleCoords.x, toggleCoords.y);
    debug(`clicked password login toggle at (${toggleCoords.x}, ${toggleCoords.y})`);
    await new Promise(r => setTimeout(r, 3000));

    // Wait for password input to confirm the form switched
    await this.page.waitForSelector(SELECTORS.passwordInput, { visible: true, timeout: 15000 });
    debug('password login form is ready');

    // Fill credentials
    await fillField(this.page, SELECTORS.idInput, credentials.id);
    await fillField(this.page, SELECTORS.card6Input, credentials.card6Digits);
    await fillField(this.page, SELECTORS.passwordInput, credentials.password);

    // Click login button ("כניסה לחשבון שלי")
    const loginClicked = await this.page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button.btn-send'));
      const btn = buttons.find(b => b.textContent?.includes('כניסה לחשבון שלי'));
      if (!btn) return false;
      (btn as HTMLElement).click();
      return true;
    });
    if (!loginClicked) {
      return {
        success: false,
        errorType: ScraperErrorTypes.General,
        errorMessage: 'Could not find login button',
      };
    }

    // Wait for navigation after login
    await this.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
    debug(`login completed, current URL: ${this.page.url()}`);

    const currentUrl = this.page.url();
    if (currentUrl.includes('login') || currentUrl.includes('Login')) {
      this.emitProgress(ScraperProgressTypes.LoginFailed);
      return {
        success: false,
        errorType: ScraperErrorTypes.InvalidPassword,
        errorMessage: 'Login failed - still on login page',
      };
    }

    this.emitProgress(ScraperProgressTypes.LoginSuccess);
    return { success: true };
  }

  async fetchData(): Promise<ScraperScrapingResult> {
    const defaultStartMoment = moment().subtract(1, 'years');
    const startDate = this.options.startDate || defaultStartMoment.toDate();
    const startMoment = moment.max(defaultStartMoment, moment(startDate));

    const futureMonthsToScrape = this.options.futureMonthsToScrape ?? 1;
    const allMonths = getAllMonthMoments(startMoment, futureMonthsToScrape);

    this.downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'isracard-'));
    debug(`using download dir: ${this.downloadDir}`);

    try {
      // Use explicitly provided card suffixes, or scrape the default card only
      const cardSuffixes = this.options.cardSuffixes?.length ? this.options.cardSuffixes : [''];
      if (cardSuffixes[0]) {
        debug(`scraping ${cardSuffixes.length} cards: ${cardSuffixes.join(', ')}`);
      } else {
        debug('no card suffixes provided, scraping default card only');
      }

      const accountTxns: Record<string, Transaction[]> = {};
      let totalAttempts = 0;
      let failedAttempts = 0;
      let lastError = '';

      for (const cardSuffix of cardSuffixes) {
        for (const monthMoment of allMonths) {
          const mm = String(monthMoment.month() + 1).padStart(2, '0');
          const yyyy = String(monthMoment.year());
          totalAttempts++;

          try {
            const transactions = await this.scrapeMonth(mm, yyyy, cardSuffix);

            let filtered = transactions;
            if (!this.options.combineInstallments) {
              filtered = fixInstallments(filtered);
            }
            if (this.options.outputData?.enableTransactionsFilterByDate ?? true) {
              filtered = filterOldTransactions(filtered, startMoment, this.options.combineInstallments || false);
            }

            const accountKey = cardSuffix || 'default';
            if (!accountTxns[accountKey]) {
              accountTxns[accountKey] = [];
            }
            accountTxns[accountKey].push(...filtered);
          } catch (err) {
            failedAttempts++;
            lastError = (err as Error).message;
            debug(`error scraping card ${cardSuffix} ${mm}.${yyyy}: ${lastError}`);
          }
        }
      }

      // If every single scrape attempt failed, report an error
      if (failedAttempts === totalAttempts) {
        return {
          success: false,
          errorType: ScraperErrorTypes.Generic,
          errorMessage: `All ${totalAttempts} scrape attempts failed. Last error: ${lastError}`,
        };
      }

      const accounts: TransactionsAccount[] = Object.keys(accountTxns).map(accountNumber => ({
        accountNumber,
        txns: accountTxns[accountNumber],
      }));

      debug(
        `scraped ${accounts.reduce((sum, a) => sum + a.txns.length, 0)} total transactions (${failedAttempts}/${totalAttempts} failed)`,
      );

      return { success: true, accounts };
    } finally {
      try {
        fs.rmSync(this.downloadDir, { recursive: true, force: true });
      } catch {
        // noop
      }
    }
  }

  private async scrapeMonth(month: string, year: string, cardSuffix: string): Promise<Transaction[]> {
    let url = `${TRANSACTIONS_URL}?monthAndYear=${month}.${year}`;
    if (cardSuffix) {
      url += `&cardSuffix=${cardSuffix}`;
    }
    debug(`navigating to ${url}`);
    await this.page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));

    const buffer = await this.downloadXlsx();
    if (!buffer) return [];

    const { transactions } = parseXlsx(buffer, month, year);
    debug(`parsed ${transactions.length} transactions for card ${cardSuffix} ${month}.${year}`);
    return transactions;
  }

  private async downloadXlsx(): Promise<Buffer | null> {
    // Clear any existing files in download dir
    const existing = fs.readdirSync(this.downloadDir).filter(f => f.endsWith('.xlsx'));
    for (const f of existing) fs.unlinkSync(path.join(this.downloadDir, f));

    // Set up CDP download
    const cdp = await this.page.target().createCDPSession();
    await cdp.send('Page.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: this.downloadDir,
    });

    await new Promise(r => setTimeout(r, 2000));

    // Scroll the download button into view
    const hasButton = await this.page.evaluate(() => {
      const elements = document.querySelectorAll('a, button, span, div, label');
      let target: Element | null = null;
      for (const el of elements) {
        if (el.textContent?.includes('הורדה ל- Excel') || el.textContent?.includes('הורדה ל-Excel')) {
          target = el;
        }
      }
      if (!target) return false;
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return true;
    });

    if (!hasButton) {
      debug('no download button found on this page, skipping');
      await cdp.detach();
      return null;
    }

    await new Promise(r => setTimeout(r, 1500));

    // Get button coordinates after scrolling
    const dlClickPos = await clickElementByText(this.page, 'הורדה ל');
    if (!dlClickPos) {
      debug('no download button found after scroll, skipping');
      await cdp.detach();
      return null;
    }

    await this.page.mouse.click(dlClickPos.x, dlClickPos.y);
    debug(`clicked download button at (${dlClickPos.x}, ${dlClickPos.y}), waiting for file...`);

    const buffer = await waitForFile(this.downloadDir);
    await cdp.detach();

    if (!buffer) {
      debug('download timed out');
      return null;
    }

    debug(`downloaded xlsx: ${buffer.length} bytes`);
    return buffer;
  }
}

export default IsracardXlsxScraper;
