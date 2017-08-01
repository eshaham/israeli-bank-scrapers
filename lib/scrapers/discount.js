import phantom from 'phantom';

import { waitForUrls, waitForRedirect } from '../helpers/navigation';
import { waitUntilElementFound, fillInput, clickButton } from '../helpers/elements-interactions';

const BASE_URL = 'https://start.telebank.co.il';

function notify(options, message) {
  if (options.eventsCallback) {
    options.eventsCallback(message);
  }
}

async function fetchAccountData(page, options) {
  await page.includeJs('https://ajax.googleapis.com/ajax/libs/jquery/1.8.2/jquery.min.js');

  const apiSiteUrl = `${BASE_URL}/Titan/gatewayAPI`;

  const accountInfo = await page.evaluate((apiSiteUrl) => {
    const result = $.ajax({
      async: false,
      url: `${apiSiteUrl}/userAccountsData`,
    });
    return JSON.parse(result.responseText);
  }, apiSiteUrl);
  const accountNumber = accountInfo.UserAccountsData.DefaultAccountNumber;

  notify(options, `discount: found account number ${accountNumber}`);

  const txnsResult = await page.evaluate((apiSiteUrl, accountNumber) => {
    const date = new Date();
    date.setDate(date.getDate() - 180);

    const txnsUrl = `${apiSiteUrl}/lastTransactions/${accountNumber}/Date?IsCategoryDescCode=True&IsTransactionDetails=True&IsEventNames=True&FromDate=${date.toISOString().slice(0, 10).replace(/-/g, '')}`;
    const result = $.ajax({
      async: false,
      url: txnsUrl,
    });
    return JSON.parse(result.responseText);
  }, apiSiteUrl, accountNumber);
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
  await page.open(`${BASE_URL}/LoginPages/Logon?multilang=he&t=P&pageKey=home&bank=d`);
  await waitUntilElementFound(page, 'submitButton');
  await fillInput(page, 'tzId', credentials.id);
  await fillInput(page, 'tzPassword', credentials.password);
  await fillInput(page, 'aidnum', credentials.num);

  notify(options, 'discount: logging in');
  await clickButton(page, 'submitButton');

  await waitForRedirect(page);

  const urls = {
    default: `${BASE_URL}/apollo/core/templates/default/masterPage.html#/MY_ACCOUNT_HOMEPAGE`,
    invalidPassword: `${BASE_URL}/LoginPages/Logon?multilang=he&t=P&pagekey=home&bank=d#`,
    changePassword: `${BASE_URL}/LoginPages/Logon`,
  };

  let loginResult;
  try {
    loginResult = await waitForUrls(page, urls);
  } catch (e) {
    const errorType = e.timeout ? 'timeout' : 'generic';
    return {
      success: false,
      errorType,
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
