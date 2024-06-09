import moment from 'moment';
import { Page } from 'puppeteer';
import {
  DOLLAR_CURRENCY,
  DOLLAR_CURRENCY_SYMBOL, EURO_CURRENCY,
  EURO_CURRENCY_SYMBOL,
  SHEKEL_CURRENCY,
  SHEKEL_CURRENCY_SYMBOL,
} from '../constants';
import { getDebug } from '../helpers/debug';
import { pageEval, pageEvalAll, waitUntilElementFound } from '../helpers/elements-interactions';
import { filterOldTransactions } from '../helpers/transactions';
import { Transaction, TransactionStatuses, TransactionTypes } from '../transactions';
import { BaseScraperWithBrowser, LoginResults, PossibleLoginResults } from './base-scraper-with-browser';
import { ScraperOptions } from './interface';

const debug = getDebug('beyahadBishvilha');

const DATE_FORMAT = 'DD/MM/YY';
const LOGIN_URL = 'https://www.hist.org.il/login';
const SUCCESS_URL = 'https://www.hist.org.il/';
const CARD_URL = 'https://www.hist.org.il/card/balanceAndUses';

interface ScrapedTransaction {
  date: string;
  description: string;
  type: string;
  chargedAmount: string;
  identifier: string;
}

function getAmountData(amountStr: string) {
  const amountStrCln = amountStr.replace(',', '');
  let currency: string | null = null;
  let amount: number | null = null;
  if (amountStrCln.includes(SHEKEL_CURRENCY_SYMBOL)) {
    amount = parseFloat(amountStrCln.replace(SHEKEL_CURRENCY_SYMBOL, ''));
    currency = SHEKEL_CURRENCY;
  } else if (amountStrCln.includes(DOLLAR_CURRENCY_SYMBOL)) {
    amount = parseFloat(amountStrCln.replace(DOLLAR_CURRENCY_SYMBOL, ''));
    currency = DOLLAR_CURRENCY;
  } else if (amountStrCln.includes(EURO_CURRENCY_SYMBOL)) {
    amount = parseFloat(amountStrCln.replace(EURO_CURRENCY_SYMBOL, ''));
    currency = EURO_CURRENCY;
  } else {
    const parts = amountStrCln.split(' ');
    [currency] = parts;
    amount = parseFloat(parts[1]);
  }

  return {
    amount,
    currency,
  };
}

function convertTransactions(txns: ScrapedTransaction[]): Transaction[] {
  debug(`convert ${txns.length} raw transactions to official Transaction structure`);
  return txns.map((txn) => {
    const chargedAmountTuple = getAmountData(txn.chargedAmount || '');
    const txnProcessedDate = moment(txn.date, DATE_FORMAT);

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

    return result;
  });
}

async function fetchTransactions(page: Page, options: ScraperOptions) {
  await page.goto(CARD_URL);
  await waitUntilElementFound(page, '.react-loading.hide', false);
  const defaultStartMoment = moment().subtract(1, 'years');
  const startDate = options.startDate || defaultStartMoment.toDate();
  const startMoment = moment.max(defaultStartMoment, moment(startDate));

  const accountNumber = await pageEval(page, '.wallet-details div:nth-of-type(2)', null, (element) => {
    return (element as any).innerText.replace('מספר כרטיס ', '');
  });

  const balance = await pageEval(page, '.wallet-details div:nth-of-type(4) > span:nth-of-type(2)', null, (element) => {
    return (element as any).innerText;
  });

  debug('fetch raw transactions from page');

  const rawTransactions: (ScrapedTransaction | null)[] = await pageEvalAll<(ScrapedTransaction | null)[]>(page, '.transaction-container, .transaction-component-container', [], (items) => {
    return (items).map((el) => {
      const columns: NodeListOf<HTMLSpanElement> = el.querySelectorAll('.transaction-item > span');
      if (columns.length === 7) {
        return {
          date: columns[0].innerText,
          identifier: columns[1].innerText,
          description: columns[3].innerText,
          type: columns[5].innerText,
          chargedAmount: columns[6].innerText,
        };
      }
      return null;
    });
  });
  debug(`fetched ${rawTransactions.length} raw transactions from page`);

  const accountTransactions = convertTransactions(rawTransactions.filter((item) => !!item) as ScrapedTransaction[]);

  debug('filer out old transactions');
  const txns = (options.outputData?.enableTransactionsFilterByDate ?? true) ?
    filterOldTransactions(accountTransactions, startMoment, false) :
    accountTransactions;
  debug(`found ${txns.length} valid transactions out of ${accountTransactions.length} transactions for account ending with ${accountNumber.substring(accountNumber.length - 2)}`);

  return {
    accountNumber,
    balance: getAmountData(balance).amount,
    txns,
  };
}

function getPossibleLoginResults(): PossibleLoginResults {
  const urls: PossibleLoginResults = {};
  urls[LoginResults.Success] = [SUCCESS_URL];
  urls[LoginResults.ChangePassword] = []; // TODO
  urls[LoginResults.InvalidPassword] = []; // TODO
  urls[LoginResults.UnknownError] = []; // TODO
  return urls;
}

function createLoginFields(credentials: ScraperSpecificCredentials) {
  return [
    { selector: '#loginId', value: credentials.id },
    { selector: '#loginPassword', value: credentials.password },
  ];
}

type ScraperSpecificCredentials = { id: string, password: string };

class BeyahadBishvilhaScraper extends BaseScraperWithBrowser<ScraperSpecificCredentials> {
  protected getViewPort(): { width: number, height: number } {
    return {
      width: 1500,
      height: 800,
    };
  }

  getLoginOptions(credentials: ScraperSpecificCredentials) {
    return {
      loginUrl: LOGIN_URL,
      fields: createLoginFields(credentials),
      submitButtonSelector: async () => {
        const [button] = await this.page.$$('xpath//button[contains(., \'התחבר\')]');
        if (button) {
          await button.click();
        }
      },
      possibleResults: getPossibleLoginResults(),
    };
  }

  async fetchData() {
    const account = await fetchTransactions(this.page, this.options);
    return {
      success: true,
      accounts: [account],
    };
  }
}

export default BeyahadBishvilhaScraper;
