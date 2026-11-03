import {
  type TransactionsAccount,
  type ForeignCurrencyBalance,
  type SecuritiesPortfolio,
  type SecurityHolding,
} from '../transactions';

export interface ForeignCurrencySection {
  currencyLabel: string;
  rows: string[][];
}
export interface SecuritiesPage {
  pagedResult: {
    cacheId: string;
    pageNumber: number;
    totalNumberOfPages: number;
    totalNumberOfRecords: number;
    results: BankSecurity[];
  };
}
export interface BankSecurity {
  number: string | number;
  isin?: string;
  symbol?: string;
  name: string;
  type: string;
  amount: number;
  lastKnownRate?: number;
  adjustedCostRate?: number;
  holdingValue: number;
  holdingValueInNis: number;
  currencyISOCode: string;
  nonRevaluation?: boolean;
}
export interface PortfolioSummary {
  currencyISOCode: string;
  portfolioValue: number;
}
export interface AssetSnapshot {
  accountNumber: string;
  fx?: { accountNumber: string; sections: ForeignCurrencySection[] };
  securities?: {
    pages: SecuritiesPage[];
    summary: PortfolioSummary;
    accountDetails: { accounts: { mch: string; snif?: string }[] }[];
  };
}
function amount(value: unknown): number {
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error('Missing FIBI amount');
  const text = String(value)
    .replace(/[\s,\u200e\u200f]/g, '')
    .replace(/\u2212/g, '-');
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) throw new Error('Invalid FIBI amount');
  const result = Number(text);
  if (!Number.isFinite(result)) throw new Error('Invalid FIBI amount');
  return result;
}
function currency(value: string): string {
  if (!/^[A-Z]{3}$/.test(value)) throw new Error('Invalid FIBI currency');
  return value;
}
function foreignCurrency(label: string): string {
  const code = label.match(/\b[A-Z]{3}\b/);
  if (code) return currency(code[0]);
  const normalized = label.replace(/["'׳״]/g, '');
  const names: [RegExp, string][] = [
    [/פרנק שו[וי]*צר/, 'CHF'],
    [/דולר קנד/, 'CAD'],
    [/דולר אוסטרל/, 'AUD'],
    [/אירו|יורו/, 'EUR'],
    [/לישט|לירה שטרלינג/, 'GBP'],
    [/יין יפנ|ין יפנ/, 'JPY'],
    [/כתר דנ/, 'DKK'],
    [/כתר נורבג|כתר נורווג/, 'NOK'],
    [/כתר שו[וי]*ד/, 'SEK'],
    [/יואן סינ/, 'CNY'],
    [/דולר ארהב|דולר אמריק/, 'USD'],
  ];
  const match = names.find(([pattern]) => pattern.test(normalized));
  if (!match) throw new Error('Unknown FIBI FX currency');
  return match[1];
}
export function parseForeignCurrencyBalances(sections: ForeignCurrencySection[]): ForeignCurrencyBalance[] {
  const balances = new Map<string, ForeignCurrencyBalance>();
  for (const section of sections) {
    const code = foreignCurrency(section.currencyLabel),
      total = balances.get(code) || { currency: code, balance: 0, valueInILS: 0 };
    for (const row of section.rows) {
      if (row.length < 7) throw new Error('Incomplete FIBI FX row');
      total.balance += amount(row[3]);
      total.valueInILS += amount(row[4]);
    }
    balances.set(code, total);
  }
  return [...balances.values()];
}
export function parseSecuritiesPortfolio(pages: SecuritiesPage[], summary: PortfolioSummary): SecuritiesPortfolio {
  const first = pages[0]?.pagedResult;
  if (
    !first ||
    !Number.isInteger(first.totalNumberOfPages) ||
    first.totalNumberOfPages < 1 ||
    first.totalNumberOfPages > 100 ||
    pages.length !== first.totalNumberOfPages
  )
    throw new Error('Incomplete FIBI securities pages');
  const pageNumbers = new Set<number>(),
    rows: BankSecurity[] = [];
  for (const page of pages) {
    const p = page?.pagedResult;
    if (
      !p ||
      !Array.isArray(p.results) ||
      p.cacheId !== first.cacheId ||
      p.totalNumberOfRecords !== first.totalNumberOfRecords ||
      p.totalNumberOfPages !== first.totalNumberOfPages ||
      !Number.isInteger(p.pageNumber) ||
      pageNumbers.has(p.pageNumber)
    )
      throw new Error('Incomplete FIBI securities pages');
    pageNumbers.add(p.pageNumber);
    rows.push(...p.results);
  }
  const ordered = [...pageNumbers].sort((a, b) => a - b);
  if (
    ![0, 1].includes(ordered[0]) ||
    !Number.isInteger(first.totalNumberOfRecords) ||
    first.totalNumberOfRecords < 0 ||
    rows.length !== first.totalNumberOfRecords ||
    ordered.some((n, i) => n !== ordered[0] + i)
  )
    throw new Error('Incomplete FIBI securities snapshot');
  const identities = new Set<string>();
  let total = 0;
  const holdings: SecurityHolding[] = rows.map(s => {
    const code = currency(s.currencyISOCode),
      quantity = amount(s.amount),
      value = amount(s.holdingValue),
      valueInILS = amount(s.holdingValueInNis);
    if (s.nonRevaluation && (quantity !== 0 || value !== 0)) throw new Error('Missing FIBI security valuation');
    total += valueInILS;
    const securityNumber = String(s.number ?? '');
    if (!/^[A-Za-z0-9._:-]{1,80}$/.test(securityNumber) || identities.has(securityNumber))
      throw new Error('Missing or duplicate FIBI security identity');
    identities.add(securityNumber);
    const holding: SecurityHolding = {
      securityNumber,
      name: s.name,
      type: s.type,
      currency: code,
      quantity,
      marketValue: value,
      valueInILS,
    };
    if (s.isin) holding.isin = s.isin;
    if (s.symbol) holding.symbol = s.symbol;
    if (s.lastKnownRate != null && quantity !== 0) {
      const rate = amount(s.lastKnownRate),
        factor = [1, 100].find(f => Math.abs((quantity * rate) / f - value) <= 0.02);
      if (factor) {
        holding.unitPrice = rate / factor;
        if (s.adjustedCostRate != null) holding.adjustedCostPrice = amount(s.adjustedCostRate) / factor;
      }
    }
    return holding;
  });
  if (summary?.currencyISOCode !== 'ILS' || Math.abs(total - amount(summary.portfolioValue)) > 0.05)
    throw new Error('FIBI securities do not reconcile to portfolio summary');
  return { currency: 'ILS', value: amount(summary.portfolioValue), holdings };
}
function accountKey(value: string): string {
  const parts = value.match(/\d+/g);
  if (!parts || parts.length > 2) throw new Error('Invalid FIBI account scope');
  return (parts.length === 1 ? 'account:' : '') + parts.map(p => p.replace(/^0+(?=\d)/, '')).join(':');
}
function sameAccountScope(a: string, b: string): boolean {
  const left = accountKey(a),
    right = accountKey(b);
  return (
    left === right ||
    ((left.startsWith('account:') || right.startsWith('account:')) && left.split(':').pop() === right.split(':').pop())
  );
}
export function attachAssets(
  accounts: TransactionsAccount[],
  snapshot: AssetSnapshot,
  asOf: string,
): TransactionsAccount[] {
  const keys = accounts.map(a => accountKey(a.accountNumber));
  if (new Set(keys).size !== keys.length) throw new Error('Ambiguous FIBI account scope');
  const selectedAccounts = accounts.filter(a => sameAccountScope(a.accountNumber, snapshot.accountNumber));
  if (selectedAccounts.length !== 1) throw new Error('Ambiguous FIBI selected account scope');
  const selectedAccount = selectedAccounts[0].accountNumber;
  let parent: string | undefined;
  if (snapshot.fx) {
    const matches = accounts.filter(a => accountKey(a.accountNumber) === accountKey(snapshot.fx!.accountNumber));
    if (matches.length !== 1) throw new Error('FX account scope does not match history');
    parent = matches[0].accountNumber;
  }
  if (snapshot.securities) {
    const details = snapshot.securities.accountDetails;
    if (!Array.isArray(details)) throw new Error('Missing securities account scope');
    const selected = details.flatMap(d => (Array.isArray(d.accounts) ? d.accounts : []));
    if (selected.length !== 1) throw new Error('Ambiguous securities account scope');
    const account = selected[0],
      matches = accounts.filter(a => {
        const key = accountKey(a.accountNumber);
        return key === accountKey(key.startsWith('account:') ? String(account.mch) : `${account.snif}_${account.mch}`);
      });
    if (matches.length !== 1 || (parent && parent !== matches[0].accountNumber))
      throw new Error('Securities account scope does not match history');
    parent = matches[0].accountNumber;
  }
  if (
    (snapshot.fx && !sameAccountScope(snapshot.fx.accountNumber, snapshot.accountNumber)) ||
    (parent && parent !== selectedAccount)
  )
    throw new Error('Asset scope does not match selected account');
  if (snapshot.securities) {
    const account = snapshot.securities.accountDetails.flatMap(d => d.accounts)[0];
    if (!accountKey(snapshot.accountNumber).startsWith('account:') && !account.snif)
      throw new Error('Missing branch for selected account');
    if (!sameAccountScope(snapshot.accountNumber, account.snif ? `${account.snif}_${account.mch}` : account.mch))
      throw new Error('Securities scope does not match selected account');
  }
  const foreignCurrencyBalances = snapshot.fx ? parseForeignCurrencyBalances(snapshot.fx.sections) : undefined;
  const securitiesPortfolio = snapshot.securities
    ? parseSecuritiesPortfolio(snapshot.securities.pages, snapshot.securities.summary)
    : undefined;
  return accounts.map(a =>
    a.accountNumber === parent
      ? {
          ...a,
          assetsDate: asOf,
          ...(foreignCurrencyBalances ? { foreignCurrencyBalances } : {}),
          ...(securitiesPortfolio ? { securitiesPortfolio } : {}),
        }
      : a,
  );
}
