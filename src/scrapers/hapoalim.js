import moment from 'moment';
import uuid4 from 'uuid/v4';

import { BaseScraperWithBrowser, LOGIN_RESULT } from './base-scraper-with-browser';
import { waitForRedirect } from '../helpers/navigation';
import waitUntil from '../helpers/waiting';
import { NORMAL_TXN_TYPE, TRANSACTION_STATUS } from '../constants';
import { fetchGetWithinPage, fetchPostWithinPage } from '../helpers/fetch';

const DATE_FORMAT = 'YYYYMMDD';

function convertTransactions(txns) {
  return txns.map((txn) => {
    const isOutbound = txn.eventActivityTypeCode === 2;

    let memo = null;
    if (txn.beneficiaryDetailsData) {
      const {
        partyHeadline,
        partyName,
        messageHeadline,
        messageDetail,
      } = txn.beneficiaryDetailsData;
      const memoLines = [];
      if (partyHeadline) {
        memoLines.push(partyHeadline);
      }

      if (partyName) {
        memoLines.push(`${partyName}.`);
      }

      if (messageHeadline) {
        memoLines.push(messageHeadline);
      }

      if (messageDetail) {
        memoLines.push(`${messageDetail}.`);
      }

      if (memoLines.length) {
        memo = memoLines.join(' ');
      }
    }

    return {
      type: NORMAL_TXN_TYPE,
      identifier: txn.referenceNumber,
      date: moment(txn.eventDate, DATE_FORMAT).toISOString(),
      processedDate: moment(txn.valueDate, DATE_FORMAT).toISOString(),
      originalAmount: isOutbound ? -txn.eventAmount : txn.eventAmount,
      originalCurrency: 'ILS',
      chargedAmount: isOutbound ? -txn.eventAmount : txn.eventAmount,
      description: txn.activityDescription,
      status: txn.serialNumber === 0 ? TRANSACTION_STATUS.PENDING : TRANSACTION_STATUS.COMPLETED,
      memo,
    };
  });
}

async function getRestContext(page) {
  await waitUntil(async () => {
    return page.evaluate(() => !!window.bnhpApp);
  }, 'waiting for app data load');

  const result = await page.evaluate(() => {
    return window.bnhpApp.restContext;
  });

  return result.slice(1);
}

async function fetchPoalimXSRFWithinPage(page, url, pageUuid) {
  const cookies = await page.cookies();
  const XSRFCookie = cookies.find((cookie) => cookie.name === 'XSRF-TOKEN');
  const headers = {};
  if (XSRFCookie != null) {
    headers['X-XSRF-TOKEN'] = XSRFCookie.value;
  }
  headers.pageUuid = pageUuid;
  headers.uuid = uuid4();
  headers['Content-Type'] = 'application/json;charset=UTF-8';
  return fetchPostWithinPage(page, url, [], headers);
}

function createLoginFields(credentials) {
  return [
    { selector: '#userID', value: credentials.userCode },
    { selector: '#userPassword', value: credentials.password },
  ];
}

class HapoalimScraper extends BaseScraperWithBrowser {
  // eslint-disable-next-line class-methods-use-this
  get baseUrl() {
    return 'https://login.bankhapoalim.co.il';
  }

  // eslint-disable-next-line class-methods-use-this
  get portalUrl() {
    return 'rb';
  }

  getLoginOptions(credentials) {
    return {
      loginUrl: `${this.baseUrl}/cgi-bin/poalwwwc?reqName=getLogonPage`,
      fields: createLoginFields(credentials),
      submitButtonSelector: '#inputSend',
      postAction: async () => waitForRedirect(this.page),
      possibleResults: this.getPossibleLoginResults(),
    };
  }

  async fetchData() {
    return this.fetchAccountData(this.page, this.options, (msg) => this.notify(msg));
  }

  async fetchAccountData(page, options) {
    const restContext = await getRestContext(page);
    const apiSiteUrl = `${this.baseUrl}/${restContext}`;
    const accountDataUrl = `${this.baseUrl}/ServerServices/general/accounts`;
    const accountsInfo = await fetchGetWithinPage(page, accountDataUrl);

    const defaultStartMoment = moment().subtract(1, 'years').add(1, 'day');
    const startDate = options.startDate || defaultStartMoment.toDate();
    const startMoment = moment.max(defaultStartMoment, moment(startDate));

    const startDateStr = startMoment.format(DATE_FORMAT);
    const endDateStr = moment().format(DATE_FORMAT);

    const accounts = [];
    for (let accountIndex = 0; accountIndex < accountsInfo.length; accountIndex += 1) {
      const account = accountsInfo[accountIndex];
      const accountNumber = `${account.bankNumber}-${account.branchNumber}-${account.accountNumber}`;

      const txnsUrl = `${apiSiteUrl}/current-account/transactions?accountId=${accountNumber}&numItemsPerPage=150&retrievalEndDate=${endDateStr}&retrievalStartDate=${startDateStr}&sortCode=1`;

      const txnsResult = await fetchPoalimXSRFWithinPage(page, txnsUrl, '/current-account/transactions');
      let txns = [];
      if (txnsResult) {
        txns = convertTransactions(txnsResult.transactions);
      }

      accounts.push({
        accountNumber,
        txns,
      });
    }

    const accountData = {
      success: true,
      accounts,
    };

    return accountData;
  }


  // eslint-disable-next-line class-methods-use-this
  getPossibleLoginResults() {
    const urls = {};
    urls[LOGIN_RESULT.SUCCESS] = [
      `${this.baseUrl}/portalserver/HomePage`,
      `${this.baseUrl}/ng-portals-bt/${this.portalUrl}/he/homepage`,
      `${this.baseUrl}/ng-portals/${this.portalUrl}/he/homepage`];
    urls[LOGIN_RESULT.INVALID_PASSWORD] = [`${this.baseUrl}/AUTHENTICATE/LOGON?flow=AUTHENTICATE&state=LOGON&errorcode=1.6&callme=false`];
    urls[LOGIN_RESULT.CHANGE_PASSWORD] = [
      `${this.baseUrl}/MCP/START?flow=MCP&state=START&expiredDate=null`,
      /\/ABOUTTOEXPIRE\/START/i,
    ];
    return urls;
  }
}

export default HapoalimScraper;
