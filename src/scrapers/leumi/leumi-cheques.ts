import { randomUUID } from 'crypto';
import moment from 'moment';
import { type HTTPRequest, type Page } from 'puppeteer';
import { getDebug } from '../../helpers/debug';
import { TransactionStatuses, type Transaction, type TransactionsAccount } from '../../transactions';

const debug = getDebug('leumi-cheques');
const BASE_URL = 'https://hb2.bankleumi.co.il';

// Any page of the new ("digitalfront") site makes authenticated /v1/corp/ API calls while it
// loads; the cheque details endpoint needs the same headers.
const DIGITAL_TRANSACTIONS_URL = `${BASE_URL}/staticcontent/digitalfront/he/nis-accounts/nis-transactions/`;
const DIGITAL_API_PATH = '/v1/corp/';
const CHEQUES_API_URL = `${BASE_URL}/v1/corp/ui-corp-checks`;
const CHEQUE_DEPOSITS_URL = `${CHEQUES_API_URL}/checksdepositlist/digitalfront/1/checksdepositdlist`;
const RETURNED_CHEQUES_URL = `${CHEQUES_API_URL}/checkdepositedreturned/digitalfront/1/checkdepositedreturned`;

// The transactions API names a cheque deposit `הפקדת שיק` / `הפקדת שיקים` while it is pending,
// but once cleared only `הפקדת <code>` (for example `הפקדת 738`). Every deposit is therefore a
// candidate; the lookup filters by amount and reference, so other deposits just come back empty.
// The same goes for a returned cheque (`החזרת שיק` on the site), which is a debit.
const DEPOSIT_DESCRIPTION = /^\s*הפקדת/;
const RETURNED_DESCRIPTION = /^\s*החזר/;
const API_DATE_FORMAT = 'YYYYMMDD';
const HEADERS_WAIT_TIMEOUT = 30000;
const HEADERS_POLL_INTERVAL = 500;

interface ChequeMagneticCode {
  chequeBank: number;
  chequeBranch: number;
  chequeAccount: number;
  chequeNumber: number;
}

export interface ChequeDepositItem {
  depositDetails?: {
    chequeDetails?: {
      magneticCode?: ChequeMagneticCode;
      amount?: number;
    };
    depositReference?: number;
    depositDate?: string;
    isReturned?: boolean;
  };
  returned?: {
    returnDate?: string;
    returnReasons?: { returnCode?: number; returnDescription?: string }[];
  };
}

export interface ChequeDepositListResponse {
  totalDeposits?: number;
  depositItems?: ChequeDepositItem[];
}

function buildLookupUrl(baseUrl: string, txn: Transaction): string {
  const date = moment(txn.date);
  const amount = Math.abs(txn.chargedAmount);
  const filter: Record<string, unknown> = {
    depositDate: {
      fromDate: date.clone().subtract(1, 'day').format(API_DATE_FORMAT),
      toDate: date.clone().add(1, 'day').format(API_DATE_FORMAT),
    },
    amount: { fromAmount: amount, toAmount: amount },
  };
  const reference = Number(txn.identifier);
  if (reference) {
    filter.depositReference = reference;
  }
  return `${baseUrl}?depositTransactionFilter=${encodeURIComponent(JSON.stringify(filter))}`;
}

/**
 * The URL holding the cheque details of a transaction, or null when it cannot be a cheque.
 * Deposits and returned cheques are looked up by amount and reference, the same filter the site
 * itself sends when a row is opened. The date range is widened by a day on each side because the
 * transaction date is converted from UTC and may land on the neighbouring day. Leumi only has the
 * details once a transaction is final, never for today's pending ones.
 */
export function getChequeLookupUrl(txn: Transaction): string | null {
  if (txn.status !== TransactionStatuses.Completed) {
    return null;
  }
  if (txn.chargedAmount > 0 && DEPOSIT_DESCRIPTION.test(txn.description)) {
    return buildLookupUrl(CHEQUE_DEPOSITS_URL, txn);
  }
  if (txn.chargedAmount < 0 && RETURNED_DESCRIPTION.test(txn.description)) {
    return buildLookupUrl(RETURNED_CHEQUES_URL, txn);
  }
  return null;
}

/**
 * One entry per cheque, e.g. `שיק 10914 מחשבון 12-626-100676` - the cheque number and the
 * payer's bank-branch-account, as shown in the site's transaction details panel. A returned
 * cheque also gets the return reason, e.g. `חזר: א.כ.מ- אין כיסוי מספיק`.
 */
export function formatChequeDetails(response: ChequeDepositListResponse | null, reference?: number): string {
  const items = (response?.depositItems || []).filter(
    item => !reference || !item.depositDetails?.depositReference || item.depositDetails.depositReference === reference,
  );

  return items
    .map(item => {
      const code = item.depositDetails?.chequeDetails?.magneticCode;
      if (!code?.chequeNumber) {
        return '';
      }
      const cheque = `שיק ${code.chequeNumber} מחשבון ${code.chequeBank}-${code.chequeBranch}-${code.chequeAccount}`;
      const reasons = (item.returned?.returnReasons || [])
        .map(reason => reason.returnDescription)
        .filter(Boolean)
        .join(', ');
      return reasons ? `${cheque} חזר: ${reasons}` : cheque;
    })
    .filter(Boolean)
    .join(', ');
}

/**
 * Records the headers of the first authenticated API request the digitalfront site makes, so
 * that the scraper can call the same API. Must be attached before the site is loaded.
 */
function recordDigitalApiHeaders(page: Page) {
  let headers: Record<string, string> | null = null;
  const listener = (request: HTTPRequest) => {
    const requestHeaders = request.headers();
    if (!headers && request.url().includes(DIGITAL_API_PATH) && requestHeaders.authorization) {
      headers = requestHeaders;
    }
  };
  page.on('request', listener);

  return {
    get: () => headers,
    stop: () => page.off('request', listener),
  };
}

async function getDigitalApiHeaders(page: Page): Promise<Record<string, string> | null> {
  const recorder = recordDigitalApiHeaders(page);
  try {
    await page.goto(DIGITAL_TRANSACTIONS_URL, { waitUntil: 'networkidle2' });
    const deadline = Date.now() + HEADERS_WAIT_TIMEOUT;
    while (!recorder.get() && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, HEADERS_POLL_INTERVAL));
    }
    return recorder.get();
  } finally {
    recorder.stop();
  }
}

async function fetchChequeDeposits(
  page: Page,
  url: string,
  headers: Record<string, string>,
): Promise<ChequeDepositListResponse | null> {
  // Every request of the site carries fresh message and transaction ids.
  const requestHeaders = { ...headers, 'x-message-id': randomUUID(), 'x-transaction-id': randomUUID() };
  const [status, text] = await page.evaluate(
    async (innerUrl, innerHeaders) => {
      const response = await fetch(innerUrl, { credentials: 'include', headers: innerHeaders });
      return [response.status, await response.text()] as const;
    },
    url,
    requestHeaders,
  );

  if (status !== 200) {
    debug('cheque deposits request returned status %d', status);
    return null;
  }
  return JSON.parse(text) as ChequeDepositListResponse;
}

/**
 * Adds the cheque number and the payer's account to the memo of every cheque deposit and returned
 * cheque. Failures are logged and leave the transaction as it was.
 */
export async function addChequeDetails(page: Page, accounts: TransactionsAccount[]): Promise<void> {
  const lookups = accounts.flatMap(account =>
    account.txns.flatMap(txn => {
      const url = getChequeLookupUrl(txn);
      return url ? [{ txn, url }] : [];
    }),
  );
  if (!lookups.length) {
    return;
  }

  debug('looking up %d transactions for cheque details', lookups.length);
  try {
    const headers = await getDigitalApiHeaders(page);
    if (!headers) {
      debug('the digitalfront site made no authenticated API request, skipping cheque details');
      return;
    }
    debug('recorded digitalfront API headers: %s', Object.keys(headers).join(', '));

    for (const { txn, url } of lookups) {
      try {
        const response = await fetchChequeDeposits(page, url, headers);
        const details = formatChequeDetails(response, Number(txn.identifier) || undefined);
        debug('transaction %s: %d items, details "%s"', txn.identifier, response?.depositItems?.length ?? 0, details);
        if (details) {
          txn.memo = txn.memo ? `${txn.memo} ${details}` : details;
        }
      } catch (error) {
        debug('error fetching cheque details for transaction %s: %s', txn.identifier, error);
      }
    }
  } catch (error) {
    debug('error fetching cheque details: %s', error);
  }
}
