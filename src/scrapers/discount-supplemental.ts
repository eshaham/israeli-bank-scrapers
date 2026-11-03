import moment from 'moment';
import { type Page } from 'puppeteer';
import { type Transaction, TransactionStatuses, TransactionTypes } from '../transactions';
import { type DiscountSupplementalData, type SupplementalAccount } from './interface';

const BASE_URL = 'https://start.telebank.co.il/Titan/gatewayAPI';
const DATE_FORMATS = ['YYYYMMDD', 'YYYY-MM-DD', 'DD/MM/YYYY'];
type SectionName = keyof DiscountSupplementalData['sections'];
type SectionStatus = DiscountSupplementalData['sections'][SectionName];
type JsonObject = Record<string, any>;
type Read = { value: unknown; failed: boolean };

let activeRequests = 0;
const waitingRequests: Array<() => void> = [];
async function acquireRequestSlot() {
  if (activeRequests >= 8) await new Promise<void>(resolve => waitingRequests.push(resolve));
  activeRequests += 1;
}
function releaseRequestSlot() {
  activeRequests -= 1;
  waitingRequests.shift()?.();
}

function object(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : null;
}
function stringValue(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : '';
}
function first(...values: unknown[]): unknown {
  return values.find(value => value !== undefined && value !== null && stringValue(value).trim() !== '');
}

function rows(value: unknown, names: string[]): any[] | null {
  const root = object(value);
  if (!root) return null;
  for (const name of names) {
    if (Array.isArray(root[name])) return root[name];
    const wrapped = object(root[name]);
    if (wrapped) {
      for (const key of [
        'DepositEntry',
        'DepositDetailsEntry',
        'DepositAccountEntry',
        'SecuritiesEntry',
        'CardsEntry',
      ]) {
        if (Array.isArray(wrapped[key])) return wrapped[key];
      }
    }
  }
  return null;
}
function number(value: unknown): number | null {
  const raw = stringValue(value).trim();
  if (!raw) return null;
  const parsed = Number(raw.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}
function currency(...values: unknown[]): string | null {
  const symbols: Record<string, string> = { '₪': 'ILS', NIS: 'ILS', $: 'USD', US$: 'USD', '€': 'EUR', '£': 'GBP' };
  for (const value of values) {
    const row = object(value);
    const raw = stringValue(row ? first(row.Code, row.CodeValue, row.Value, row.CurrencyCode) : value)
      .trim()
      .toUpperCase();
    if (/^[A-Z]{3}$/.test(raw)) return raw === 'NIS' ? 'ILS' : raw;
    if (symbols[raw]) return symbols[raw];
  }
  return null;
}
function date(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const parsed = moment(stringValue(value), DATE_FORMATS, true);
  return parsed.isValid() ? parsed.format('YYYY-MM-DD') : null;
}
function sectionStatus(reads: Read[], count: number, parsed: boolean): SectionStatus {
  const failed = reads.some(read => read.failed || !read.value);
  if (failed && count === 0) return { status: 'unavailable', recordCount: 0 };
  if (!parsed || failed) return { status: 'partial', recordCount: count };
  return { status: count ? 'complete' : 'empty', recordCount: count };
}
async function request(
  page: Page,
  path: string,
  method: 'GET' | 'POST' = 'GET',
  body?: Record<string, unknown>,
): Promise<Read> {
  await acquireRequestSlot();
  try {
    const url = `${BASE_URL}/${path}`;
    const [text, status] = await page.evaluate(
      async (innerUrl: string, innerMethod: 'GET' | 'POST', innerBody?: Record<string, unknown>) => {
        const host = 'https://start.telebank.co.il';
        const base = '/Titan/gatewayAPI/';
        const allowed = [
          /^foreign\/CALinkedAccountsDetails$/,
          /^deposits\/depositsDetails\/[^/]+\/1$/,
          /^securities\/portfolioInfo\/currentSecuritiesPortfolio$/,
          /^creditCards\/cardsPastOrFutureDebitTotal\/[^/]+\/F$/,
          /^creditCards\/cardCurrentDebitTransactions\/[^/]+\/C$/,
          /^creditCards\/cardPastDebitTransactions\/[^/]+\/\d{6}\/C$/,
        ];
        try {
          const parsedUrl = new URL(innerUrl);
          const relative = parsedUrl.pathname.startsWith(base) ? parsedUrl.pathname.slice(base.length) : '';
          const securitiesRoute = relative === 'securities/portfolioInfo/currentSecuritiesPortfolio';
          if (
            parsedUrl.origin !== host ||
            !allowed.some(rule => rule.test(relative)) ||
            (innerMethod === 'POST') !== securitiesRoute
          )
            return [null, 0] as const;
          const response = await fetch(parsedUrl.href, {
            method: innerMethod,
            credentials: 'include',
            redirect: 'error',
            cache: 'no-store',
            signal: AbortSignal.timeout(8000),
            ...(innerBody !== undefined
              ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(innerBody) }
              : {}),
          });
          return [await response.text(), response.status] as const;
        } catch {
          return [null, 0] as const;
        }
      },
      url,
      method,
      body,
    );
    if (!text) return { value: null, failed: true };
    try {
      return { value: JSON.parse(text) as unknown, failed: status < 200 || status >= 300 };
    } catch {
      return { value: null, failed: true };
    }
  } catch {
    return { value: null, failed: true };
  } finally {
    releaseRequestSlot();
  }
}
async function get(page: Page, path: string): Promise<Read> {
  return request(page, path);
}
async function post(page: Page, path: string, body: Record<string, unknown>): Promise<Read> {
  return request(page, path, 'POST', body);
}

function parseForeignCurrency(read: Read, parents: string[], asOf: string) {
  const raw = object(read.value);
  const root = object(raw?.CALinkedAccountsDetails) || raw;
  const mains = rows(object(root?.MainAccountBlock) || root, ['MainAccountEntry']);
  const accounts: SupplementalAccount[] = [];
  if (!mains || read.failed) return { accounts, status: sectionStatus([read], 0, false) };
  const seen = new Set<string>();
  let parsed = true;
  for (const rawMain of mains) {
    const main = object(rawMain);
    const info = object(main?.NewAccountInfo) || object(main?.AccountInfo) || main;
    const parent = stringValue(first(info?.AccountID, main?.AccountNumber, main?.CurrentAccountNumber));
    const linked = rows(object(main?.LinkedAccountsBlock) || {}, ['LinkedAccountEntry']);
    if (!parent || !parents.includes(parent) || seen.has(parent) || !linked) {
      parsed = false;
      continue;
    }
    seen.add(parent);
    for (const rawLinked of linked) {
      const item = object(rawLinked);
      const account = object(item?.AccountInfo) || {};
      const id = stringValue(first(account.AccountID, item?.AccountID, item?.NewAccountInfo?.AccountID));
      const branch = stringValue(first(account.BranchID, item?.BranchID));
      const code = currency(item?.CurrencyCode, item?.Currency, account.CurrencyCode, account.CurrencyID);
      const balance = number(item?.AccountBalance);
      if (!id || !branch || !code || balance === null) {
        parsed = false;
        continue;
      }
      accounts.push({
        type: 'foreignCurrency',
        accountNumber: `${parent}:${branch}:${id}`,
        sourceAccountNumber: parent,
        name: `${code} foreign currency account`,
        currency: code,
        balance,
        balanceDate: asOf,
      });
    }
  }
  if (seen.size !== parents.length) parsed = false;
  return { accounts, status: sectionStatus([read], accounts.length, parsed) };
}
function parseDeposits(reads: Read[], parents: string[], asOf: string) {
  const accounts: SupplementalAccount[] = [];
  let parsed = true;
  reads.forEach((read, index) => {
    const raw = object(read.value);
    const root = object(raw?.DepositsDetails) || raw;
    const deposits = rows(object(root?.DepositDetailsBlock) || object(root?.DepositAccountBlock) || root, [
      'DepositDetailsEntry',
      'DepositAccountEntry',
    ]);
    if (!deposits || read.failed) {
      parsed = false;
      return;
    }
    for (const rawDeposit of deposits) {
      const entry = object(rawDeposit);
      const account = stringValue(first(entry?.TermNewAccountNumber, entry?.TermAccountNumber, entry?.AccountNumber));
      const id = stringValue(first(entry?.DepositID, entry?.DepositId, entry?.ProductCode));
      const code = currency(entry?.CurrencyCode, entry?.DepositCurrencyCode, entry?.Currency);
      const balance = number(code === 'ILS' ? entry?.CurrentValue : entry?.CurrentForeignCurrencyValue);
      if (!account || !id || !code || balance === null) {
        parsed = false;
        continue;
      }
      accounts.push({
        type: 'savings',
        accountNumber: `${parents[index]}:${account}:${id}`,
        sourceAccountNumber: parents[index],
        name: stringValue(
          first(entry?.DepositName, entry?.ProductName, entry?.DepositTypeDescription) || 'Discount deposit',
        ),
        currency: code,
        balance,
        balanceDate: date(first(entry?.BusinessDate, entry?.AsOfDate, root?.BusinessDate)) || asOf,
      });
    }
  });
  return { accounts, status: sectionStatus(reads, accounts.length, parsed) };
}
function parseSecurities(reads: Read[], parents: string[], asOf: string) {
  const accounts: SupplementalAccount[] = [];
  let parsed = true;
  reads.forEach((read, index) => {
    const raw = object(read.value);
    const portfolio = object(raw?.CurrentSecuritiesPortfolio) || object(raw?.CURRENT_SECURITIES_PORTFOLIO) || raw;
    const securities = rows(portfolio, ['SecuritiesEntry', 'SECURITIES_ENTRY']);
    if (!securities || read.failed) {
      parsed = false;
      return;
    }
    const holdings: NonNullable<SupplementalAccount['holdings']> = [];
    for (const rawSecurity of securities) {
      const entry = object(rawSecurity);
      const id = stringValue(first(entry?.SecurityNumber, entry?.SecurityID, entry?.Isin));
      const code = currency(entry?.CurrencyCode, entry?.Currency, portfolio?.CurrencyCode);
      const quantity = number(entry?.CurrentUnits);
      const marketValue = number(first(entry?.TmuraInCurrency, code === 'ILS' ? entry?.TmuraTitan : undefined));
      if (!id || !code || quantity === null || marketValue === null) {
        parsed = false;
        continue;
      }
      holdings.push({
        symbol: String(first(entry?.PaperNameEngTitan, entry?.PaperNameLongTitan, entry?.Symbol, id)),
        assetClass: String(first(entry?.PaperSubTypeTZ, entry?.PaperTypeTZ, 'security')),
        quantity,
        marketValue,
        currency: code,
        asOf:
          date(first(entry?.BusinessDate, entry?.AsOfDate)) ||
          date(first(portfolio?.BusinessDate, portfolio?.PortfolioDate)) ||
          asOf,
      });
    }
    accounts.push({
      type: 'securities',
      accountNumber: `${parents[index]}:securities`,
      sourceAccountNumber: parents[index],
      name: 'Discount securities portfolio',
      currency: 'ILS',
      balanceDate: date(first(portfolio?.BusinessDate, portfolio?.PortfolioDate)) || asOf,
      holdings,
    });
  });
  const count = accounts.reduce((total, account) => total + (account.holdings?.length || 0), 0);
  return { accounts, status: sectionStatus(reads, count, parsed) };
}
function cardRows(read: Read): any[] | null {
  const raw = object(read.value);
  const root = object(raw?.CardsPastOrFutureDebitTotal) || raw;
  return rows(object(root?.CardsBlock) || root, ['CardsEntry']);
}
function cardTransactions(reads: Read[], startDate: string, asOf: string): Transaction[] | null {
  const transactions: Transaction[] = [];
  for (const read of reads) {
    if (read.failed || !read.value) return null;
    const raw = object(read.value);
    const wrapper = object(raw?.CardCurrentDebitTransactions) || object(raw?.CardPastDebitTransactions) || raw;
    const block = object(wrapper?.CardDebitsTransactionsBlock) || object(wrapper?.CardCurrentDebitTransactionsBlock);
    const entries = Array.isArray(block?.CardDebitsTransactionEntry)
      ? block?.CardDebitsTransactionEntry
      : object(wrapper?.DiscountKeyTotalsBlock)
        ? []
        : null;
    if (!entries) return null;
    for (const rawEntry of entries) {
      const entry = object(rawEntry);
      const parsedDate = moment(stringValue(entry?.PurchaseDate), DATE_FORMATS, true);
      const code = currency(
        entry?.PurchaseCurrencyCode,
        entry?.CalPurchaseCurrencySymbol,
        entry?.PurchaseCurrencySymbol,
      );
      const amount = number(entry?.PurchaseAmount);
      const description = stringValue(
        first(entry?.MerchantName, entry?.PurchaseTypeDescription, entry?.PurchaseComments) || 'Card purchase',
      );
      if (!parsedDate.isValid() || !code || amount === null) return null;
      const isoDate = parsedDate.format('YYYY-MM-DD');
      if (isoDate < startDate || isoDate > asOf) continue;
      const isoTime = parsedDate.toISOString();
      transactions.push({
        type: TransactionTypes.Normal,
        identifier: first(entry?.OperationNumber, entry?.TransactionNumber, entry?.PurchaseID) as
          | string
          | number
          | undefined,
        date: isoTime,
        processedDate: isoTime,
        originalAmount: Math.abs(amount),
        originalCurrency: code,
        chargedAmount: -Math.abs(amount),
        chargedCurrency: code,
        description,
        status:
          read === reads[0] && (entry?.TempPurchaseFlag === 'T' || entry?.ImmediateDebit === 'N')
            ? TransactionStatuses.Pending
            : TransactionStatuses.Completed,
      });
    }
  }
  return transactions;
}
async function parseCards(page: Page, reads: Read[], parents: string[], startDate: string, asOf: string) {
  const accounts: SupplementalAccount[] = [];
  const historyReads: Read[] = [];
  let parsed = true;
  for (let index = 0; index < parents.length; index += 1) {
    const cards = cardRows(reads[index]);
    if (!cards || reads[index].failed) {
      parsed = false;
      continue;
    }
    for (const rawCard of cards) {
      const card = object(rawCard);
      const cardNumber = String(card?.CardNumber || '');
      const cardType = String(card?.CardTypeCode || '');
      const validity = String(card?.CardValidityDate || '');
      if (!cardNumber || !cardType || !validity) {
        parsed = false;
        continue;
      }
      const query = new URLSearchParams({ CardNumber: cardNumber, CardTypeCode: cardType, CardValidityDate: validity });
      const current = await get(
        page,
        `creditCards/cardCurrentDebitTransactions/${encodeURIComponent(parents[index])}/C?${query}`,
      );
      const history: Read[] = [current];
      const month = moment.utc(startDate).startOf('month');
      const end = moment.utc(asOf).startOf('month');
      const pastRequests: Array<Promise<Read>> = [];
      for (let count = 0; month.isBefore(end) && count < 13; count += 1) {
        pastRequests.push(
          get(
            page,
            `creditCards/cardPastDebitTransactions/${encodeURIComponent(parents[index])}/${month.format('MMYYYY')}/C?${query}`,
          ),
        );
        month.add(1, 'month');
      }
      history.push(...(await Promise.all(pastRequests)));
      historyReads.push(...history);
      const transactions = cardTransactions(history, startDate, asOf);
      if (!transactions) {
        parsed = false;
      }
      accounts.push({
        type: 'card',
        accountNumber: `${parents[index]}:card:${cardNumber.slice(-4)}:${cardType}:${validity}`,
        sourceAccountNumber: parents[index],
        name: 'Discount credit card',
        currency: 'ILS',
        txns: transactions || [],
      });
    }
  }
  const allReads = [...reads, ...historyReads];
  const failed = allReads.some(read => read.failed || !read.value);
  return {
    accounts,
    status: sectionStatus(
      failed && !accounts.length ? allReads.map(() => ({ value: null, failed: true })) : allReads,
      accounts.reduce((total, account) => total + 1 + (account.txns?.length || 0), 0),
      parsed && !failed,
    ),
  };
}
function effectiveStart(startDate: Date): string {
  const earliest = moment.utc().subtract(1, 'year').add(2, 'day').startOf('day');
  return moment.max(earliest, moment.utc(startDate).startOf('day')).format('YYYY-MM-DD');
}

export async function fetchDiscountSupplementalData(
  page: Page,
  parentAccounts: string[],
  startDate: Date,
): Promise<DiscountSupplementalData> {
  const asOf = moment().format('YYYY-MM-DD');
  const from = effectiveStart(startDate);
  const paths = parentAccounts.map(encodeURIComponent);
  const [foreignRead, depositsReads, securitiesReads, cardReads] = await Promise.all([
    get(page, 'foreign/CALinkedAccountsDetails'),
    Promise.all(paths.map(account => get(page, `deposits/depositsDetails/${account}/1`))),
    Promise.all(
      parentAccounts.map(account =>
        post(page, 'securities/portfolioInfo/currentSecuritiesPortfolio', {
          AccountNumber: account,
          ReutersFlag: 'True',
          FetchBeginYearReturnFlag: 'True',
          LoaclRealTimeFlag: 'False',
          ForeignRealTimeFlag: 'False',
          SecuritiesListFlag: 'True',
          DailyPortfolioLossOrProfitFlag: 'False',
        }),
      ),
    ),
    Promise.all(paths.map(account => get(page, `creditCards/cardsPastOrFutureDebitTotal/${account}/F`))),
  ]);
  const foreign = parseForeignCurrency(foreignRead, parentAccounts, asOf);
  const deposits = parseDeposits(depositsReads, parentAccounts, asOf);
  const securities = parseSecurities(securitiesReads, parentAccounts, asOf);
  const cards = await parseCards(page, cardReads, parentAccounts, from, asOf);
  return {
    accounts: [...foreign.accounts, ...deposits.accounts, ...securities.accounts, ...cards.accounts],
    sections: {
      foreignCurrency: foreign.status,
      deposits: deposits.status,
      securities: securities.status,
      cards: cards.status,
    },
  };
}
