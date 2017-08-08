import moment from 'moment';

import BaseScraper from './base-scraper';
import ScraperNotifier from '../helpers/notifier';
import { login as performLogin, LOGIN_RESULT } from '../helpers/login';
import { waitForRedirect } from '../helpers/navigation';
import fetch from '../helpers/fetch';
import includeJQuery from '../helpers/imported-libs';

const BASE_URL = 'https://start.telebank.co.il';
const DATE_FORMAT = 'YYYYMMDD';

const notifier = new ScraperNotifier('discount');

function convertTransactions(txns) {
  return txns.map((txn) => {
    return {
      identifier: txn.OperationNumber,
      date: moment(txn.OperationDate, DATE_FORMAT).toDate(),
      processedDate: moment(txn.ValueDate, DATE_FORMAT).toDate(),
      amount: txn.OperationAmount,
      description: txn.OperationDescriptionToDisplay,
    };
  });
}

async function fetchAccountData(page, options) {
  await includeJQuery(page);

  const apiSiteUrl = `${BASE_URL}/Titan/gatewayAPI`;

  const accountDataUrl = `${apiSiteUrl}/userAccountsData`;
  const accountInfo = await fetch(page, accountDataUrl);
  const accountNumber = accountInfo.UserAccountsData.DefaultAccountNumber;

  notifier.notify(options, `found account number ${accountNumber}`);

  const defaultStartMoment = moment().subtract(1, 'years').add(1, 'day');
  const startDate = options.startDate || defaultStartMoment.toDate();
  const startMoment = moment.max(defaultStartMoment, moment(startDate));

  const startDateStr = startMoment.format(DATE_FORMAT);
  const txnsUrl = `${apiSiteUrl}/lastTransactions/${accountNumber}/Date?IsCategoryDescCode=True&IsTransactionDetails=True&IsEventNames=True&FromDate=${startDateStr}`;
  const txnsResult = await fetch(page, txnsUrl);
  if (txnsResult.Error) {
    return {
      success: false,
      errorType: 'generic',
      errorMessage: txnsResult.Error.MsgText,
    };
  }
  const txns = convertTransactions(txnsResult.CurrentAccountLastTransactions.OperationEntry);

  const accountData = {
    success: true,
    accountNumber,
    txns,
  };
  notifier.notify(options, `end scraping for account ${accountData.accountNumber}, found ${accountData.txns.length} transactions`);

  return accountData;
}

function getPossibleLoginUrls() {
  const urls = {};
  urls[LOGIN_RESULT.SUCCESS] = `${BASE_URL}/apollo/core/templates/default/masterPage.html#/MY_ACCOUNT_HOMEPAGE`;
  urls[LOGIN_RESULT.INVALID_PASSWORD] = `${BASE_URL}/LoginPages/Logon?multilang=he&t=P&pagekey=home&bank=d#`;
  urls[LOGIN_RESULT.CHANGE_PASSWORD] = `${BASE_URL}/LoginPages/Logon`;
  return urls;
}

class DiscountScraper extends BaseScraper {
  async scrape(credentials, options = {}) {
    await super.initialize();
    notifier.notify(options, 'start scraping');

    await this.login(credentials, options);

    const loginResult = await super.analyzeLogin(getPossibleLoginUrls());

    const scrapeResult =
      await super.handleLoginResult(options, loginResult, notifier, fetchAccountData);

    await super.exit();

    return scrapeResult;
  }

  async login(credentials, options) {
    const loginUrl = `${BASE_URL}/LoginPages/Logon?multilang=he&t=P&pageKey=home&bank=d`;
    const loginFields = [
      { id: 'tzId', value: credentials.id },
      { id: 'tzPassword', value: credentials.password },
      { id: 'aidnum', value: credentials.num },
    ];
    await performLogin(this.page, loginUrl, loginFields, 'submitButton', () => notifier.notify(options, 'logging in'));
    await waitForRedirect(this.page);
  }
}

export default DiscountScraper;
