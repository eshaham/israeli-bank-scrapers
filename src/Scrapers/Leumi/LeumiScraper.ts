import moment, { type Moment } from 'moment';
import { type Page } from 'playwright';

import { clickButton, fillInput, waitUntilElementFound } from '../../Common/ElementsInteractions';
import { toFirstCss } from '../../Common/SelectorResolver';
import { getRawTransaction } from '../../Common/Transactions';
import { SHEKEL_CURRENCY } from '../../Constants';
import { CompanyTypes } from '../../Definitions';
import {
  type Transaction,
  type TransactionsAccount,
  TransactionStatuses,
  TransactionTypes,
} from '../../Transactions';
import { GenericBankScraper } from '../Base/GenericBankScraper';
import { type ScraperOptions, type ScraperScrapingResult } from '../Base/Interface';
import { SCRAPER_CONFIGURATION } from '../Registry/ScraperConfig';
import { LEUMI_CONFIG } from './LeumiLoginConfig';

const CFG = SCRAPER_CONFIGURATION.banks[CompanyTypes.Leumi];
// Phase-1 compat: extract first CSS candidate until full resolveDashboardField() migration
const SEL = Object.fromEntries(
  Object.entries(CFG.selectors).map(([k, cs]) => [k, toFirstCss(cs)]),
) as Record<string, string>;
const TRANSACTIONS_URL = CFG.urls.transactions;
const FILTERED_TRANSACTIONS_URL = `${CFG.api.base}/ChannelWCF/Broker.svc/ProcessRequest?moduleName=UC_SO_27_GetBusinessAccountTrx`;

interface LeumiRawTransaction {
  DateUTC: string;
  Description?: string;
  ReferenceNumberLong?: number;
  AdditionalData?: string;
  Amount: number;
}

function buildTxnBase(
  rawTransaction: LeumiRawTransaction,
  status: TransactionStatuses,
  date: string,
): Transaction {
  return {
    status,
    type: TransactionTypes.Normal,
    date,
    processedDate: date,
    description: rawTransaction.Description ?? '',
    identifier: rawTransaction.ReferenceNumberLong,
    memo: rawTransaction.AdditionalData ?? '',
    originalCurrency: SHEKEL_CURRENCY,
    chargedAmount: rawTransaction.Amount,
    originalAmount: rawTransaction.Amount,
  };
}

function mapOneTxn(
  rawTransaction: LeumiRawTransaction,
  status: TransactionStatuses,
  options?: ScraperOptions,
): Transaction {
  const date = moment(rawTransaction.DateUTC).milliseconds(0).toISOString();
  const tx = buildTxnBase(rawTransaction, status, date);
  if (options?.includeRawTransaction) tx.rawTransaction = getRawTransaction(rawTransaction);
  return tx;
}

function extractTransactionsFromPage(
  transactions: LeumiRawTransaction[] | null,
  status: TransactionStatuses,
  options?: ScraperOptions,
): Transaction[] {
  if (!transactions || transactions.length === 0) return [];
  return transactions.map(rawTransaction => mapOneTxn(rawTransaction, status, options));
}

function hangProcess(timeout: number): Promise<void> {
  return new Promise<void>(resolve => {
    setTimeout(() => {
      resolve();
    }, timeout);
  });
}

async function clickByXPath(page: Page, xpath: string): Promise<void> {
  await page.waitForSelector(xpath, { timeout: 30000, state: 'visible' });
  const elm = await page.$$(xpath);
  await elm[0].click();
}

function removeSpecialCharacters(str: string): string {
  return str.replace(/[^0-9/-]/g, '');
}

interface FetchForAccountOpts {
  page: Page;
  startDate: Moment;
  accountId: string;
  options: ScraperOptions;
}

async function applyDateFilter(page: Page, startDate: Moment): Promise<void> {
  await waitUntilElementFound(page, SEL.advancedSearchBtn, { visible: true });
  await clickButton(page, SEL.advancedSearchBtn);
  await waitUntilElementFound(page, SEL.dateRangeRadio.split(':')[0], { visible: true });
  await clickButton(page, SEL.dateRangeRadio);
  await waitUntilElementFound(page, SEL.dateFromInput, { visible: true });
  await fillInput(page, SEL.dateFromInput, startDate.format(CFG.format.date));
  await page.focus(SEL.filterBtn);
  await clickButton(page, SEL.filterBtn);
}

interface LeumiAccountResponse {
  BalanceDisplay?: string;
  TodayTransactionsItems: LeumiRawTransaction[] | null;
  HistoryTransactionsItems: LeumiRawTransaction[] | null;
}

function parseAccountResponse(responseJson: { jsonResp: string }): LeumiAccountResponse {
  return JSON.parse(responseJson.jsonResp) as LeumiAccountResponse;
}

function buildTxnsFromResponse(
  response: LeumiAccountResponse,
  options: ScraperOptions,
): Transaction[] {
  const pending = extractTransactionsFromPage(
    response.TodayTransactionsItems,
    TransactionStatuses.Pending,
    options,
  );
  const completed = extractTransactionsFromPage(
    response.HistoryTransactionsItems,
    TransactionStatuses.Completed,
    options,
  );
  return [...pending, ...completed];
}

async function interceptFilteredResponse(page: Page): Promise<LeumiAccountResponse> {
  const finalResponse = await page.waitForResponse(
    response =>
      response.url() === FILTERED_TRANSACTIONS_URL && response.request().method() === 'POST',
  );
  return parseAccountResponse((await finalResponse.json()) as { jsonResp: string });
}

function sanitizeAccountId(accountId: string): string {
  return accountId.replace('/', '_').replace(/[^\d-_]/g, '');
}

async function fetchTransactionsForAccount(
  opts: FetchForAccountOpts,
): Promise<TransactionsAccount> {
  const { page, startDate, accountId, options } = opts;
  await hangProcess(4000);
  await applyDateFilter(page, startDate);
  const response = await interceptFilteredResponse(page);
  const accountNumber = sanitizeAccountId(accountId);
  const balance = response.BalanceDisplay ? parseFloat(response.BalanceDisplay) : undefined;
  return { accountNumber, balance, txns: buildTxnsFromResponse(response, options) };
}

async function extractAccountIds(page: Page): Promise<string[]> {
  const ids = await page.evaluate(
    sel => Array.from(document.querySelectorAll(sel), e => e.textContent),
    SEL.accountListItems,
  );
  if (!ids.length) throw new Error('Failed to extract or parse the account number');
  return ids;
}

async function switchToAccount(
  page: Page,
  accountId: string,
  totalAccounts: number,
): Promise<void> {
  if (totalAccounts <= 1) return;
  await clickByXPath(page, SEL.accountCombo);
  await clickByXPath(page, `xpath=//span[contains(text(), '${accountId}')]`);
}

interface FetchByIdOpts {
  page: Page;
  rawAccountId: string;
  totalAccounts: number;
  startDate: Moment;
  options: ScraperOptions;
}

async function fetchAccountById(opts: FetchByIdOpts): Promise<TransactionsAccount> {
  const { rawAccountId, totalAccounts, page, startDate, options } = opts;
  await switchToAccount(page, rawAccountId, totalAccounts);
  const accountId = removeSpecialCharacters(rawAccountId);
  return fetchTransactionsForAccount({ page, startDate, accountId, options });
}

async function fetchTransactions(
  page: Page,
  startDate: Moment,
  options: ScraperOptions,
): Promise<TransactionsAccount[]> {
  await hangProcess(4000);
  const accountsIds = await extractAccountIds(page);
  const accounts: TransactionsAccount[] = [];
  const totalAccounts = accountsIds.length;
  for (const rawAccountId of accountsIds) {
    accounts.push(
      await fetchAccountById({ page, rawAccountId, totalAccounts, startDate, options }),
    );
  }
  return accounts;
}

interface ScraperSpecificCredentials {
  username: string;
  password: string;
}

class LeumiScraper extends GenericBankScraper<ScraperSpecificCredentials> {
  constructor(options: ScraperOptions) {
    super(options, LEUMI_CONFIG);
  }

  public async fetchData(): Promise<ScraperScrapingResult> {
    const minimumStartMoment = moment().subtract(3, 'years').add(1, 'day');
    const startMoment = moment.max(minimumStartMoment, moment(this.options.startDate));

    await this.navigateTo(TRANSACTIONS_URL);

    const accounts = await fetchTransactions(this.page, startMoment, this.options);

    return {
      success: true,
      accounts,
    };
  }
}

export default LeumiScraper;
