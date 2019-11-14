import moment from 'moment';
import {
  SHEKEL_CURRENCY,
  NORMAL_TXN_TYPE,
  TRANSACTION_STATUS,
} from '../constants';
import { BaseScraperWithBrowser, LOGIN_RESULT } from './base-scraper-with-browser';
import { fetchPostWithinPage } from '../helpers/fetch';
import { waitForNavigation } from '../helpers/navigation';
import { pageEvalAll } from '../helpers/elements-interactions';

const BASE_WEBSITE_URL = 'https://www.mizrahi-tefahot.co.il';
const LOGIN_URL = `${BASE_WEBSITE_URL}/he/bank/Pages/Default.aspx`;
const BASE_APP_URL = 'https://mto.mizrahi-tefahot.co.il/';
const AFTER_LOGIN_BASE_URL = /https:\/\/mto\.mizrahi-tefahot\.co\.il\/ngOnline\/index\.html#\/main\/uis/;
const OSH_PAGE = `${BASE_APP_URL}ngOnline/index.html#/main/uis/osh/p428/`;
const TRANSACTIONS_REQUEST_URL = `${BASE_APP_URL}Online/api/SkyOSH/get428Index`;
const PENDING_TRANSACTIONS_PAGE = `${BASE_APP_URL}Online/Osh/p420.aspx`;
const DATE_FORMAT = 'DD/MM/YYYY';
const MAX_ROWS_PER_REQUEST = 10000000000;

function createLoginFields(credentials) {
  return [
    { selector: '#ctl00_PlaceHolderLogin_ctl00_tbUserName', value: credentials.username },
    { selector: '#ctl00_PlaceHolderLogin_ctl00_tbPassword', value: credentials.password },
  ];
}

function getPossibleLoginResults() {
  const urls = {};
  urls[LOGIN_RESULT.SUCCESS] = [AFTER_LOGIN_BASE_URL];
  urls[LOGIN_RESULT.INVALID_PASSWORD] = [`${BASE_WEBSITE_URL}/login/loginMTO.aspx`];
  urls[LOGIN_RESULT.CHANGE_PASSWORD] = [
    `${AFTER_LOGIN_BASE_URL}/main/uis/ge/changePassword/`,
  ];
  return urls;
}

function CreateDataFromRequest(request, optionsStartDate) {
  const defaultStartMoment = moment().subtract(1, 'years');
  const startDate = optionsStartDate || defaultStartMoment.toDate();
  const startMoment = moment.max(defaultStartMoment, moment(startDate));

  const data = JSON.parse(request.postData());

  data.inToDate = moment().format(DATE_FORMAT);
  data.inFromDate = startMoment.format(DATE_FORMAT);
  data.table.maxRow = MAX_ROWS_PER_REQUEST;

  return data;
}

function createHeadersFromRequest(request) {
  return {
    mizrahixsrftoken: request.headers().mizrahixsrftoken,
    'Content-Type': request.headers()['content-type'],
  };
}

function convertTransactions(txns) {
  return txns.map((row) => {
    const txnDate = moment(row.MC02PeulaTaaEZ, moment.HTML5_FMT.DATETIME_LOCAL_SECONDS)
      .toISOString();

    return {
      type: NORMAL_TXN_TYPE,
      identifier: row.MC02AsmahtaMekoritEZ ? parseInt(row.MC02AsmahtaMekoritEZ, 10) : null,
      date: txnDate,
      processedDate: txnDate,
      originalAmount: row.MC02SchumEZ,
      originalCurrency: SHEKEL_CURRENCY,
      chargedAmount: row.MC02SchumEZ,
      description: row.MC02TnuaTeurEZ,
      status: TRANSACTION_STATUS.COMPLETED,
    };
  });
}

async function extractPendingTransactions(page) {
  const pendingTxn = await pageEvalAll(page, 'tr.rgRow', [], (trs) => {
    return trs.map((tr) => Array.from(tr.querySelectorAll('td'), (td) => td.textContent));
  });

  return pendingTxn.map((txn) => {
    const date = moment(txn[0], 'DD/MM/YY').toISOString();
    const amount = parseInt(txn[3], 10);
    return {
      type: NORMAL_TXN_TYPE,
      identifier: null,
      date,
      processedDate: date,
      originalAmount: amount,
      originalCurrency: SHEKEL_CURRENCY,
      chargedAmount: amount,
      description: txn[1],
      status: TRANSACTION_STATUS.PENDING,
    };
  });
}

class MizrahiScraper extends BaseScraperWithBrowser {
  getLoginOptions(credentials) {
    return {
      loginUrl: `${LOGIN_URL}`,
      fields: createLoginFields(credentials),
      submitButtonSelector: '#ctl00_PlaceHolderLogin_ctl00_Enter',
      postAction: async () => waitForNavigation(this.page, { waitUntil: 'networkidle0' }),
      possibleResults: getPossibleLoginResults(),
    };
  }

  async fetchData() {
    await this.navigateTo(OSH_PAGE, this.page);
    const request = await this.page.waitForRequest(TRANSACTIONS_REQUEST_URL);
    const data = CreateDataFromRequest(request, this.options.startDate);
    const headers = createHeadersFromRequest(request);

    const response = await fetchPostWithinPage(this.page,
      TRANSACTIONS_REQUEST_URL, data, headers);

    if (response.header.success === false) {
      return {
        success: false,
        errorType: 'generic',
        errorMessage:
          `Error fetching transaction. Response message: ${response.header.messages[0].text}`,
      };
    }

    const relevantRows = response.body.table.rows.filter((row) => row.RecTypeSpecified);
    const oshTxn = convertTransactions(relevantRows);

    await this.navigateTo(PENDING_TRANSACTIONS_PAGE, this.page);
    const pendingTxn = await extractPendingTransactions(this.page);

    const allTxn = oshTxn.concat(pendingTxn);

    return {
      success: true,
      accounts: [
        {
          accountNumber: response.body.fields.AccountNumber,
          txns: allTxn,
        },
      ],
    };
  }
}

export default MizrahiScraper;
