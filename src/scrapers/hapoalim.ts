import moment from 'moment';
import { Page } from 'puppeteer';
import { v4 as uuid4 } from 'uuid';
import { getDebug } from '../helpers/debug';
import { fetchGetWithinPage, fetchPostWithinPage } from '../helpers/fetch';
import { waitForRedirect } from '../helpers/navigation';
import { waitUntil } from '../helpers/waiting';
import {
  Transaction, TransactionStatuses, TransactionTypes,
  TransactionsAccount,
} from '../transactions';
import { BaseScraperWithBrowser, LoginResults, PossibleLoginResults } from './base-scraper-with-browser';
import { ScraperOptions } from './interface';

const debug = getDebug('hapoalim');

const DATE_FORMAT = 'YYYYMMDD';

// eslint-disable-next-line @typescript-eslint/no-namespace
declare namespace window {
  const bnhpApp: any;
}

interface ScrapedTransaction {
  serialNumber?: number;
  activityDescription?: string;
  eventAmount: number;
  valueDate?: string;
  eventDate?: string;
  referenceNumber?: number;
  ScrapedTransaction?: string;
  eventActivityTypeCode: number;
  currentBalance: number;
  pfmDetails: string;
  beneficiaryDetailsData?: {
    partyHeadline?: string;
    partyName?: string;
    messageHeadline?: string;
    messageDetail?: string;
  };
}

interface ScrapedPfmTransaction {
  transactionNumber: number;
}

type FetchedAccountData = {
  bankNumber: string;
  accountNumber: string;
  branchNumber: string;
  accountClosingReasonCode: number;
}[];

type FetchedAccountTransactionsData = {
  transactions: ScrapedTransaction[];
};

type BalanceAndCreditLimit = {
  creditLimitAmount: number;
  creditLimitDescription: string;
  creditLimitUtilizationAmount: number;
  creditLimitUtilizationExistanceCode: number;
  creditLimitUtilizationPercent: number;
  currentAccountLimitsAmount: number;
  currentBalance: number;
  withdrawalBalance: number;
};

function convertTransactions(txns: ScrapedTransaction[]): Transaction[] {
  return txns.map((txn) => {
    const isOutbound = txn.eventActivityTypeCode === 2;

    let memo = '';
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
  await waitUntil(() => {
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

async function getExtraScrap(txnsResult: FetchedAccountTransactionsData, baseUrl: string, page: Page, accountNumber: string): Promise<FetchedAccountTransactionsData> {
  const promises = txnsResult.transactions.map(async (transaction: ScrapedTransaction): Promise<ScrapedTransaction> => {
    const { pfmDetails, serialNumber } = transaction;
    if (serialNumber !== 0) {
      const url = `${baseUrl}${pfmDetails}&accountId=${accountNumber}&lang=he`;
      const extraTransactionDetails = await fetchGetWithinPage<ScrapedPfmTransaction[]>(page, url) || [];
      if (extraTransactionDetails && extraTransactionDetails.length) {
        const { transactionNumber } = extraTransactionDetails[0];
        if (transactionNumber) {
          return { ...transaction, referenceNumber: transactionNumber };
        }
      }
    }
    return transaction;
  });
  const res = await Promise.all(promises);
  return { transactions: res };
}

async function getAccountTransactions(baseUrl: string, apiSiteUrl: string, page: Page, accountNumber: string, startDate: string, endDate: string, additionalTransactionInformation = false) {
  const txnsUrl = `${apiSiteUrl}/current-account/transactions?accountId=${accountNumber}&numItemsPerPage=1000&retrievalEndDate=${endDate}&retrievalStartDate=${startDate}&sortCode=1`;
  const txnsResult = await fetchPoalimXSRFWithinPage(page, txnsUrl, '/current-account/transactions');

  const finalResult =
    additionalTransactionInformation && txnsResult?.transactions.length ?
      await getExtraScrap(txnsResult, baseUrl, page, accountNumber) :
      txnsResult;

  return convertTransactions(finalResult?.transactions ?? []);
}

async function getAccountBalance(apiSiteUrl: string, page: Page, accountNumber: string) {
  const balanceAndCreditLimitUrl = `${apiSiteUrl}/current-account/composite/balanceAndCreditLimit?accountId=${accountNumber}&view=details&lang=he`;
  const balanceAndCreditLimit = await fetchGetWithinPage<BalanceAndCreditLimit>(page, balanceAndCreditLimitUrl);

  return balanceAndCreditLimit?.currentBalance;
}

async function fetchAccountData(page: Page, baseUrl: string, options: ScraperOptions) {
  const restContext = await getRestContext(page);
  const apiSiteUrl = `${baseUrl}/${restContext}`;
  const accountDataUrl = `${baseUrl}/ServerServices/general/accounts`;

  debug('fetching accounts data');
  const accountsInfo = await fetchGetWithinPage<FetchedAccountData>(page, accountDataUrl) || [];
  debug('got %d accounts, fetching txns and balance', accountsInfo.length);

  const defaultStartMoment = moment().subtract(1, 'years').add(1, 'day');
  const startDate = options.startDate || defaultStartMoment.toDate();
  const startMoment = moment.max(defaultStartMoment, moment(startDate));
  const { additionalTransactionInformation } = options;

  const startDateStr = startMoment.format(DATE_FORMAT);
  const endDateStr = moment().format(DATE_FORMAT);

  const accounts: TransactionsAccount[] = [];

  for (const account of accountsInfo) {
    let balance: number | undefined;
    const accountNumber = `${account.bankNumber}-${account.branchNumber}-${account.accountNumber}`;

    const isActiveAccount = account.accountClosingReasonCode === 0;
    if (isActiveAccount) {
      balance = await getAccountBalance(apiSiteUrl, page, accountNumber);
    } else {
      debug('Skipping balance for a closed account, balance will be undefined');
    }

    const txns = await getAccountTransactions(
      baseUrl,
      apiSiteUrl,
      page,
      accountNumber,
      startDateStr,
      endDateStr,
      additionalTransactionInformation,
    );

    accounts.push({
      accountNumber,
      balance,
      txns,
    });
  }

  const accountData = {
    success: true,
    accounts,
  };
  debug('fetching ended');
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

function createLoginFields(credentials: ScraperSpecificCredentials) {
  return [
    { selector: '#userCode', value: credentials.userCode },
    { selector: '#password', value: credentials.password },
  ];
}

type ScraperSpecificCredentials = { userCode: string, password: string };

class HapoalimScraper extends BaseScraperWithBrowser<ScraperSpecificCredentials> {
  // eslint-disable-next-line class-methods-use-this
  get baseUrl() {
    return 'https://login.bankhapoalim.co.il';
  }

  getLoginOptions(credentials: ScraperSpecificCredentials) {
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
