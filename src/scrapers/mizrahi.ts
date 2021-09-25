import moment from 'moment';
import { Page, Request } from 'puppeteer';
import {
  SHEKEL_CURRENCY,
} from '../constants';
import { pageEvalAll, waitUntilElementDisappear, waitUntilElementFound } from '../helpers/elements-interactions';
import { fetchPostWithinPage } from '../helpers/fetch';
import { waitForUrl } from '../helpers/navigation';
import {
  Transaction, TransactionStatuses, TransactionTypes,
} from '../transactions';
import { ScraperCredentials, ScraperErrorTypes } from './base-scraper';
import { BaseScraperWithBrowser, LoginResults, PossibleLoginResults } from './base-scraper-with-browser';

interface ScrapedTransaction {
  RecTypeSpecified: boolean;
  MC02PeulaTaaEZ: string;
  MC02SchumEZ: number;
  MC02AsmahtaMekoritEZ: string;
  MC02TnuaTeurEZ: string;
}

interface ScrapedTransactionsResult {
  header: {
    success: boolean;
    messages: { text: string }[];
  };
  body: {
    fields: {
      AccountNumber: string;
      YitraLeloChekim: string;
    };
    table: {
      rows: ScrapedTransaction[];
    };
  };
}

const BASE_WEBSITE_URL = 'https://www.mizrahi-tefahot.co.il';
const LOGIN_URL = `${BASE_WEBSITE_URL}/login/index.html#/auth-page-he`;
const BASE_APP_URL = 'https://mto.mizrahi-tefahot.co.il';
const AFTER_LOGIN_BASE_URL = /https:\/\/mto\.mizrahi-tefahot\.co\.il\/ngOnline\/index\.html#\/main\/uis/;
const OSH_PAGE = `${BASE_APP_URL}/ngOnline/index.html#/main/uis/osh/p428/`;
const TRANSACTIONS_REQUEST_URL = `${BASE_APP_URL}/Online/api/SkyOSH/get428Index`;
const PENDING_TRANSACTIONS_PAGE = `${BASE_APP_URL}/Online/Osh/p420.aspx`;
const CHANGE_PASSWORD_URL = /https:\/\/www\.mizrahi-tefahot\.co\.il\/login\/\w+\/index\.html#\/change-pass/;
const DATE_FORMAT = 'DD/MM/YYYY';
const MAX_ROWS_PER_REQUEST = 10000000000;

const usernameSelector = '#emailDesktopHeb';
const passwordSelector = '#passwordIDDesktopHEB';
const submitButtonSelector = '.form-desktop button';
const invalidPasswordSelector = 'a[href*="https://sc.mizrahi-tefahot.co.il/SCServices/SC/P010.aspx"]';
const afterLoginSelector = '#stickyHeaderScrollRegion';
const loginSpinnerSelector = 'div.ngx-overlay.loading-foreground';

function createLoginFields(credentials: ScraperCredentials) {
  return [
    { selector: usernameSelector, value: credentials.username },
    { selector: passwordSelector, value: credentials.password },
  ];
}

function getPossibleLoginResults(page: Page): PossibleLoginResults {
  return {
    [LoginResults.Success]: [AFTER_LOGIN_BASE_URL],
    [LoginResults.InvalidPassword]: [async () => !!(await page.$(invalidPasswordSelector))],
    [LoginResults.ChangePassword]: [CHANGE_PASSWORD_URL],
  };
}

function getStartMoment(optionsStartDate: Date) {
  const defaultStartMoment = moment().subtract(1, 'years');
  const startDate = optionsStartDate || defaultStartMoment.toDate();
  return moment.max(defaultStartMoment, moment(startDate));
}

function createDataFromRequest(request: Request, optionsStartDate: Date) {
  const data = JSON.parse(request.postData() || '{}');

  data.inFromDate = getStartMoment(optionsStartDate).format(DATE_FORMAT);
  data.inToDate = moment().format(DATE_FORMAT);
  data.table.maxRow = MAX_ROWS_PER_REQUEST;

  return data;
}

function createHeadersFromRequest(request: Request) {
  return {
    mizrahixsrftoken: request.headers().mizrahixsrftoken,
    'Content-Type': request.headers()['content-type'],
  };
}


function convertTransactions(txns: ScrapedTransaction[]): Transaction[] {
  return txns.map((row) => {
    const txnDate = moment(row.MC02PeulaTaaEZ, moment.HTML5_FMT.DATETIME_LOCAL_SECONDS)
      .toISOString();

    return {
      type: TransactionTypes.Normal,
      identifier: row.MC02AsmahtaMekoritEZ ? parseInt(row.MC02AsmahtaMekoritEZ, 10) : undefined,
      date: txnDate,
      processedDate: txnDate,
      originalAmount: row.MC02SchumEZ,
      originalCurrency: SHEKEL_CURRENCY,
      chargedAmount: row.MC02SchumEZ,
      description: row.MC02TnuaTeurEZ,
      status: TransactionStatuses.Completed,
    };
  });
}

async function extractPendingTransactions(page: Page): Promise<Transaction[]> {
  const pendingTxn = await pageEvalAll(page, 'tr.rgRow', [], (trs) => {
    return trs.map((tr) => Array.from(tr.querySelectorAll('td'), (td: HTMLTableDataCellElement) => td.textContent || ''));
  });

  return pendingTxn.map((txn) => {
    const date = moment(txn[0], 'DD/MM/YY').toISOString();
    const amount = parseInt(txn[3], 10);
    return {
      type: TransactionTypes.Normal,
      date,
      processedDate: date,
      originalAmount: amount,
      originalCurrency: SHEKEL_CURRENCY,
      chargedAmount: amount,
      description: txn[1],
      status: TransactionStatuses.Pending,
    };
  });
}

async function postLogin(page: Page) {
  await Promise.race([
    waitUntilElementFound(page, afterLoginSelector),
    waitUntilElementFound(page, invalidPasswordSelector),
    waitForUrl(page, CHANGE_PASSWORD_URL),
  ]);
}

class MizrahiScraper extends BaseScraperWithBrowser {
  getLoginOptions(credentials: ScraperCredentials) {
    return {
      loginUrl: LOGIN_URL,
      fields: createLoginFields(credentials),
      submitButtonSelector,
      checkReadiness: async () => waitUntilElementDisappear(this.page, loginSpinnerSelector),
      postAction: async () => postLogin(this.page),
      possibleResults: getPossibleLoginResults(this.page),
    };
  }

  async fetchData() {
    await this.navigateTo(OSH_PAGE, this.page);
    const request = await this.page.waitForRequest(TRANSACTIONS_REQUEST_URL);
    const data = createDataFromRequest(request, this.options.startDate);
    const headers = createHeadersFromRequest(request);

    const response = await fetchPostWithinPage<ScrapedTransactionsResult>(this.page,
      TRANSACTIONS_REQUEST_URL, data, headers);

    if (!response || response.header.success === false) {
      return {
        success: false,
        errorType: ScraperErrorTypes.Generic,
        errorMessage:
          `Error fetching transaction. Response message: ${response ? response.header.messages[0].text : ''}`,
      };
    }

    const relevantRows = response.body.table.rows.filter((row) => row.RecTypeSpecified);
    const oshTxn = convertTransactions(relevantRows);

    // workaround for a bug which the bank's API returns transactions before the requested start date
    const startMoment = getStartMoment(this.options.startDate);
    const oshTxnAfterStartDate = oshTxn.filter((txn) => moment(txn.date).isSameOrAfter(startMoment));

    await this.navigateTo(PENDING_TRANSACTIONS_PAGE, this.page);
    const pendingTxn = await extractPendingTransactions(this.page);

    const allTxn = oshTxnAfterStartDate.concat(pendingTxn);

    return {
      success: true,
      accounts: [
        {
          accountNumber: response.body.fields.AccountNumber,
          txns: allTxn,
          balance: +response.body.fields.YitraLeloChekim,
        },
      ],
    };
  }
}

export default MizrahiScraper;
