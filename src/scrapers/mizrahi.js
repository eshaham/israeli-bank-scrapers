import moment from 'moment';
import {
  SHEKEL_CURRENCY,
  NORMAL_TXN_TYPE,
  TRANSACTION_STATUS,
  ISO_DATE_FORMAT,
} from '../constants';
import { BaseScraperWithBrowser, LOGIN_RESULT } from './base-scraper-with-browser';
import { fetchPostWithinPage } from '../helpers/fetch';
import { waitForNavigation } from '../helpers/navigation';

const BASE_URL = 'https://www.mizrahi-tefahot.co.il';
const LOGIN_URL = `${BASE_URL}/he/bank/Pages/Default.aspx`;
const AFTER_LOGIN_BASE_URL = /https:\/\/mto\.mizrahi-tefahot\.co\.il\/ngOnline\/index\.html#\/main\/uis/;
const OSH_PAGE = 'https://mto.mizrahi-tefahot.co.il/ngOnline/index.html#/main/uis/osh/p428/';
const TRANSACTIONS_REQUEST_URL = 'https://mto.mizrahi-tefahot.co.il/Online/api/SkyOSH/get428Index';
const DATE_FORMAT = 'DD/MM/YYYY';

function createLoginFields(credentials) {
  return [
    { selector: '#ctl00_PlaceHolderLogin_ctl00_tbUserName', value: credentials.username },
    { selector: '#ctl00_PlaceHolderLogin_ctl00_tbPassword', value: credentials.password },
  ];
}

function getPossibleLoginResults() {
  const urls = {};
  urls[LOGIN_RESULT.SUCCESS] = [AFTER_LOGIN_BASE_URL];
  urls[LOGIN_RESULT.INVALID_PASSWORD] = [`${BASE_URL}/login/loginMTO.aspx`];
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
  data.table.maxRow = 9999999999;

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
    const txnDate = moment(row.MC02PeulaTaaEZ).format(ISO_DATE_FORMAT);

    // TODO: I don't have enough sample transactions to understand the rest of the data.
    return {
      type: NORMAL_TXN_TYPE, // can be either 'normal' or 'installments'
      // identifier: int, // only if exists
      date: txnDate, // ISO date string
      processedDate: txnDate, // ISO date string
      originalAmount: row.MC02SchumEZ,
      originalCurrency: SHEKEL_CURRENCY,
      chargedAmount: row.MC02SchumEZ,
      description: row.MC02TnuaTeurEZ,
      // installments: {
      //   number: int, // the current installment number
      //   total: int, // the total number of installments
      // },
      status: TRANSACTION_STATUS.COMPLETED, // can either be 'completed' or 'pending'
    };
  });
}

class MizrahiScraper extends BaseScraperWithBrowser {
  async sniffOshRequest() {
    await waitForNavigation(this.page);
    this.navigateTo(OSH_PAGE, this.page);
    this.request = await this.page.waitForRequest(TRANSACTIONS_REQUEST_URL);
  }

  getLoginOptions(credentials) {
    return {
      loginUrl: `${LOGIN_URL}`,
      fields: createLoginFields(credentials),
      submitButtonSelector: '#ctl00_PlaceHolderLogin_ctl00_Enter',
      postAction: async () => this.sniffOshRequest(),
      possibleResults: getPossibleLoginResults(),
    };
  }

  async fetchData() {
    const data = CreateDataFromRequest(this.request, this.options.startDate);
    const headers = createHeadersFromRequest(this.request);

    const response = await fetchPostWithinPage(this.page,
      TRANSACTIONS_REQUEST_URL, data, headers);

    if (response.header.success === false) {
      return {
        success: false,
        errorType: 'generic',
        errorMessage:
          `Error fetching transaction. Response message: "${response.header.messages[0].text}"`,
      };
    }

    return {
      success: true,
      accounts: [
        {
          accountNumber: response.body.fields.AccountNumber,
          txns: convertTransactions(response.body.table.rows.filter(row => row.RecTypeSpecified)),
        },
      ],
    };
  }
}

export default MizrahiScraper;
