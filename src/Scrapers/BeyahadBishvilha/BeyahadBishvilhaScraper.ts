import moment from 'moment';
import { type Page } from 'playwright';

import { getDebug } from '../../Common/Debug';
import { pageEval, pageEvalAll, waitUntilElementFound } from '../../Common/ElementsInteractions';
import { toFirstCss } from '../../Common/SelectorResolver';
import { filterOldTransactions, getRawTransaction } from '../../Common/Transactions';
import {
  DOLLAR_CURRENCY,
  DOLLAR_CURRENCY_SYMBOL,
  EURO_CURRENCY,
  EURO_CURRENCY_SYMBOL,
  SHEKEL_CURRENCY,
  SHEKEL_CURRENCY_SYMBOL,
} from '../../Constants';
import { CompanyTypes } from '../../Definitions';
import { type Transaction, TransactionStatuses, TransactionTypes } from '../../Transactions';
import { GenericBankScraper } from '../Base/GenericBankScraper';
import { type ScraperOptions } from '../Base/Interface';
import { SCRAPER_CONFIGURATION } from '../Registry/ScraperConfig';
import { BEYAHAD_CONFIG } from './BeyahadBishvilhaLoginConfig';

const LOG = getDebug('beyahadBishvilha');

const CFG = SCRAPER_CONFIGURATION.banks[CompanyTypes.BeyahadBishvilha];
// Phase-1 compat: extract first CSS candidate until full resolveDashboardField() migration
const SEL = Object.fromEntries(
  Object.entries(CFG.selectors).map(([k, cs]) => [k, toFirstCss(cs)]),
) as Record<string, string>;

interface ScrapedTransaction {
  date: string;
  description: string;
  type: string;
  chargedAmount: string;
  identifier: string;
}

const CURRENCY_SYMBOLS: [string, string][] = [
  [SHEKEL_CURRENCY_SYMBOL, SHEKEL_CURRENCY],
  [DOLLAR_CURRENCY_SYMBOL, DOLLAR_CURRENCY],
  [EURO_CURRENCY_SYMBOL, EURO_CURRENCY],
];

function parseCurrencyAmount(amountStrCln: string): { amount: number; currency: string } {
  for (const [symbol, currency] of CURRENCY_SYMBOLS) {
    if (amountStrCln.includes(symbol)) {
      return { amount: parseFloat(amountStrCln.replace(symbol, '')), currency };
    }
  }
  const parts = amountStrCln.split(' ');
  return { amount: parseFloat(parts[1]), currency: parts[0] };
}

function getAmountData(amountStr: string): { amount: number; currency: string } {
  return parseCurrencyAmount(amountStr.replace(',', ''));
}

function convertOneTxn(txn: ScrapedTransaction, options?: ScraperOptions): Transaction {
  const chargedAmountTuple = getAmountData(txn.chargedAmount || '');
  const txnProcessedDate = moment(txn.date, CFG.format.date);
  const result: Transaction = {
    type: TransactionTypes.Normal,
    status: TransactionStatuses.Completed,
    date: txnProcessedDate.toISOString(),
    processedDate: txnProcessedDate.toISOString(),
    originalAmount: chargedAmountTuple.amount,
    originalCurrency: chargedAmountTuple.currency,
    chargedAmount: chargedAmountTuple.amount,
    chargedCurrency: chargedAmountTuple.currency,
    description: txn.description || '',
    memo: '',
    identifier: txn.identifier,
  };
  if (options?.includeRawTransaction) result.rawTransaction = getRawTransaction(txn);
  return result;
}

function convertTransactions(txns: ScrapedTransaction[], options?: ScraperOptions): Transaction[] {
  LOG.info(`convert ${txns.length} raw transactions to official Transaction structure`);
  return txns.map(txn => convertOneTxn(txn, options));
}

async function scrapeRawTransactions(page: Page): Promise<(ScrapedTransaction | null)[]> {
  return pageEvalAll<(ScrapedTransaction | null)[]>(page, {
    selector: SEL.transactionContainer,
    defaultResult: [],
    callback: items =>
      items.map(el => {
        const columns: NodeListOf<HTMLSpanElement> = el.querySelectorAll(SEL.transactionColumns);
        if (columns.length !== 7) return null;
        return {
          date: columns[0].innerText,
          identifier: columns[1].innerText,
          description: columns[3].innerText,
          type: columns[5].innerText,
          chargedAmount: columns[6].innerText,
        };
      }),
  });
}

async function scrapeAccountInfo(page: Page): Promise<{ accountNumber: string; balance: string }> {
  const accountNumber = await pageEval(page, {
    selector: SEL.cardNumber,
    defaultResult: '',
    callback: element => (element as HTMLElement).innerText.replace('מספר כרטיס ', ''),
  });
  const balance = await pageEval(page, {
    selector: SEL.balance,
    defaultResult: '',
    callback: element => (element as HTMLElement).innerText,
  });
  return { accountNumber, balance };
}

function applyDateFilter(
  txns: Transaction[],
  options: ScraperOptions,
  startMoment: moment.Moment,
): Transaction[] {
  return (options.outputData?.isFilterByDateEnabled ?? true)
    ? filterOldTransactions(txns, startMoment, false)
    : txns;
}

async function getFilteredTxns(
  page: Page,
  options: ScraperOptions,
  startMoment: moment.Moment,
): Promise<{ accountTransactions: Transaction[]; txns: Transaction[] }> {
  LOG.info('fetch raw transactions from page');
  const rawTransactions = await scrapeRawTransactions(page);
  LOG.info(`fetched ${rawTransactions.length} raw transactions from page`);
  const accountTransactions = convertTransactions(
    rawTransactions.filter(item => !!item),
    options,
  );
  return { accountTransactions, txns: applyDateFilter(accountTransactions, options, startMoment) };
}

async function fetchTransactions(
  page: Page,
  options: ScraperOptions,
): Promise<{ accountNumber: string; balance: number; txns: Transaction[] }> {
  await page.goto(CFG.api.card);
  await waitUntilElementFound(page, SEL.loadingIndicator, { visible: false });
  const defaultStartMoment = moment().subtract(1, 'years');
  const startMoment = moment.max(defaultStartMoment, moment(options.startDate));
  const { accountNumber, balance } = await scrapeAccountInfo(page);
  const { accountTransactions, txns } = await getFilteredTxns(page, options, startMoment);
  LOG.info(
    `found ${txns.length} valid transactions out of ${accountTransactions.length} transactions for account ending with ${accountNumber.substring(accountNumber.length - 2)}`,
  );
  return { accountNumber, balance: getAmountData(balance).amount, txns };
}

interface ScraperSpecificCredentials {
  id: string;
  password: string;
}

class BeyahadBishvilhaScraper extends GenericBankScraper<ScraperSpecificCredentials> {
  constructor(options: ScraperOptions) {
    super(options, BEYAHAD_CONFIG);
  }

  public async fetchData(): Promise<{
    success: boolean;
    accounts: { accountNumber: string; balance: number; txns: Transaction[] }[];
  }> {
    const account = await fetchTransactions(this.page, this.options);
    return {
      success: true,
      accounts: [account],
    };
  }

  public getViewPort(): { width: number; height: number } {
    return {
      width: 1500,
      height: 800,
    };
  }
}

export default BeyahadBishvilhaScraper;
