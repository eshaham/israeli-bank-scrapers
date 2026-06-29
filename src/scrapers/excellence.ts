import { type Page } from 'puppeteer';
import { getDebug } from '../helpers/debug';
import { getRawTransaction } from '../helpers/transactions';
import { AssetType, type PortfolioAccount, type Position } from '../portfolio';
import { BaseScraperWithBrowser, LoginResults, type PossibleLoginResults } from './base-scraper-with-browser';
import { ScraperErrorTypes } from './errors';
import { type ScraperLoginResult, type ScraperOptions } from './interface';

const debug = getDebug('excellence');

const BASE_URL = 'https://extradepro.xnes.co.il';
const API_BASE = `${BASE_URL}/api/v2/json2`;

// The `fields` query param tells the API which security-metadata columns to include
// in the balances response (`View.Meta.Security[]`). Without it, the Meta join is
// empty and positions lose their names/symbols/asset type. Mirrors the live SPA call.
const BALANCE_FIELDS = 'EngName,EngSymbol,HebName,HebSymbol,Symbol,ExpirationDate,ItemType,StockType,IsEtf,IsForeign';

// ---------------------------------------------------------------------------
// API response shape interfaces (based on live capture, 2026-06-24)
// ---------------------------------------------------------------------------

interface LoginResponse {
  Login?: {
    SessionKey?: string;
    '-LastLogin'?: string;
    '-PasswordExpiry'?: string;
    Capabilities?: unknown;
    Attributes?: unknown;
  };
  // Error shapes — the API may return error info at the top level or in a nested object
  Error?: {
    Code?: number | string;
    Message?: string;
  };
  error?: string;
  message?: string;
}

interface UserAccount {
  '-key': string;
  '-name'?: string;
  '-telCode'?: string;
  '-relation'?: string;
  '-nickName'?: string;
  '-type'?: string;
}

interface AccountsResponse {
  UserAccounts?: {
    UserAccount?: UserAccount | UserAccount[];
  };
}

interface SecurityMeta {
  '-Key': string | number;
  HebName?: string | null;
  EngName?: string | null;
  HebSymbol?: string | null;
  EngSymbol?: string | null;
  Symbol?: string | null;
  ItemType?: string | number | null;
  StockType?: string | number | null;
  IsEtf?: boolean | string | number | null;
  IsForeign?: boolean | string | number | null;
}

interface BalancePosition {
  EquityNumber?: string | number;
  OnlineNV?: number;
  AvailableNV?: number;
  LastRate?: number;
  BaseRate?: number;
  OnlineVL?: number;
  OnlineNisVL?: number;
  AveragePrice?: number;
  ProfitLoss?: number;
  AveragePriceProfitLoss?: number;
  AveragePriceProfitLossPercentage?: number;
  OnlinePercentage?: number;
  CurrencyCode?: string;
  ExpiryDate?: string;
  ValueDate?: string;
  SubAccount?: unknown;
  SubAccountName?: string;
  LienNv?: number;
  LoanNv?: number;
}

interface AccountView {
  OnlineValue?: number;
  MorningValue?: number;
  OnlineCash?: number;
  MorningCash?: number;
  CurrencyCode?: string;
  ProfitLoss?: number;
  ProfitLossPercentage?: number;
  BalanceCacheDate?: string;
  AccountPosition?: {
    Balance?: BalancePosition | BalancePosition[];
  };
}

interface BalancesResponse {
  View?: {
    Account?: AccountView;
    Meta?: {
      Security?: SecurityMeta | SecurityMeta[];
    };
  };
}

// ---------------------------------------------------------------------------
// Asset type mapping
// ---------------------------------------------------------------------------

/**
 * Map Excellence ItemType/StockType/IsEtf flags to AssetType.
 *
 * Values confirmed against a live balances response (2026-06-24): `ItemType` is a
 * string label such as "Equity" or "Fund"; `StockType` may be null, "Equity", or
 * "ETF"; `IsEtf` is a boolean. We treat an ETF marker (IsEtf true, or StockType
 * "ETF") as ETF first, since an ETF is also reported with ItemType "Equity"/"Fund".
 * Numeric/string fallbacks are kept defensively for codes we may not have observed.
 */
export function mapAssetType(meta: SecurityMeta): AssetType {
  const itemType = String(meta.ItemType ?? '').toLowerCase();
  const stockType = String(meta.StockType ?? '').toLowerCase();

  const isEtf =
    meta.IsEtf === true || meta.IsEtf === 1 || meta.IsEtf === '1' || meta.IsEtf === 'true' || stockType === 'etf';
  if (isEtf) return AssetType.Etf;

  if (itemType === 'bond' || stockType === 'bond' || itemType === '2') return AssetType.Bond;
  if (itemType === 'fund' || stockType === 'fund' || itemType === '3') return AssetType.Fund;
  if (itemType === 'option' || stockType === 'option' || itemType === '4') return AssetType.Option;
  if (itemType === 'future' || stockType === 'future' || itemType === '5') return AssetType.Future;
  if (itemType === 'cash' || stockType === 'cash') return AssetType.Cash;
  // "Equity" is Excellence's label for a plain stock; "" / "1" / "stock" kept as fallbacks.
  if (itemType === 'equity' || itemType === 'stock' || itemType === '1' || itemType === '') return AssetType.Stock;

  return AssetType.Other;
}

// ---------------------------------------------------------------------------
// Portfolio mapping (exported for unit testing)
// ---------------------------------------------------------------------------

/**
 * Map the balances API response for a single account into a PortfolioAccount.
 *
 * @param accountNumber - The account key (e.g. "00-000000")
 * @param balancesResponse - The raw JSON from GET /account/view/balances
 * @param options - Scraper options (used to gate rawPosition via includeRawTransaction)
 */
export function mapBalancesToPortfolioAccount(
  accountNumber: string,
  balancesResponse: BalancesResponse,
  options?: Pick<ScraperOptions, 'includeRawTransaction'>,
): PortfolioAccount {
  const view = balancesResponse.View;
  const account = view?.Account;
  const asOf = account?.BalanceCacheDate;

  // Build a lookup map: security key (string) → SecurityMeta
  const rawMeta = view?.Meta?.Security;
  const metaArray: SecurityMeta[] = rawMeta == null ? [] : Array.isArray(rawMeta) ? rawMeta : [rawMeta];
  const metaByKey = new Map<string, SecurityMeta>();
  for (const m of metaArray) {
    const key = String(m['-Key'] ?? '');
    if (key) {
      metaByKey.set(key, m);
    }
  }

  // Map positions
  const rawBalances = account?.AccountPosition?.Balance;
  const balances: BalancePosition[] =
    rawBalances == null ? [] : Array.isArray(rawBalances) ? rawBalances : [rawBalances];

  const positions: Position[] = balances.map((bal): Position => {
    const secKeyStr = String(bal.EquityNumber ?? '');
    const meta = metaByKey.get(secKeyStr);

    // Use || (not ??) so that null values fall through to the next candidate
    const name = meta?.HebName || meta?.EngName || secKeyStr;
    const rawSymbol = meta?.Symbol || meta?.HebSymbol || meta?.EngSymbol || null;
    const symbol = rawSymbol ?? undefined;
    const assetType = meta ? mapAssetType(meta) : AssetType.Other;

    const marketPrice = bal.LastRate ?? bal.BaseRate ?? undefined;
    const quantity = bal.OnlineNV ?? 0;
    const marketValue = bal.OnlineVL ?? 0;
    const currency = bal.CurrencyCode ?? 'ILS';

    const position: Position = {
      name,
      securityId: secKeyStr,
      quantity,
      currency,
      marketValue,
    };

    if (symbol !== undefined) {
      position.symbol = symbol;
    }
    if (assetType !== undefined) {
      position.assetType = assetType;
    }
    if (marketPrice !== undefined) {
      position.marketPrice = marketPrice;
    }
    if (bal.AveragePrice !== undefined) {
      position.averageCost = bal.AveragePrice;
    }
    if (bal.AveragePriceProfitLoss !== undefined) {
      position.unrealizedPnl = bal.AveragePriceProfitLoss;
    }
    if (bal.AveragePriceProfitLossPercentage !== undefined) {
      position.unrealizedPnlPct = bal.AveragePriceProfitLossPercentage;
    }
    if (asOf !== undefined) {
      position.asOf = asOf;
    }

    if (options?.includeRawTransaction) {
      position.rawPosition = getRawTransaction({ balance: bal, meta: meta ?? null });
    }

    return position;
  });

  return {
    accountNumber,
    baseCurrency: account?.CurrencyCode,
    totalValue: account?.OnlineValue,
    cash: account?.OnlineCash,
    positions,
  };
}

// ---------------------------------------------------------------------------
// OTP / 2FA detection helper (exported for unit testing)
// ---------------------------------------------------------------------------

/**
 * Defensive best-effort 2FA/OTP challenge detector.
 *
 * Because no confirmed OTP CSS selector is available from the live capture, this
 * tries a few heuristic selectors and always returns false when uncertain.
 * The intent is to fail loudly (TwoFactorRetrieverMissing) for accounts that DO
 * have 2FA enabled, rather than silently looping.
 *
 * TODO: once a 2FA-enabled Excellence account is available, capture the exact OTP
 *       form selector and replace the heuristics here.
 */
export async function detectOtpChallenge(page: Page | undefined): Promise<boolean> {
  if (!page) return false;
  try {
    // Heuristic selectors — adjust after live 2FA capture
    const candidates = [
      'input[type="tel"]', // typical OTP digit input
      '[class*="otp"]',
      '[class*="two-factor"]',
      '[class*="2fa"]',
      '[id*="otp"]',
    ];
    for (const selector of candidates) {
      const el = await page.$(selector);
      if (el) return true;
    }
    return false;
  } catch {
    // If the page is navigating or the evaluation context is destroyed, err on the safe side.
    return false;
  }
}

function getPossibleLoginResults(): PossibleLoginResults {
  const results: PossibleLoginResults = {};

  // Success: after login the SPA navigates to /app
  results[LoginResults.Success] = [/\/app/i];

  // Defensive 2FA detection — no confirmed selector, best-effort heuristics
  results[LoginResults.TwoFactorRetrieverMissing] = [
    async (options?: { page?: Page }) => detectOtpChallenge(options?.page),
  ];

  return results;
}

// ---------------------------------------------------------------------------
// In-page authenticated fetch helper
// ---------------------------------------------------------------------------

/**
 * Authenticated request tokens (confirmed against a live session, 2026-06-24):
 *   - `session`  header = the `SessionKey` (a UUID) returned by POST /login.
 *   - `csession` header = a client-generated random value, sent on EVERY request
 *     (including /login itself). The server binds the issued SessionKey to whatever
 *     csession accompanied the login, so the SAME csession must be reused throughout.
 * Auth is header-based, not cookie-based.
 *
 * IMPORTANT: NEVER log session, csession, or SessionKey values.
 */
interface SessionTokens {
  session: string;
  csession: string;
}

/**
 * Perform an authenticated GET inside the Puppeteer page context.
 */
async function fetchWithSessionHeaders<T>(page: Page, url: string, tokens: SessionTokens): Promise<T | null> {
  const result = await page.evaluate(
    async (innerUrl: string, innerTokens: SessionTokens) => {
      try {
        const response = await fetch(innerUrl, {
          credentials: 'include',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            session: innerTokens.session,
            csession: innerTokens.csession,
          },
        });

        if (response.status === 204) return null;
        const text = await response.text();
        return JSON.parse(text) as unknown;
      } catch {
        return null;
      }
    },
    url,
    tokens,
  );
  return result as T | null;
}

/**
 * Perform an authenticated POST inside the Puppeteer page context.
 */
async function postWithSessionHeaders<T>(
  page: Page,
  url: string,
  body: Record<string, unknown>,
  tokens: SessionTokens,
): Promise<T | null> {
  const result = await page.evaluate(
    async (innerUrl: string, innerBody: Record<string, unknown>, innerTokens: SessionTokens) => {
      try {
        const response = await fetch(innerUrl, {
          method: 'POST',
          credentials: 'include',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            session: innerTokens.session,
            csession: innerTokens.csession,
          },
          body: JSON.stringify(innerBody),
        });

        if (response.status === 204) return null;
        const text = await response.text();
        return JSON.parse(text) as unknown;
      } catch {
        return null;
      }
    },
    url,
    body,
    tokens,
  );
  return result as T | null;
}

// ---------------------------------------------------------------------------
// Credentials type
// ---------------------------------------------------------------------------

type ExcellenceCredentials = {
  username: string;
  password: string;
};

// ---------------------------------------------------------------------------
// Scraper class
// ---------------------------------------------------------------------------

class ExcellenceScraper extends BaseScraperWithBrowser<ExcellenceCredentials> {
  /** The SessionKey (UUID) from the /login response, used as the `session` header. Never logged. */
  private sessionKey = '';

  /**
   * Client-generated `csession` value. Generated once per scrape and reused on the
   * login request and every authenticated call (the server binds the SessionKey to it).
   * Never logged.
   */
  private csession = '';

  private get tokens(): SessionTokens {
    return { session: this.sessionKey, csession: this.csession };
  }

  get baseUrl() {
    return BASE_URL;
  }

  getLoginOptions(credentials: ExcellenceCredentials) {
    // We override login() to do a direct in-page POST rather than driving the DOM
    // form, because DOM selectors have not been confirmed from a live capture.
    // getLoginOptions() is still required by the base class interface, so we return
    // a minimal stub. The actual login logic is in login() below.
    return {
      loginUrl: `${BASE_URL}/login`,
      fields: [
        // Stub — not used because login() overrides the form-drive flow
        { selector: '[name="username"]', value: credentials.username },
        { selector: '[name="password"]', value: credentials.password },
      ],
      submitButtonSelector: async () => {
        // No-op: login() handles submission directly
      },
      possibleResults: getPossibleLoginResults(),
    };
  }

  /**
   * Override login() to authenticate via a direct in-page JSON POST.
   *
   * Rationale: rather than driving the SPA's DOM form, we POST directly to the
   * stable JSON API endpoint. Request/response shapes confirmed against a live
   * session (2026-06-24).
   *
   * Flow:
   *  1. Navigate to the login page to establish the correct same-origin context.
   *  2. Generate a `csession` value and POST /api/v2/json2/login with the
   *     {Login:{User,Password}} body and the csession header.
   *  3. Parse response: extract Login.SessionKey on success, detect errors.
   */
  async login(credentials: ExcellenceCredentials): Promise<ScraperLoginResult> {
    debug('navigating to login page');
    // Navigate to the login page to establish origin context for in-page fetch
    try {
      await this.navigateTo(`${BASE_URL}/login`, 'domcontentloaded');
    } catch (e) {
      debug('navigateTo login page failed: %s', (e as Error).message);
      // Non-fatal: continue — the page might be partially loaded, and the in-page POST
      // may still work if the origin is set correctly.
    }

    // Generate the per-session csession token. The live SPA uses a Math.random() float
    // string (e.g. "0.4381..."), so we mirror that exact format to avoid any server-side
    // shape validation. It is client-chosen and only needs to stay consistent across the
    // session (the server binds the issued SessionKey to it).
    this.csession = String(Math.random());

    debug('posting credentials to login API');
    // NEVER log credentials, sessionKey, session, or csession values.
    const loginResponse = await this.page.evaluate(
      async (apiUrl: string, username: string, password: string, csession: string) => {
        try {
          const response = await fetch(apiUrl, {
            method: 'POST',
            credentials: 'include',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
              csession,
            },
            body: JSON.stringify({ Login: { User: username, Password: password } }),
          });
          const text = await response.text();
          return { ok: response.ok, status: response.status, body: text };
        } catch (e) {
          return { ok: false, status: 0, body: String(e) };
        }
      },
      `${API_BASE}/login`,
      credentials.username,
      credentials.password,
      this.csession,
    );

    if (!loginResponse.ok) {
      debug('login HTTP error: status=%d', loginResponse.status);
      return {
        success: false,
        errorType: ScraperErrorTypes.General,
        errorMessage: `Login request failed with HTTP ${loginResponse.status}`,
      };
    }

    let parsed: LoginResponse;
    try {
      parsed = JSON.parse(loginResponse.body) as LoginResponse;
    } catch {
      debug('failed to parse login response JSON');
      return {
        success: false,
        errorType: ScraperErrorTypes.General,
        errorMessage: 'Login response was not valid JSON',
      };
    }

    // Check for API-level error
    if (parsed.Error || parsed.error) {
      const code = parsed.Error?.Code ?? parsed.error ?? 'unknown';
      const msg = parsed.Error?.Message ?? parsed.message ?? '';
      debug('login API error: code=%s', code);

      // Heuristic: treat "invalid" / "wrong" credential errors as InvalidPassword
      const isInvalidCreds =
        typeof msg === 'string' &&
        (msg.toLowerCase().includes('invalid') ||
          msg.toLowerCase().includes('wrong') ||
          msg.toLowerCase().includes('שגוי') ||
          msg.toLowerCase().includes('incorrect'));

      if (isInvalidCreds) {
        return {
          success: false,
          errorType: ScraperErrorTypes.InvalidPassword,
          errorMessage: `Login failed: ${msg}`,
        };
      }

      return {
        success: false,
        errorType: ScraperErrorTypes.General,
        errorMessage: `Login API error (code ${code}): ${msg}`,
      };
    }

    const sessionKey = parsed.Login?.SessionKey;
    if (!sessionKey) {
      debug('login response missing SessionKey');
      // Check for OTP challenge heuristically before giving up
      const hasOtp = await detectOtpChallenge(this.page);
      if (hasOtp) {
        return {
          success: false,
          errorType: ScraperErrorTypes.TwoFactorRetrieverMissing,
          errorMessage:
            'Excellence 2FA/OTP challenge detected. Full OTP support is not yet implemented ' +
            '(no 2FA-enabled test account was available during development). ' +
            'If your account requires 2FA, please open an issue.',
        };
      }
      return {
        success: false,
        errorType: ScraperErrorTypes.General,
        errorMessage: 'Login succeeded but SessionKey was not returned',
      };
    }

    // Store for use in fetchData(). NEVER log this value.
    this.sessionKey = sessionKey;
    debug('login successful, SessionKey captured (not logged)');

    // No further navigation needed: authenticated API calls are made from this
    // same-origin page using explicit session/csession headers (see fetchData).
    return { success: true };
  }

  async fetchData() {
    debug('fetching account list');

    const accountsResp = await fetchWithSessionHeaders<AccountsResponse>(
      this.page,
      `${API_BASE}/accounts?top=10`,
      this.tokens,
    );

    const rawAccounts = accountsResp?.UserAccounts?.UserAccount;
    const accounts: UserAccount[] = rawAccounts == null ? [] : Array.isArray(rawAccounts) ? rawAccounts : [rawAccounts];

    debug('found %d accounts', accounts.length);

    const portfolioAccounts: PortfolioAccount[] = [];

    for (const account of accounts) {
      const accountNumber = account['-key'];
      if (!accountNumber) {
        debug('skipping account with missing key');
        continue;
      }

      debug('initialising account %s', accountNumber);
      // POST /account/init activates the account for the session
      await postWithSessionHeaders<unknown>(
        this.page,
        `${API_BASE}/account/init?account=${encodeURIComponent(accountNumber)}`,
        {},
        this.tokens,
      );

      debug('fetching balances for account %s', accountNumber);
      const balancesResp = await fetchWithSessionHeaders<BalancesResponse>(
        this.page,
        `${API_BASE}/account/view/balances?account=${encodeURIComponent(accountNumber)}&fields=${BALANCE_FIELDS}&currency=ILS`,
        this.tokens,
      );

      if (!balancesResp) {
        debug('no balances response for account %s, skipping', accountNumber);
        continue;
      }

      const portfolioAccount = mapBalancesToPortfolioAccount(accountNumber, balancesResp, this.options);
      portfolioAccounts.push(portfolioAccount);
    }

    debug('fetchData complete, %d portfolio accounts', portfolioAccounts.length);

    return {
      success: true,
      portfolioAccounts,
    };
  }
}

export default ExcellenceScraper;
