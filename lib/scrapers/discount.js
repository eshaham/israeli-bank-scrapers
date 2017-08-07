import phantom from 'phantom';
import moment from 'moment';

import ScraperNotifier from '../helpers/notifier';
import { login as performLogin, analyzeLogin, LOGIN_RESULT } from '../helpers/login';
import { waitForRedirect, NAVIGATION_ERRORS } from '../helpers/navigation';
import fetch from '../helpers/fetch';
import includeJQuery from '../helpers/imported-libs';

const BASE_URL = 'https://start.telebank.co.il';
const DATE_FORMAT = 'YYYYMMDD';

const notifier = new ScraperNotifier('discount');

async function login(page, credentials, options) {
  const loginUrl = `${BASE_URL}/LoginPages/Logon?multilang=he&t=P&pageKey=home&bank=d`;
  const loginFields = [
    { id: 'tzId', value: credentials.id },
    { id: 'tzPassword', value: credentials.password },
    { id: 'aidnum', value: credentials.num },
  ];
  await performLogin(page, loginUrl, loginFields, 'submitButton', () => notifier.notify(options, 'discount: logging in'));
  await waitForRedirect(page);
}

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

  notifier.notify(options, `discount: found account number ${accountNumber}`);

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
  notifier.notify(options, `discount: end scraping for account ${accountData.accountNumber}, found ${accountData.txns.length} transactions`);

  return accountData;
}

function handleLoginResult(page, options, loginResult) {
  switch (loginResult) {
    case LOGIN_RESULT.SUCCESS:
      notifier.notify(options, 'discount: login successful');
      return fetchAccountData(page, options);
    case LOGIN_RESULT.INVALID_PASSWORD:
      notifier.notify(options, 'discount: invalid password');
      return {
        success: false,
        errorType: loginResult,
      };
    case LOGIN_RESULT.CHANGE_PASSWORD:
      notifier.notify(options, 'discount: need to change password');
      return {
        success: false,
        errorType: loginResult,
      };
    case NAVIGATION_ERRORS.TIMEOUT:
      notifier.notify(options, 'discount: timeout during login');
      return {
        success: false,
        errorType: loginResult,
      };
    case NAVIGATION_ERRORS.GENERIC:
      notifier.notify(options, 'discount: generic error during login');
      return {
        success: false,
        errorType: loginResult,
      };
    default:
      throw new Error(`unexpected login result "${loginResult}"`);
  }
}

function getPossibleLoginUrls() {
  const urls = {};
  urls[LOGIN_RESULT.SUCCESS] = `${BASE_URL}/apollo/core/templates/default/masterPage.html#/MY_ACCOUNT_HOMEPAGE`;
  urls[LOGIN_RESULT.INVALID_PASSWORD] = `${BASE_URL}/LoginPages/Logon?multilang=he&t=P&pagekey=home&bank=d#`;
  urls[LOGIN_RESULT.CHANGE_PASSWORD] = `${BASE_URL}/LoginPages/Logon`;
  return urls;
}

async function scrape(credentials, options = {}) {
  notifier.notify(options, 'discount: start scraping');

  const instance = await phantom.create();
  const page = await instance.createPage();

  await login(page, credentials, options);

  const loginResult = await analyzeLogin(page, getPossibleLoginUrls());
  if (['timeout', 'generic'].includes(loginResult)) {
    await instance.exit();
    return {
      success: false,
      errorType: loginResult,
    };
  }

  const scrapeResult = await handleLoginResult(page, options, loginResult);

  await instance.exit();

  return scrapeResult;
}

export default scrape;
