import phantom from 'phantom';

import { login as performLogin, analyzeLogin } from '../helpers/login';
import fetch from '../helpers/fetch';

const BASE_URL = 'https://start.telebank.co.il';

const POSSIBLE_LOGIN_URLS = {
  default: `${BASE_URL}/apollo/core/templates/default/masterPage.html#/MY_ACCOUNT_HOMEPAGE`,
  invalidPassword: `${BASE_URL}/LoginPages/Logon?multilang=he&t=P&pagekey=home&bank=d#`,
  changePassword: `${BASE_URL}/LoginPages/Logon`,
};

function notify(options, message) {
  if (options.eventsCallback) {
    options.eventsCallback(message);
  }
}

async function login(page, credentials, options) {
  const loginUrl = `${BASE_URL}/LoginPages/Logon?multilang=he&t=P&pageKey=home&bank=d`;
  const loginFields = [
    { id: 'tzId', value: credentials.id },
    { id: 'tzPassword', value: credentials.password },
    { id: 'aidnum', value: credentials.num },
  ];
  await performLogin(page, loginUrl, loginFields, 'submitButton', () => notify(options, 'discount: logging in'));
}

async function fetchAccountData(page, options) {
  await page.includeJs('https://ajax.googleapis.com/ajax/libs/jquery/1.8.2/jquery.min.js');

  const apiSiteUrl = `${BASE_URL}/Titan/gatewayAPI`;

  const accountDataUrl = `${apiSiteUrl}/userAccountsData`;
  const accountInfo = await fetch(page, accountDataUrl);
  const accountNumber = accountInfo.UserAccountsData.DefaultAccountNumber;

  notify(options, `discount: found account number ${accountNumber}`);

  const date = new Date();
  date.setDate(date.getDate() - 180);
  const txnsUrl = `${apiSiteUrl}/lastTransactions/${accountNumber}/Date?IsCategoryDescCode=True&IsTransactionDetails=True&IsEventNames=True&FromDate=${date.toISOString().slice(0, 10).replace(/-/g, '')}`;
  const txnsResult = await fetch(page, txnsUrl);
  if (txnsResult.Error) {
    return {
      success: false,
      errorType: 'generic',
      errorMessage: txnsResult.Error.MsgText,
    };
  }
  const txns = txnsResult.CurrentAccountLastTransactions.OperationEntry;

  const accountData = {
    success: true,
    accountNumber,
    txns,
  };
  notify(options, `discount: end scraping for account ${accountData.accountNumber}, found ${accountData.txns.length} transactions`);

  return accountData;
}

async function scrape(credentials, options = {}) {
  notify(options, 'discount: start scraping');

  const instance = await phantom.create();
  const page = await instance.createPage();

  await login(page, credentials, options);

  const loginResult = await analyzeLogin(page, POSSIBLE_LOGIN_URLS);
  if (['timeout', 'generic'].includes(loginResult)) {
    return {
      success: false,
      errorType: loginResult,
    };
  }

  let scrapeResult;
  switch (loginResult) {
    case 'default':
      notify(options, 'discount: login successful');
      scrapeResult = await fetchAccountData(page, options);
      break;
    case 'invalidPassword':
      notify(options, 'discount: invalid password');
      scrapeResult = {
        success: false,
        errorType: loginResult,
      };
      break;
    case 'changePassword':
      notify(options, 'discount: need to change password');
      scrapeResult = {
        success: false,
        errorType: loginResult,
      };
      break;
    default:
      throw new Error('unexpected login result');
  }

  await instance.exit();

  return scrapeResult;
}

export default scrape;
