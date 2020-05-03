import _ from 'lodash';
import moment from 'moment';

import { Page } from 'puppeteer';
import { BaseScraperWithBrowser, LoginResults, PossibleLoginResults } from './base-scraper-with-browser';
import { waitUntilElementFound } from '../helpers/elements-interactions';
import { waitForNavigation } from '../helpers/navigation';
import { fetchGetWithinPage } from '../helpers/fetch';
import {
  ErrorTypes, LegacyScrapingResult,
  Transaction, TransactionStatuses, TransactionTypes,
} from '../types';
import { BaseScraperOptions, ScraperCredentials } from './base-scraper';

const BASE_URL = 'https://start.telebank.co.il';
const DATE_FORMAT = 'YYYYMMDD';

interface ScrapedTransaction {
  OperationNumber: number,
  OperationDate: string,
  ValueDate: string,
  OperationAmount: number,
  OperationDescriptionToDisplay: string
}

interface FetchedAccountData {
  UserAccountsData: {
    DefaultAccountNumber: string
  }
}

interface FetchedTransactions {
  Error?: { MsgText: string },
  CurrentAccountLastTransactions?: {
    OperationEntry: ScrapedTransaction[]
  }
}

function convertTransactions(txns: ScrapedTransaction[], txnStatus: TransactionStatuses): Transaction[] {
  if (!txns) {
    return [];
  }
  return txns.map((txn) => {
    return {
      type: TransactionTypes.Normal,
      identifier: txn.OperationNumber,
      date: moment(txn.OperationDate, DATE_FORMAT).toISOString(),
      processedDate: moment(txn.ValueDate, DATE_FORMAT).toISOString(),
      originalAmount: txn.OperationAmount,
      originalCurrency: 'ILS',
      chargedAmount: txn.OperationAmount,
      description: txn.OperationDescriptionToDisplay,
      status: txnStatus,
    };
  });
}


async function fetchAccountData(page: Page, options: BaseScraperOptions): Promise<LegacyScrapingResult> {
  const apiSiteUrl = `${BASE_URL}/Titan/gatewayAPI`;

  const accountDataUrl = `${apiSiteUrl}/userAccountsData`;
  const accountInfo = await fetchGetWithinPage<FetchedAccountData>(page, accountDataUrl);

  if (!accountInfo) {
    return {
      success: false,
      errorType: ErrorTypes.Generic,
      errorMessage: 'failed to get account data',
    };
  }
  const accountNumber = accountInfo.UserAccountsData.DefaultAccountNumber;

  const defaultStartMoment = moment().subtract(1, 'years').add(1, 'day');
  const startDate = options.startDate || defaultStartMoment.toDate();
  const startMoment = moment.max(defaultStartMoment, moment(startDate));

  const startDateStr = startMoment.format(DATE_FORMAT);
  const txnsUrl = `${apiSiteUrl}/lastTransactions/${accountNumber}/Date?IsCategoryDescCode=True&IsTransactionDetails=True&IsEventNames=True&IsFutureTransactionFlag=True&FromDate=${startDateStr}`;
  const txnsResult = await fetchGetWithinPage<FetchedTransactions>(page, txnsUrl);
  if (!txnsResult || txnsResult.Error ||
    !txnsResult.CurrentAccountLastTransactions) {
    return {
      success: false,
      errorType: ErrorTypes.Generic,
      errorMessage: txnsResult && txnsResult.Error ? txnsResult.Error.MsgText : 'unknown error',
    };
  }

  const completedTxns = convertTransactions(
    txnsResult.CurrentAccountLastTransactions.OperationEntry,
    TransactionStatuses.Completed,
  );
  const rawFutureTxns = _.get(txnsResult, 'CurrentAccountLastTransactions.FutureTransactionsBlock.FutureTransactionEntry');
  const pendingTxns = convertTransactions(rawFutureTxns, TransactionStatuses.Pending);

  const accountData = {
    success: true,
    accounts: [{
      accountNumber,
      txns: [...completedTxns, ...pendingTxns],
    }],
  };

  return accountData;
}

async function navigateOrErrorLabel(page: Page) {
  try {
    await waitForNavigation(page);
  } catch (e) {
    await waitUntilElementFound(page, '#general-error', false, 100);
  }
}

function getPossibleLoginResults(): PossibleLoginResults {
  const urls: PossibleLoginResults = {};
  urls[LoginResults.Success] = [`${BASE_URL}/apollo/core/templates/RETAIL/masterPage.html#/MY_ACCOUNT_HOMEPAGE`];
  urls[LoginResults.InvalidPassword] = [`${BASE_URL}/apollo/core/templates/lobby/masterPage.html#/LOGIN_PAGE`];
  urls[LoginResults.ChangePassword] = [`${BASE_URL}/apollo/core/templates/lobby/masterPage.html#/PWD_RENEW`];
  return urls;
}

function createLoginFields(credentials: ScraperCredentials) {
  return [
    { selector: '#tzId', value: credentials.id },
    { selector: '#tzPassword', value: credentials.password },
    { selector: '#aidnum', value: credentials.num },
  ];
}

class DiscountScraper extends BaseScraperWithBrowser {
  getLoginOptions(credentials: ScraperCredentials) {
    return {
      loginUrl: `${BASE_URL}/apollo/core/templates/lobby/masterPage.html#/LOGIN_PAGE`,
      checkReadiness: async () => waitUntilElementFound(this.page, '#tzId'),
      fields: createLoginFields(credentials),
      submitButtonSelector: '.sendBtn',
      postAction: async () => navigateOrErrorLabel(this.page),
      possibleResults: getPossibleLoginResults(),
    };
  }

  async fetchData() {
    return fetchAccountData(this.page, this.options);
  }
}

export default DiscountScraper;
