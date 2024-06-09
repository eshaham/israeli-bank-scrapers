import _ from 'lodash';
import moment from 'moment';
import { Page } from 'puppeteer';
import { waitUntilElementFound } from '../helpers/elements-interactions';
import { fetchGetWithinPage } from '../helpers/fetch';
import { waitForNavigation } from '../helpers/navigation';
import {
  Transaction, TransactionStatuses, TransactionTypes,
} from '../transactions';
import { BaseScraperWithBrowser, LoginResults, PossibleLoginResults } from './base-scraper-with-browser';
import { ScraperErrorTypes } from './errors';
import { ScraperOptions, ScraperScrapingResult } from './interface';

const BASE_URL = 'https://start.telebank.co.il';
const DATE_FORMAT = 'YYYYMMDD';

interface ScrapedTransaction {
  OperationNumber: number;
  OperationDate: string;
  ValueDate: string;
  OperationAmount: number;
  OperationDescriptionToDisplay: string;
}

interface CurrentAccountInfo {
  AccountBalance: number;
}

interface ScrapedAccountData {
  UserAccountsData: {
    DefaultAccountNumber: string;
  };
}

interface ScrapedTransactionData {
  Error?: { MsgText: string };
  CurrentAccountLastTransactions?: {
    OperationEntry: ScrapedTransaction[];
    CurrentAccountInfo: CurrentAccountInfo;
    FutureTransactionsBlock:{
      FutureTransactionEntry: ScrapedTransaction[];
    };
  };
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

async function fetchAccountData(page: Page, options: ScraperOptions): Promise<ScraperScrapingResult> {
  const apiSiteUrl = `${BASE_URL}/Titan/gatewayAPI`;

  const accountDataUrl = `${apiSiteUrl}/userAccountsData`;
  const accountInfo = await fetchGetWithinPage<ScrapedAccountData>(page, accountDataUrl);

  if (!accountInfo) {
    return {
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: 'failed to get account data',
    };
  }
  const accountNumber = accountInfo.UserAccountsData.DefaultAccountNumber;

  const defaultStartMoment = moment().subtract(1, 'years').add(2, 'day');
  const startDate = options.startDate || defaultStartMoment.toDate();
  const startMoment = moment.max(defaultStartMoment, moment(startDate));

  const startDateStr = startMoment.format(DATE_FORMAT);
  const txnsUrl = `${apiSiteUrl}/lastTransactions/${accountNumber}/Date?IsCategoryDescCode=True&IsTransactionDetails=True&IsEventNames=True&IsFutureTransactionFlag=True&FromDate=${startDateStr}`;
  const txnsResult = await fetchGetWithinPage<ScrapedTransactionData>(page, txnsUrl);
  if (!txnsResult || txnsResult.Error ||
    !txnsResult.CurrentAccountLastTransactions) {
    return {
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: txnsResult && txnsResult.Error ? txnsResult.Error.MsgText : 'unknown error',
    };
  }

  const completedTxns = convertTransactions(
    txnsResult.CurrentAccountLastTransactions.OperationEntry,
    TransactionStatuses.Completed,
  );
  const rawFutureTxns = _.get(txnsResult, 'CurrentAccountLastTransactions.FutureTransactionsBlock.FutureTransactionEntry') as ScrapedTransaction[];
  const pendingTxns = convertTransactions(rawFutureTxns, TransactionStatuses.Pending);

  const accountData = {
    success: true,
    accounts: [{
      accountNumber,
      balance: txnsResult.CurrentAccountLastTransactions.CurrentAccountInfo.AccountBalance,
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
  urls[LoginResults.Success] = [`${BASE_URL}/apollo/retail/#/MY_ACCOUNT_HOMEPAGE`];
  urls[LoginResults.InvalidPassword] = [`${BASE_URL}/apollo/core/templates/lobby/masterPage.html#/LOGIN_PAGE`];
  urls[LoginResults.ChangePassword] = [`${BASE_URL}/apollo/core/templates/lobby/masterPage.html#/PWD_RENEW`];
  return urls;
}

function createLoginFields(credentials: ScraperSpecificCredentials) {
  return [
    { selector: '#tzId', value: credentials.id },
    { selector: '#tzPassword', value: credentials.password },
    { selector: '#aidnum', value: credentials.num },
  ];
}

type ScraperSpecificCredentials = { id: string, password: string, num: string };

class DiscountScraper extends BaseScraperWithBrowser<ScraperSpecificCredentials> {
  getLoginOptions(credentials: ScraperSpecificCredentials) {
    return {
      loginUrl: `${BASE_URL}/login/#/LOGIN_PAGE`,
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
