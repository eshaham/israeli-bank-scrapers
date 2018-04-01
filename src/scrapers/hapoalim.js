import moment from 'moment';

import { BaseScraperWithBrowser, LOGIN_RESULT } from './base-scraper-with-browser';
import { waitForRedirect, getCurrentUrl } from '../helpers/navigation';
import { NORMAL_TXN_TYPE } from '../constants';
import { fetchGetWithinPage } from '../helpers/fetch';

const BASE_URL = 'https://login.bankhapoalim.co.il';
const DATE_FORMAT = 'YYYYMMDD';

function convertTransactions(txns) {
  return txns.map((txn) => {
    const isOutbound = txn.eventActivityTypeCode === 2;
    return {
      type: NORMAL_TXN_TYPE,
      identifier: txn.referenceNumber,
      date: moment(txn.eventDate, DATE_FORMAT).toISOString(),
      processedDate: moment(txn.valueDate, DATE_FORMAT).toISOString(),
      originalAmount: isOutbound ? -txn.eventAmount : txn.eventAmount,
      originalCurrency: 'ILS',
      chargedAmount: isOutbound ? -txn.eventAmount : txn.eventAmount,
      description: txn.activityDescription,
    };
  });
}

function fetchSummary(balanceCreditResult) {
  return {
    balance: parseFloat(parseFloat(balanceCreditResult.currentBalance).toFixed(2)),
    creditLimit: parseFloat(parseFloat(balanceCreditResult.currentAccountLimitsAmount).toFixed(2)),
    creditUtilization: parseFloat(parseFloat(balanceCreditResult.withdrawalBalance).toFixed(2)),
    balanceCurrency: 'ILS',
  };
}

async function fetchAccountData(page, options) {
  const currentUrl = await getCurrentUrl(page, true);
  const subfolder = (currentUrl.includes('portalserver')) ? 'portalserver' : 'ssb';
  const apiSiteUrl = `${BASE_URL}/${subfolder}`;
  const accountDataUrl = `${BASE_URL}/ServerServices/general/accounts`;
  const accountsInfo = await fetchGetWithinPage(page, accountDataUrl);

  const defaultStartMoment = moment().subtract(1, 'years').add(1, 'day');
  const startDate = options.startDate || defaultStartMoment.toDate();
  const startMoment = moment.max(defaultStartMoment, moment(startDate));

  const startDateStr = startMoment.format(DATE_FORMAT);
  const endDateStr = moment().format(DATE_FORMAT);

  const accounts = [];
  for (let accountIndex = 0; accountIndex < accountsInfo.length; accountIndex += 1) {
    const accountNumber = `${accountsInfo[accountIndex].bankNumber}-${accountsInfo[accountIndex].branchNumber}-${accountsInfo[accountIndex].accountNumber}`;

    const balanceCreditUrl = `${apiSiteUrl}/current-account/composite/balanceAndCreditLimit?accountId=${accountNumber}&view=details`;
    let summary;
    try {
      const balanceCreditResult = await fetchGetWithinPage(page, balanceCreditUrl);
      summary = fetchSummary(balanceCreditResult);
    } catch (e) {
      summary = {};
    }

    const txnsUrl = `${apiSiteUrl}/current-account/transactions?accountId=${accountNumber}&numItemsPerPage=150&retrievalEndDate=${endDateStr}&retrievalStartDate=${startDateStr}&sortCode=1`;
    let txns;
    try {
      const txnsResult = await fetchGetWithinPage(page, txnsUrl);
      txns = convertTransactions(txnsResult.transactions);
    } catch (err) {
      txns = [];
    }

    accounts.push({
      accountNumber,
      summary,
      txns,
    });
  }

  const accountData = {
    success: true,
    accounts,
  };

  return accountData;
}

function getPossibleLoginResults() {
  const urls = {};
  urls[LOGIN_RESULT.SUCCESS] = [`${BASE_URL}/portalserver/HomePage`, `${BASE_URL}/ng-portals-bt/rb/he/homepage`];
  urls[LOGIN_RESULT.INVALID_PASSWORD] = [`${BASE_URL}/AUTHENTICATE/LOGON?flow=AUTHENTICATE&state=LOGON&errorcode=1.6&callme=false`];
  urls[LOGIN_RESULT.CHANGE_PASSWORD] = [`${BASE_URL}/MCP/START?flow=MCP&state=START&expiredDate=null`];
  return urls;
}

function createLoginFields(credentials) {
  return [
    { selector: '#userID', value: credentials.userCode },
    { selector: '#userPassword', value: credentials.password },
  ];
}

class HapoalimScraper extends BaseScraperWithBrowser {
  getLoginOptions(credentials) {
    return {
      loginUrl: `${BASE_URL}/cgi-bin/poalwwwc?reqName=getLogonPage`,
      fields: createLoginFields(credentials),
      submitButtonSelector: '#inputSend',
      postAction: async () => waitForRedirect(this.page),
      possibleResults: getPossibleLoginResults(),
    };
  }

  async fetchData() {
    return fetchAccountData(this.page, this.options, msg => this.notify(msg));
  }
}

export default HapoalimScraper;
