import moment, { Moment } from 'moment';
import { Page } from 'puppeteer';
import { BaseScraperWithBrowser, LoginResults, LoginOptions } from './base-scraper-with-browser';
import {
  fillInput,
  clickButton,
  waitUntilElementFound,
  pageEvalAll,
} from '../helpers/elements-interactions';
import { SHEKEL_CURRENCY } from '../constants';
import {
  TransactionsAccount, Transaction, TransactionStatuses, TransactionTypes,
} from '../transactions';
import { ScaperScrapingResult, ScraperCredentials } from './base-scraper';

const BASE_URL = 'https://hb2.bankleumi.co.il';
const TRANSACTIONS_URL = `${BASE_URL}/eBanking/SO/SPA.aspx#/ts/BusinessAccountTrx?WidgetPar=1`;
const FILTERED_TRANSACTIONS_URL = `${BASE_URL}/ChannelWCF/Broker.svc/ProcessRequest?moduleName=UC_SO_27_GetBusinessAccountTrx`;

const DATE_FORMAT = 'DD.MM.YY';
const ACCOUNT_BLOCKED_MSG = 'המנוי חסום';


function getPossibleLoginResults() {
  const urls: LoginOptions['possibleResults'] = {};
  urls[LoginResults.Success] = [/ebanking\/SO\/SPA.aspx/i];
  urls[LoginResults.InvalidPassword] = [/InternalSite\/CustomUpdate\/leumi\/LoginPage.ASP/];
  urls[LoginResults.AccountBlocked] = [async (options) => {
    if (!options || !options.page) {
      throw new Error('missing page options argument');
    }
    const errorMessage = await pageEvalAll(options.page, '.errHeader', [], (label) => {
      return (label[0] as HTMLElement).innerText;
    });

    return errorMessage.startsWith(ACCOUNT_BLOCKED_MSG);
  }];
  // urls[LOGIN_RESULT.CHANGE_PASSWORD] = ``; // TODO should wait until my password expires
  return urls;
}

function createLoginFields(credentials: ScraperCredentials) {
  return [
    { selector: '#wtr_uid', value: credentials.username },
    { selector: '#wtr_password', value: credentials.password },
  ];
}

function extractTransactionsFromPage(transactions: any[], status: TransactionStatuses): Transaction[] {
  if (transactions === null || transactions.length === 0) {
    return [];
  }

  const result: Transaction[] = transactions.map(rawTransaction => {
    const newTransaction: Transaction = {
      status,
      type: TransactionTypes.Normal,
      date: rawTransaction.DateUTC,
      processedDate: rawTransaction.DateUTC,
      description: rawTransaction.Description || '',
      identifier: rawTransaction.ReferenceNumberLong,
      memo: rawTransaction.AdditionalData || '',
      originalCurrency: SHEKEL_CURRENCY,
      chargedAmount: rawTransaction.Amount,
      originalAmount: rawTransaction.Amount,
    };

    return newTransaction;
  })

  return result;
}


async function fetchTransactionsForAccount(page: Page, startDate: Moment, accountId: string): Promise<TransactionsAccount> {
  await waitUntilElementFound(page, 'button[title="חיפוש מתקדם"]', true);
  await clickButton(page, 'button[title="חיפוש מתקדם"]');
  await clickButton(page, '#bll-radio-3');
  await waitUntilElementFound(page, 'input[formcontrolname="txtInputFrom"]', true);

  await fillInput(
      page,
      'input[formcontrolname="txtInputFrom"]',
      startDate.format(DATE_FORMAT),
  );

  // we must blur the from control otherwise the search will use the previous value
  await page.focus("button[aria-label='סנן']");

  await clickButton(page, "button[aria-label='סנן']");
  const finalResponse = await page.waitForResponse(response => {
    return response.url() === FILTERED_TRANSACTIONS_URL
        && response.request().method() === 'POST';
  });

  let responseJson: any = await finalResponse.json();

  const accountNumber = accountId;
  const response = JSON.parse(responseJson.jsonResp);

  const pendingTransactions = response.TodayTransactionsItems;
  const transactions = response.HistoryTransactionsItems;
  const balance = response.BalanceDisplay ? parseFloat(response.BalanceDisplay) : undefined;

  const pendingTxns = extractTransactionsFromPage(pendingTransactions, TransactionStatuses.Pending);
  const completedTxns = extractTransactionsFromPage(transactions, TransactionStatuses.Completed);
  const txns = [
    ...pendingTxns,
    ...completedTxns,
  ];

  return {
    accountNumber,
    balance,
    txns,
  };
}

function hangProcess(timeout: number) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, timeout)
  })
}
async function fetchTransactions(page: Page, startDate: Moment): Promise<TransactionsAccount[]> {
  // TODO should adjust logic to support multiple accounts (I don't have such an account)

  // DEVELOPER NOTICE the account number received from the server is being altered at runtime for some accounts
  // after 1-2 seconds so we need to hang the process for a short while.
  await hangProcess(4000);

  const accountSpanText = await page.$eval('app-masked-number-combo span.display-number-li', (span: any) => {
    return span.textContent;
  });

  // due to a bug, the altered value might include undesired signs like & that are removed here
  const accountNumberMatches = accountSpanText.match(/\d+-\d+(\/)?\d+/);
  const account = accountNumberMatches ? accountNumberMatches[0] : null;

  if (!account) {
    throw new Error('Failed to extract or parse the account number');
  }

  return [
      await fetchTransactionsForAccount(page, startDate, account)
  ]
  return new Promise((resolve) => {
    setTimeout(() => {


      if (!account) {
        throw new Error('failed to extract account number');
      }
      resolve([

      ]);
    }, 5000);
  })

}

async function waitForPostLogin(page: Page): Promise<void> {
  // TODO check for condition to provide new password
  await Promise.race([
    waitUntilElementFound(page, 'div.leumi-container', true),
    waitUntilElementFound(page, '#BodyContent_ctl00_loginErrMsg', true),
    waitUntilElementFound(page, '.ErrMsg', true),
  ]);
}

class LeumiScraper extends BaseScraperWithBrowser {
  getLoginOptions(credentials: Record<string, string>) {
    return {
      loginUrl: `${BASE_URL}`,
      fields: createLoginFields(credentials),
      submitButtonSelector: '#enter',
      postAction: async () => waitForPostLogin(this.page),
      possibleResults: getPossibleLoginResults(),
    };
  }

  async fetchData(): Promise<ScaperScrapingResult> {
    const defaultStartMoment = moment().subtract(1, 'years').add(1, 'day');
    const startDate = this.options.startDate || defaultStartMoment.toDate();
    const startMoment = moment.max(defaultStartMoment, moment(startDate));

    await this.navigateTo(TRANSACTIONS_URL);

    const accounts = await fetchTransactions(this.page, startMoment);

    return {
      success: true,
      accounts,
    };
  }
}

export default LeumiScraper;
