import moment, { type Moment } from 'moment';
import { type HTTPResponse, type Page } from 'puppeteer';
import { SHEKEL_CURRENCY } from '../../constants';
import { getDebug } from '../../helpers/debug';
import { waitUntilElementFound } from '../../helpers/elements-interactions';
import { getRawTransaction } from '../../helpers/transactions';
import {
  TransactionStatuses,
  TransactionTypes,
  type Security,
  type Transaction,
  type TransactionsAccount,
} from '../../transactions';
import { type ScraperOptions } from '../interface';

const debug = getDebug('leumi-investments');
const BASE_URL = 'https://hb2.bankleumi.co.il';
const TRADING_URL = `${BASE_URL}/lti/lti-app/trade/portfolio`;
const TRADING_HISTORY_URL = `${BASE_URL}/lti/lti-app/trade/orders/history`;

const PORTFOLIO_TABLE_SELECTOR = '.portfolio-tbl-sticky-native';
const DATE_FORMAT = 'DD.MM.YY';

interface RawPortfolio {
  PortfolioId: string;
  PortfolioName: string;
}

interface RawHolding {
  PaperId: string;
  PaperName?: string;
  Symbol?: string;
  Amount: string;
  Value: string;
}

interface RawOrder {
  PaperId: string;
  PaperName?: string;
  Symbol?: string;
  Amount: string;
  ExecutableTotal: string;
  ExecutablePrice: string;
  ExecutionDate: string;
}

/**
 * Extracted, unverified against a live response, from an earlier WIP branch. The response
 * shape is inferred from that code rather than freshly captured, so field names here should
 * be double-checked against a real `lti-app/api/config` payload before this ships.
 */
export function parsePortfoliosResponse(data: any): RawPortfolio[] {
  return data?.data?.user?.Portfolios ?? [];
}

/**
 * Same provenance note as {@link parsePortfoliosResponse}: field names are carried over from
 * an earlier WIP branch, not freshly observed. The earlier branch also always reported ILS
 * regardless of the source `CurrencyRate` field, which is assumed here to mean Leumi's trading
 * platform prices holdings in ILS - that assumption needs confirming against a live account.
 */
export function parseHoldingsResponse(data: any): Security[] {
  const rows: RawHolding[] = data?.data?.UserStatement?.DataSource ?? [];

  return rows.map(row => ({
    name: row.PaperName || undefined,
    symbol: row.Symbol || '',
    volume: parseFloat(row.Amount),
    value: parseFloat(row.Value),
    currency: SHEKEL_CURRENCY,
  }));
}

/**
 * Same provenance note as {@link parsePortfoliosResponse}. Additionally, the earlier branch
 * never captured a buy/sell direction field for orders, so `chargedAmount` here is the
 * unsigned trade value rather than a signed debit/credit - that needs a real order-history
 * response to fix properly.
 */
export function parseOrderHistoryResponse(data: any, options?: ScraperOptions): Transaction[] {
  const rows: RawOrder[] = data?.data?.GetOrdersHistory?.ordersHistory?.records ?? [];

  return rows.map(row => {
    const date = moment(row.ExecutionDate, DATE_FORMAT).milliseconds(0).toISOString();
    const amount = parseFloat(row.ExecutableTotal);
    const paperLabel = [row.PaperName, row.Symbol].filter(Boolean).join(' ');

    const transaction: Transaction = {
      type: TransactionTypes.Normal,
      date,
      processedDate: date,
      originalAmount: amount,
      originalCurrency: SHEKEL_CURRENCY,
      chargedAmount: amount,
      description: paperLabel || 'עסקה בתיק ניירות ערך',
      status: TransactionStatuses.Completed,
    };

    if (options?.includeRawTransaction) {
      transaction.rawTransaction = getRawTransaction(row);
    }

    return transaction;
  });
}

async function fetchHoldings(page: Page): Promise<{ portfolioId: string; securities: Security[] } | null> {
  const configResponsePromise = waitForXhr(page, 'lti-app/api/config');
  const statementResponsePromise = waitForXhr(page, 'Statement');

  await page.goto(TRADING_URL, { waitUntil: 'networkidle2' });
  await waitUntilElementFound(page, PORTFOLIO_TABLE_SELECTOR, true);

  const [configResponse, statementResponse] = await Promise.all([configResponsePromise, statementResponsePromise]);

  const portfolios = parsePortfoliosResponse(await configResponse.json());
  if (!portfolios.length) {
    debug('no portfolios found on the trading page');
    return null;
  }
  if (portfolios.length > 1) {
    // Only the currently-displayed portfolio's holdings are captured below; switching between
    // portfolios in the UI to attribute holdings per-portfolio is not implemented yet.
    debug('found %d portfolios, only %s is supported for now', portfolios.length, portfolios[0].PortfolioId);
  }

  const securities = parseHoldingsResponse(await statementResponse.json());
  return { portfolioId: portfolios[0].PortfolioId, securities };
}

function waitForXhr(page: Page, urlSubstring: string): Promise<HTTPResponse> {
  return page.waitForResponse(
    response =>
      (response.request().resourceType() === 'xhr' || response.request().resourceType() === 'fetch') &&
      response.url().includes(urlSubstring),
  );
}

async function clickByXPath(page: Page, xpath: string): Promise<void> {
  await page.waitForSelector(xpath, { timeout: 30000, visible: true });
  const elements = await page.$$(xpath);
  await elements[0].click();
}

/**
 * Drives the Angular Material date picker on the order-history page to select a custom start
 * date. Selectors carried over, unverified today, from an earlier WIP branch that exercised
 * this flow against a live account.
 */
async function selectHistoryStartDate(page: Page, startDate: Moment): Promise<void> {
  await page.waitForSelector('div.select-period-block');
  await clickByXPath(page, 'xpath///div[contains(@class, "select-period-block")]');

  await page.waitForSelector('div.mat-select-panel-wrap');
  await clickByXPath(page, 'xpath///mat-option[last()]');

  await page.waitForSelector('div#chooseByDatesBlock');
  await clickByXPath(page, 'xpath///div[@id="chooseByDatesBlock"]//input[@id="mat-input-0"]');

  await page.waitForSelector('mat-calendar');
  await clickByXPath(page, 'xpath///mat-calendar//button[contains(@class, "mat-calendar-period-button")]');

  const year = startDate.get('year');
  await page.waitForSelector(`mat-calendar td[aria-label="${year}"]`);
  await clickByXPath(page, `xpath///mat-calendar//td[contains(@aria-label, "${year}")]`);

  const month = `01/${startDate.format('MM/YY')}`;
  await page.waitForSelector(`mat-calendar td[aria-label="${month}"]`);
  await clickByXPath(page, `xpath///mat-calendar//td[contains(@aria-label, "${month}")]`);

  const day = startDate.format('DD/MM/YY');
  await page.waitForSelector(`mat-calendar td[aria-label="${day}"]`);
  await clickByXPath(page, `xpath///mat-calendar//td[contains(@aria-label, "${day}")]`);
}

async function fetchOrderHistory(page: Page, startDate: Moment, options: ScraperOptions): Promise<Transaction[]> {
  await page.goto(TRADING_HISTORY_URL, { waitUntil: 'networkidle2' });

  await selectHistoryStartDate(page, startDate);

  const responsePromise = waitForXhr(page, 'GetOrdersHistory');
  await clickByXPath(page, 'xpath///div[@id="chooseByDatesBlock"]//button[contains(@class, "btn-primary")]');
  const response = await responsePromise;

  return parseOrderHistoryResponse(await response.json(), options);
}

export async function fetchInvestmentAccounts(
  page: Page,
  startDate: Moment,
  options: ScraperOptions,
): Promise<TransactionsAccount[]> {
  debug('========== FETCHING INVESTMENT ACCOUNTS ==========');

  try {
    const portfolio = await fetchHoldings(page);
    if (!portfolio) {
      return [];
    }

    let txns: Transaction[] = [];
    try {
      txns = await fetchOrderHistory(page, startDate, options);
    } catch (error) {
      debug('error fetching order history, returning holdings without transactions: %s', error);
    }

    const balance = portfolio.securities.reduce((sum, security) => sum + security.value, 0);

    const account: TransactionsAccount = {
      accountNumber: `${portfolio.portfolioId}-investment`,
      balance,
      currency: SHEKEL_CURRENCY,
      savingsAccount: true,
      securities: portfolio.securities,
      txns,
    };

    debug(
      'found portfolio %s with %d securities and %d orders',
      portfolio.portfolioId,
      portfolio.securities.length,
      txns.length,
    );
    return [account];
  } catch (error) {
    debug('error fetching investment accounts: %s', error);
    return [];
  }
}
