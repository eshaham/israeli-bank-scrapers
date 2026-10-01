import moment, { type Moment } from 'moment';
import { type Page } from 'puppeteer';
import { SHEKEL_CURRENCY } from '../../constants';
import { getDebug } from '../../helpers/debug';
import { fetchGetWithinPage } from '../../helpers/fetch';
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
const CONFIG_URL = `${BASE_URL}/lti/lti-app/api/config`;
const STATEMENT_URL = `${BASE_URL}/lti/lti-app/api/Trade/Statement`;
const ORDERS_HISTORY_URL = `${BASE_URL}/lti/lti-app/api/Trade/GetOrdersHistory`;

const API_DATE_FORMAT = 'YYYY-MM-DD';
const ORDER_DATE_FORMAT = 'YYYY-MM-DD HH:mm';
const OPERATION_BUY = 1;
const OPERATION_SELL = 2;

interface RawPortfolio {
  PortfolioId: string;
  PortfolioName: string;
}

interface RawHolding {
  PaperName?: string;
  Symbol?: string;
  Amount: number;
  Value: number;
}

/**
 * One row of `data.GetOrdersHistory.ordersHistory.records` in a live `GetOrdersHistory`
 * response - the old WIP branch's guess at this wrapper path was actually correct.
 */
interface RawOrder {
  BasicReferenceNo: number;
  PaperName?: string;
  Symbol?: string;
  /** 1 = buy (קניה), 2 = sell (מכירה); other values are unmapped. */
  TypeOfOperation: number;
  TypeOfOperationDesc?: string;
  /**
   * Signed by quantity direction (positive on a buy, negative on a sell) rather than by cash
   * flow, so it is not used directly - see {@link parseOrderHistoryResponse}.
   */
  ExecutableTotal: number;
  ExecutionDate: string;
  DateOfFinancialVal?: string;
  TaxSum?: number;
  CurrencyACode?: string;
}

/**
 * Verified against a live `lti-app/api/config` response. Portfolios are addressed by their
 * position in this array elsewhere (see `buildStatementUrl`/`buildOrdersHistoryUrl`), which is
 * how the live Statement/GetOrdersHistory requests identify a portfolio (`PortfolioIndex`).
 */
export function parsePortfoliosResponse(data: any): RawPortfolio[] {
  return data?.data?.user?.Portfolios ?? [];
}

/**
 * Verified against live responses, both empty (`DataSource: null`) and holding one fund
 * (`DataSource: [{ PaperName: 'ברק כספית', Symbol: '', Amount: 19526, Value: 20023.91, ... }]`).
 * `Amount`/`Value` are native numbers, unlike the string fields the old WIP branch's guess
 * assumed. Currency is hardcoded to ILS, confirmed against a live account (and against the live
 * `GetOrdersHistory` order rows' `CurrencyACode` in {@link parseOrderHistoryResponse}) - there is
 * no per-holding currency field to read instead, since the observed holding is itself ILS-priced.
 */
export function parseHoldingsResponse(data: any): Security[] {
  const rows: RawHolding[] = data?.data?.UserStatement?.DataSource ?? [];

  return rows.map(row => ({
    name: row.PaperName || undefined,
    symbol: row.Symbol || '',
    volume: row.Amount,
    value: row.Value,
    currency: SHEKEL_CURRENCY,
  }));
}

/**
 * `data.UserStatement.PortfolioValue` - verified against live responses (0 on an empty
 * portfolio, and exactly matching the single holding's `Value` on a non-empty one) - is the
 * account's own total, and is preferred over summing individual holdings' values since it also
 * covers any uninvested cash sitting in the portfolio.
 */
export function parsePortfolioValue(data: any): number | undefined {
  return data?.data?.UserStatement?.PortfolioValue;
}

/**
 * Verified against a live `GetOrdersHistory` response. `chargedAmount`/`originalAmount` are
 * derived from `TypeOfOperation` rather than `ExecutableTotal`'s own sign, because that sign
 * tracks quantity direction (positive on a buy, negative on a sell) - the opposite of a
 * debit/credit convention, where a buy should be a negative (money leaving the account) and a
 * sell a positive (money coming in).
 */
export function parseOrderHistoryResponse(data: any, options?: ScraperOptions): Transaction[] {
  const rows: RawOrder[] = data?.data?.GetOrdersHistory?.ordersHistory?.records ?? [];

  return rows.map(row => {
    const date = moment(row.ExecutionDate, ORDER_DATE_FORMAT).milliseconds(0).toISOString();
    const processedDate = row.DateOfFinancialVal
      ? moment(row.DateOfFinancialVal, ORDER_DATE_FORMAT).milliseconds(0).toISOString()
      : date;

    const magnitude = Math.abs(row.ExecutableTotal);
    let amount: number;
    if (row.TypeOfOperation === OPERATION_BUY) {
      amount = -magnitude;
    } else if (row.TypeOfOperation === OPERATION_SELL) {
      amount = magnitude;
    } else {
      debug(
        'unrecognised operation type %s (%s) for order %s, using the raw signed amount',
        row.TypeOfOperation,
        row.TypeOfOperationDesc,
        row.BasicReferenceNo,
      );
      amount = row.ExecutableTotal;
    }

    const currency = row.CurrencyACode || SHEKEL_CURRENCY;
    const paperLabel = [row.PaperName, row.Symbol].filter(Boolean).join(' ');

    const transaction: Transaction = {
      type: TransactionTypes.Normal,
      identifier: row.BasicReferenceNo,
      date,
      processedDate,
      originalAmount: amount,
      originalCurrency: currency,
      chargedAmount: amount,
      chargedCurrency: currency,
      description: paperLabel || 'עסקה בתיק ניירות ערך',
      status: TransactionStatuses.Completed,
    };

    if (row.TaxSum) {
      transaction.memo = `מס: ${Math.abs(row.TaxSum).toFixed(2)} ₪`;
    }

    if (options?.includeRawTransaction) {
      transaction.rawTransaction = getRawTransaction(row);
    }

    return transaction;
  });
}

/**
 * Query params verified against a live request. `ViewID`/`SubView`/`FromCache`/
 * `AlwaysChangePercent`/`IsMain`/`RegionId`/`CurrencyCode`/`rt` are reproduced verbatim from that
 * request rather than understood - only `PortfolioIndex` and `ViewDate` vary per call here.
 */
function buildStatementUrl(portfolioIndex: number, asOfDate: string): string {
  const params = new URLSearchParams({
    PortfolioIndex: String(portfolioIndex),
    StatementType: 'ByDate',
    ViewDate: asOfDate,
    ViewID: '7',
    SubView: '16',
    FromCache: 'false',
    AlwaysChangePercent: 'false',
    IsMain: 'false',
    RegionId: '-1',
    CurrencyCode: '0',
    rt: 'true',
  });
  return `${STATEMENT_URL}?${params.toString()}`;
}

/** Query params verified against a live request. */
function buildOrdersHistoryUrl(portfolioIndex: number, fromDate: string, toDate: string): string {
  const params = new URLSearchParams({
    portfolioIndex: String(portfolioIndex),
    FromDate: fromDate,
    Todate: toDate,
    IsCryptoOnly: 'false',
    rt: 'false',
  });
  return `${ORDERS_HISTORY_URL}?${params.toString()}`;
}

/**
 * Live Statement responses always carry `data.UserStatement`, for empty portfolios
 * too (`DataSource: null`, `PortfolioValue: 0`). Without it the request failed (an
 * error body is still JSON), and parsing it would silently look like an empty portfolio.
 */
export function assertStatementResponse(data: any, portfolio: { PortfolioId: string }): void {
  if (!data?.data?.UserStatement) {
    throw new Error(`Leumi investments: unexpected statement response for portfolio ${portfolio.PortfolioId}`);
  }
}

async function fetchPortfolioAccount(
  page: Page,
  portfolioIndex: number,
  portfolio: RawPortfolio,
  startDate: Moment,
  options: ScraperOptions,
): Promise<TransactionsAccount | null> {
  const today = moment().format(API_DATE_FORMAT);

  const statementData = await fetchGetWithinPage<any>(page, buildStatementUrl(portfolioIndex, today));
  assertStatementResponse(statementData, portfolio);
  const securities = parseHoldingsResponse(statementData);
  const balance = parsePortfolioValue(statementData) ?? securities.reduce((sum, security) => sum + security.value, 0);

  // Not caught: a listed portfolio whose orders can't be read must fail the scrape
  // rather than come back looking like a portfolio without orders.
  const ordersUrl = buildOrdersHistoryUrl(portfolioIndex, startDate.format(API_DATE_FORMAT), today);
  const ordersData = await fetchGetWithinPage<any>(page, ordersUrl);
  const txns = parseOrderHistoryResponse(ordersData, options);

  if (balance === 0 && securities.length === 0 && txns.length === 0) {
    debug('skipping empty portfolio %s', portfolio.PortfolioId);
    return null;
  }

  debug('found portfolio %s with %d securities and %d orders', portfolio.PortfolioId, securities.length, txns.length);

  return {
    accountNumber: `${portfolio.PortfolioId}-investment`,
    balance,
    currency: SHEKEL_CURRENCY,
    savingsAccount: true,
    securities,
    txns,
  };
}

export async function fetchInvestmentAccounts(
  page: Page,
  startDate: Moment,
  options: ScraperOptions,
): Promise<TransactionsAccount[]> {
  debug('========== FETCHING INVESTMENT ACCOUNTS ==========');

  // A customer without the investments service may not get a usable config response,
  // so failing to list portfolios still means "no investment accounts".
  let portfolios: RawPortfolio[];
  try {
    const configData = await fetchGetWithinPage<any>(page, CONFIG_URL);
    portfolios = parsePortfoliosResponse(configData);
  } catch (error) {
    debug('could not list portfolios, assuming there are none: %s', error);
    return [];
  }

  if (!portfolios.length) {
    debug('no portfolios found');
    return [];
  }

  // Once Leumi has listed a portfolio, failing to read it fails the scrape: returning
  // the remaining accounts would make the missing one look closed to the caller.
  const accounts: TransactionsAccount[] = [];
  for (let index = 0; index < portfolios.length; index += 1) {
    const account = await fetchPortfolioAccount(page, index, portfolios[index], startDate, options);
    if (account) {
      accounts.push(account);
    }
  }

  debug('returning %d investment accounts', accounts.length);
  return accounts;
}
