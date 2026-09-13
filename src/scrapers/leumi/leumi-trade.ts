import moment from 'moment';
import { type Page } from 'puppeteer';
import {
  DOLLAR_CURRENCY,
  DOLLAR_CURRENCY_SYMBOL,
  EURO_CURRENCY,
  EURO_CURRENCY_SYMBOL,
  SHEKEL_CURRENCY,
  SHEKEL_CURRENCY_KEYWORD,
  SHEKEL_CURRENCY_SYMBOL,
} from '../../constants';
import { getDebug } from '../../helpers/debug';
import { fetchGetWithinPage } from '../../helpers/fetch';
import { getRawTransaction } from '../../helpers/transactions';
import { type InvestmentHolding, type TransactionsAccount } from '../../transactions';
import { type ScraperOptions } from '../interface';

const debug = getDebug('leumi-trade');
const BASE_URL = 'https://hb2.bankleumi.co.il';
const TRADE_HOME_URL = `${BASE_URL}/lti/lti-app/home`;
const TRADE_API_URL = `${BASE_URL}/lti/lti-app/api`;
const TRADE_CONFIG_URL = `${TRADE_API_URL}/config`;
const TRADE_STATEMENT_URL = `${TRADE_API_URL}/Trade/Statement`;
const TRADE_HOLDINGS_VIEW_ID = '7';
const TRADE_HOLDINGS_SUB_VIEW_ID = '16';

interface LeumiTradeApiResponse<TData> {
  data: TData;
  resultCode: number;
  errorMessage?: string;
}

interface LeumiTradePortfolio {
  index: number;
  PortfolioId: string;
  name: string;
  real: boolean;
}

interface LeumiTradeConfigData {
  user: {
    Portfolios: LeumiTradePortfolio[];
  };
}

interface LeumiTradeRawHolding {
  PaperId: number;
  PaperName: string;
  Symbol?: string | null;
  AverageRate: number;
  Amount: number;
  PaperLastRateForStatement: number;
  Value: number;
  ChangePercent: number;
  ProfitPercent: number;
  ProfitCash: number;
  Percent: number;
  PaperTypeName?: string | null;
  RegionID?: number | null;
  CountryID?: number | null;
  CurrencyRate?: number | null;
}

interface LeumiTradeStatement {
  PortfolioValue: number;
  ReportDate: string;
  CurrencySymbol: string;
  DataSource: LeumiTradeRawHolding[];
  PortfolioIndex: number;
  CriticalError: boolean;
  CriticalTimeout: boolean;
  IsErrorMessage: boolean;
}

interface LeumiTradeStatementData {
  UserStatement: LeumiTradeStatement;
}

function assertSuccessfulResponse<TData>(
  response: LeumiTradeApiResponse<TData> | null,
  operation: string,
): asserts response is LeumiTradeApiResponse<TData> {
  if (!response) {
    throw new Error(`Leumi Trade ${operation} returned no response`);
  }

  if (response.resultCode !== 0) {
    throw new Error(
      `Leumi Trade ${operation} failed: ${response.errorMessage || `result code ${response.resultCode}`}`,
    );
  }
}

export function mapTradeCurrency(currencySymbol: string): string | undefined {
  const normalized = currencySymbol.trim().toUpperCase();
  if ([SHEKEL_CURRENCY_SYMBOL, SHEKEL_CURRENCY_KEYWORD, 'NIS', SHEKEL_CURRENCY].includes(normalized)) {
    return SHEKEL_CURRENCY;
  }
  if ([DOLLAR_CURRENCY_SYMBOL, DOLLAR_CURRENCY].includes(normalized)) {
    return DOLLAR_CURRENCY;
  }
  if ([EURO_CURRENCY_SYMBOL, EURO_CURRENCY].includes(normalized)) {
    return EURO_CURRENCY;
  }
  return undefined;
}

export function mapTradeHolding(
  rawHolding: LeumiTradeRawHolding,
  valueCurrency: string,
  options?: ScraperOptions,
): InvestmentHolding {
  const holding: InvestmentHolding = {
    identifier: rawHolding.PaperId,
    name: rawHolding.PaperName || '',
    symbol: rawHolding.Symbol || undefined,
    quantity: rawHolding.Amount,
    averagePrice: rawHolding.AverageRate,
    lastPrice: rawHolding.PaperLastRateForStatement,
    value: rawHolding.Value,
    valueCurrency,
    profit: rawHolding.ProfitCash,
    profitCurrency: valueCurrency,
    profitPercent: rawHolding.ProfitPercent,
    dailyChangePercent: rawHolding.ChangePercent,
    portfolioPercent: rawHolding.Percent,
    securityType: rawHolding.PaperTypeName || undefined,
    regionId: rawHolding.RegionID ?? undefined,
    countryId: rawHolding.CountryID ?? undefined,
    currencyRate: rawHolding.CurrencyRate ?? undefined,
  };

  if (options?.includeRawTransaction) {
    holding.rawHolding = getRawTransaction(rawHolding);
  }

  return holding;
}

export function mapTradePortfolio(
  portfolio: LeumiTradePortfolio,
  statement: LeumiTradeStatement,
  options?: ScraperOptions,
): TransactionsAccount {
  const currency = mapTradeCurrency(statement.CurrencySymbol) || SHEKEL_CURRENCY;
  const balanceDate = moment(statement.ReportDate, 'YYYY-MM-DD', true);

  return {
    accountNumber: portfolio.PortfolioId || String(portfolio.index),
    name: portfolio.name,
    balance: statement.PortfolioValue,
    balanceDate: balanceDate.isValid() ? balanceDate.milliseconds(0).toISOString() : undefined,
    currency,
    investmentAccount: true,
    holdings: (statement.DataSource || []).map(rawHolding => mapTradeHolding(rawHolding, currency, options)),
    txns: [],
  };
}

function getStatementUrl(portfolioIndex: number): string {
  const url = new URL(TRADE_STATEMENT_URL);
  url.searchParams.set('PortfolioIndex', String(portfolioIndex));
  url.searchParams.set('StatementType', 'Today');
  url.searchParams.set('ViewDate', moment().format('YYYY-MM-DD'));
  url.searchParams.set('ViewID', TRADE_HOLDINGS_VIEW_ID);
  url.searchParams.set('SubView', TRADE_HOLDINGS_SUB_VIEW_ID);
  url.searchParams.set('FromCache', 'false');
  url.searchParams.set('AlwaysChangePercent', 'false');
  url.searchParams.set('IsMain', 'false');
  url.searchParams.set('RegionId', '-1');
  url.searchParams.set('CurrencyCode', '0');
  url.searchParams.set('rt', 'true');
  return url.toString();
}

async function fetchTradeStatement(page: Page, portfolio: LeumiTradePortfolio, options: ScraperOptions) {
  const response = await fetchGetWithinPage<LeumiTradeApiResponse<LeumiTradeStatementData>>(
    page,
    getStatementUrl(portfolio.index),
  );
  assertSuccessfulResponse(response, `statement for portfolio ${portfolio.index}`);

  const statement = response.data?.UserStatement;
  if (!statement || statement.CriticalError || statement.CriticalTimeout || statement.IsErrorMessage) {
    throw new Error(`Leumi Trade returned an invalid statement for portfolio ${portfolio.index}`);
  }

  return mapTradePortfolio(portfolio, statement, options);
}

export async function fetchLeumiTradeAccounts(page: Page, options: ScraperOptions): Promise<TransactionsAccount[]> {
  debug('========== FETCHING LEUMI TRADE ACCOUNTS ==========');

  try {
    await page.goto(TRADE_HOME_URL, { waitUntil: 'networkidle2' });

    const configResponse = await fetchGetWithinPage<LeumiTradeApiResponse<LeumiTradeConfigData>>(
      page,
      TRADE_CONFIG_URL,
    );
    assertSuccessfulResponse(configResponse, 'configuration');

    const portfolios = configResponse.data?.user?.Portfolios || [];
    debug('found %d Leumi Trade portfolios', portfolios.length);

    const accounts: TransactionsAccount[] = [];
    for (const portfolio of portfolios) {
      try {
        accounts.push(await fetchTradeStatement(page, portfolio, options));
      } catch (error) {
        debug('error fetching Leumi Trade portfolio %s: %s', portfolio.index, error);
      }
    }

    return accounts;
  } catch (error) {
    debug('error fetching Leumi Trade accounts: %s', error);
    return [];
  }
}
