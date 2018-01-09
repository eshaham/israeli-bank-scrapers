import moment from 'moment';

import { BaseScraper, LOGIN_RESULT } from './base-scraper';
import { waitForRedirect } from '../helpers/navigation';
import { fetchGet } from '../helpers/fetch';
import { NORMAL_TXN_TYPE } from '../constants';

const BASE_URL = 'https://login.bankhapoalim.co.il';
const DATE_FORMAT = 'YYYYMMDD';

function convertTransactions(txns) {
  return txns.map((txn) => {
    return {
      type: NORMAL_TXN_TYPE,
      identifier: txn.referenceNumber,
      date: moment(txn.eventDate, DATE_FORMAT).toDate(),
      processedDate: moment(txn.valueDate, DATE_FORMAT).toDate(),
      originalAmount: txn.eventAmount,
      originalCurrency: 'ILS',
      chargedAmount: txn.eventAmount,
      description: txn.englishActionDesc,
    };
  });
}

async function fetchAccountData(page, options) {
  const apiSiteUrl = `${BASE_URL}/ServerServices`;

  const accountDataUrl = `${apiSiteUrl}/general/accounts`;
  const accountInfo = await fetchGet(page, accountDataUrl);
  const accountNumber = `${accountInfo[0].bankNumber}-${accountInfo[0].branchNumber}-${accountInfo[0].accountNumber}`;

  const defaultStartMoment = moment().subtract(1, 'years').add(1, 'day');
  const startDate = options.startDate || defaultStartMoment.toDate();
  const startMoment = moment.max(defaultStartMoment, moment(startDate));

  const startDateStr = startMoment.format(DATE_FORMAT);
  const endDateStr = moment().format(DATE_FORMAT);
  const txnsUrl = `${apiSiteUrl}/current-account/transactions?accountId=${accountNumber}&numItemsPerPage=150&retrievalEndDate=${endDateStr}&retrievalStartDate=${startDateStr}&sortCode=1`;

  const txnsResult = await fetchGet(page, txnsUrl);

  if (txnsResult.Error) {
    return {
      success: false,
      errorType: 'generic',
      errorMessage: txnsResult.Error.MsgText,
    };
  }
  const txns = convertTransactions(txnsResult.transactions);

  const accountData = {
    success: true,
    accounts: [{
      accountNumber,
      txns,
    }],
  };

  return accountData;
}

function getPossibleLoginResults() {
  const urls = {};
  urls[LOGIN_RESULT.SUCCESS] = `${BASE_URL}/portalserver/HomePage`;
  urls[LOGIN_RESULT.INVALID_PASSWORD] = `${BASE_URL}/AUTHENTICATE/LOGON?flow=AUTHENTICATE&state=LOGON&errorcode=1.6&callme=false`;
  urls[LOGIN_RESULT.CHANGE_PASSWORD] = `${BASE_URL}/portalserver/HomePage`;
  return urls;
}

function createLoginFields(credentials) {
  return [
    { id: 'userID', value: credentials.id },
    { id: 'userPassword', value: credentials.password },
  ];
}

class HapoalimScraper extends BaseScraper {
  getLoginOptions(credentials) {
    return {
      loginUrl: `${BASE_URL}/cgi-bin/poalwwwc?reqName=getLogonPage`,
      fields: createLoginFields(credentials),
      submitButtonId: 'inputSend',
      postAction: async () => waitForRedirect(this.page),
      possibleResults: getPossibleLoginResults(),
    };
  }

  async fetchData() {
    return fetchAccountData(this.page, this.options, msg => this.notify(msg));
  }
}

export default HapoalimScraper;
