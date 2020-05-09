import moment from 'moment';
import uuid4 from 'uuid/v4';

import { Page } from 'puppeteer';
import { BaseScraperWithBrowser, LoginResults, PossibleLoginResults } from './base-scraper-with-browser';
import { waitForRedirect } from '../helpers/navigation';
import { waitUntil } from '../helpers/waiting';
import { fetchGetWithinPage, fetchPostWithinPage } from '../helpers/fetch';
import {
  ScraperAccount, Transaction, TransactionStatuses, TransactionTypes,
} from '../types';
import { BaseScraperOptions, ScraperCredentials } from './base-scraper';

const DATE_FORMAT = 'YYYYMMDD';

declare module window {
  const bnhpApp: any;
}

interface ScrapedTransaction {
  serialNumber?: number,
  activityDescription?: string,
  eventAmount: number,
  valueDate?: string,
  eventDate?: string,
  referenceNumber?: number,
  ScrapedTransaction?: string,
  eventActivityTypeCode: number,
  beneficiaryDetailsData?: {
    partyHeadline?: string,
    partyName?: string,
    messageHeadline?: string,
    messageDetail?: string,
  }
}

type FetchedAccountData = {
  bankNumber: string,
  accountNumber: string,
  branchNumber: string
}[];

type FetchedAccountTransactionsData = {
  transactions: ScrapedTransaction[]
};

function convertTransactions(txns: ScrapedTransaction[]): Transaction[] {
  return txns.map((txn) => {
    const isOutbound = txn.eventActivityTypeCode === 2;

    let memo: string = '';
    if (txn.beneficiaryDetailsData) {
      const {
        partyHeadline,
        partyName,
        messageHeadline,
        messageDetail,
      } = txn.beneficiaryDetailsData;
      const memoLines: string[] = [];
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

    const result: Transaction = {
      type: TransactionTypes.Normal,
      identifier: txn.referenceNumber,
      date: moment(txn.eventDate, DATE_FORMAT).toISOString(),
      processedDate: moment(txn.valueDate, DATE_FORMAT).toISOString(),
      originalAmount: isOutbound ? -txn.eventAmount : txn.eventAmount,
      originalCurrency: 'ILS',
      chargedAmount: isOutbound ? -txn.eventAmount : txn.eventAmount,
      description: txn.activityDescription || '',
      status: txn.serialNumber === 0 ? TransactionStatuses.Pending : TransactionStatuses.Completed,
      memo,
    };

    return result;
  });
}

async function getRestContext(page: Page) {
  await waitUntil(async () => {
    return page.evaluate(() => !!window.bnhpApp);
  }, 'waiting for app data load');

  const result = await page.evaluate(() => {
    return window.bnhpApp.restContext;
  });

  return result.slice(1);
}

async function fetchPoalimXSRFWithinPage(page: Page, url: string, pageUuid: string): Promise<FetchedAccountTransactionsData | null> {
  const cookies = await page.cookies();
  const XSRFCookie = cookies.find((cookie) => cookie.name === 'XSRF-TOKEN');
  const headers: Record<string, any> = {};
  if (XSRFCookie != null) {
    headers['X-XSRF-TOKEN'] = XSRFCookie.value;
  }
  headers.pageUuid = pageUuid;
  headers.uuid = uuid4();
  headers['Content-Type'] = 'application/json;charset=UTF-8';
  return fetchPostWithinPage<FetchedAccountTransactionsData>(page, url, [], headers);
}

async function fetchAccountData(page: Page, baseUrl: string, options: BaseScraperOptions) {
  const restContext = await getRestContext(page);
  const apiSiteUrl = `${baseUrl}/${restContext}`;
  const accountDataUrl = `${baseUrl}/ServerServices/general/accounts`;
  const accountsInfo = await fetchGetWithinPage<FetchedAccountData>(page, accountDataUrl) || [];

  const defaultStartMoment = moment().subtract(1, 'years').add(1, 'day');
  const startDate = options.startDate || defaultStartMoment.toDate();
  const startMoment = moment.max(defaultStartMoment, moment(startDate));

  const startDateStr = startMoment.format(DATE_FORMAT);
  const endDateStr = moment().format(DATE_FORMAT);

  const accounts: ScraperAccount[] = [];
  for (let accountIndex = 0; accountIndex < accountsInfo.length; accountIndex += 1) {
    const accountNumber = `${accountsInfo[accountIndex].bankNumber}-${accountsInfo[accountIndex].branchNumber}-${accountsInfo[accountIndex].accountNumber}`;

    const txnsUrl = `${apiSiteUrl}/current-account/transactions?accountId=${accountNumber}&numItemsPerPage=150&retrievalEndDate=${endDateStr}&retrievalStartDate=${startDateStr}&sortCode=1`;

    const txnsResult = await fetchPoalimXSRFWithinPage(page, txnsUrl, '/current-account/transactions');
    let txns: Transaction[] = [];
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

function getPossibleLoginResults(baseUrl: string) {
  const urls: PossibleLoginResults = {};
  urls[LoginResults.Success] = [
    `${baseUrl}/portalserver/HomePage`,
    `${baseUrl}/ng-portals-bt/rb/he/homepage`,
    `${baseUrl}/ng-portals/rb/he/homepage`];
  urls[LoginResults.InvalidPassword] = [`${baseUrl}/AUTHENTICATE/LOGON?flow=AUTHENTICATE&state=LOGON&errorcode=1.6&callme=false`];
  urls[LoginResults.ChangePassword] = [
    `${baseUrl}/MCP/START?flow=MCP&state=START&expiredDate=null`,
    /\/ABOUTTOEXPIRE\/START/i,
  ];
  return urls;
}

function createLoginFields(credentials: ScraperCredentials) {
  return [
    { selector: '#userCode', value: credentials.userCode },
    { selector: '#password', value: credentials.password },
  ];
}

class HapoalimScraper extends BaseScraperWithBrowser {
  // eslint-disable-next-line class-methods-use-this
  get baseUrl() {
    return 'https://login.bankhapoalim.co.il';
  }

  getLoginOptions(credentials: ScraperCredentials) {
    return {
      loginUrl: `${this.baseUrl}/cgi-bin/poalwwwc?reqName=getLogonPage`,
      fields: createLoginFields(credentials),
      submitButtonSelector: '.login-btn',
      postAction: async () => waitForRedirect(this.page),
      possibleResults: getPossibleLoginResults(this.baseUrl),
    };
  }

  async fetchData() {
    return fetchAccountData(this.page, this.baseUrl, this.options);
  }
}

export default HapoalimScraper;
