import moment from 'moment';
import { BaseScraperWithBrowser, LOGIN_RESULT } from './base-scraper-with-browser';
import { fetchPostWithinPage } from '../helpers/fetch';

const BASE_URL = 'https://www.mizrahi-tefahot.co.il';
const LOGIN_URL = `${BASE_URL}/he/bank/Pages/Default.aspx`;
const AFTER_LOGIN_BASE_URL = 'https://mto.mizrahi-tefahot.co.il/ngOnline/index.html#/main/uis/osh/p428/';
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
  urls[LOGIN_RESULT.SUCCESS] = [`${AFTER_LOGIN_BASE_URL}`];
  urls[LOGIN_RESULT.INVALID_PASSWORD] = [`${BASE_URL}/login/loginMTO.aspx`];
  urls[LOGIN_RESULT.CHANGE_PASSWORD] = [
    `${AFTER_LOGIN_BASE_URL}/main/uis/ge/changePassword/`,
  ];
  return urls;
}

class MizrahiScraper extends BaseScraperWithBrowser {
  getLoginOptions(credentials) {
    return {
      loginUrl: `${LOGIN_URL}`,
      fields: createLoginFields(credentials),
      submitButtonSelector: '#ctl00_PlaceHolderLogin_ctl00_Enter',
      postAction: async () => {
        this.request = await this.page.waitForRequest(TRANSACTIONS_REQUEST_URL);
      },
      possibleResults: getPossibleLoginResults(),
    };
  }

  async fetchData() {
    console.debug('Starting fetch Data - Mizrahi');
    const defaultStartMoment = moment().subtract(1, 'years').add(1, 'day');
    const startDate = this.options.startDate || defaultStartMoment.toDate();
    const startMoment = moment.max(defaultStartMoment, moment(startDate));

    const data = JSON.parse(this.request.postData());
    data.inToDate = moment().format(DATE_FORMAT);
    data.inFromDate = startMoment.format(DATE_FORMAT);

    const headersToSend = {
      mizrahixsrftoken: this.request.headers().mizrahixsrftoken,
      'Content-Type': this.request.headers()['content-type'],
    };

    const response = await fetchPostWithinPage(this.page,
      TRANSACTIONS_REQUEST_URL, data, headersToSend);

    const accounts = response;

    return {
      success: true,
      accounts,
    };
  }
}

export default MizrahiScraper;
