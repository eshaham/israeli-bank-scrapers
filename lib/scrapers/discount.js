import phantom from 'phantom';

import { waitForUrls, waitForRedirect } from '../helpers/navigation';
import { waitUntilElementFound, fillInput, clickButton } from '../helpers/elements-interactions';

async function fetchAccountData(page) {
  await page.includeJs('https://ajax.googleapis.com/ajax/libs/jquery/1.8.2/jquery.min.js');

  const apiSiteUrl = 'https://start.telebank.co.il/Titan/gatewayAPI';

  const accountInfo = await page.evaluate((apiSiteUrl) => {
    const result = $.ajax({
      async: false,
      url: `${apiSiteUrl}/userAccountsData`,
    });
    return JSON.parse(result.responseText);
  }, apiSiteUrl);
  const accountNumber = accountInfo.UserAccountsData.DefaultAccountNumber;

  console.log(`discount: found account number ${accountNumber}`);

  const txnsData = await page.evaluate((apiSiteUrl, accountNumber) => {
    const date = new Date();
    date.setDate(date.getDate() - 180);

    const txnsUrl = `${apiSiteUrl}/lastTransactions/${accountNumber}/Date?IsCategoryDescCode=True&IsTransactionDetails=True&IsEventNames=True&FromDate=${date.toISOString().slice(0, 10).replace(/-/g, '')}`;
    const result = $.ajax({
      async: false,
      url: txnsUrl,
    });
    return JSON.parse(result.responseText);
  }, apiSiteUrl, accountNumber);
  if (!txnsData.CurrentAccountLastTransactions) {
    console.log(txnsData);
  }
  const txns = txnsData.CurrentAccountLastTransactions.OperationEntry;

  const accountData = {
    success: true,
    accountNumber,
    txns,
  };
  console.log(`discount: end scraping for account ${accountData.accountNumber}, found ${accountData.txns.length} transactions`);

  return accountData;
}

async function scrape(credentials) {
  console.log('discount: start scraping');

  const baseUrl = 'https://start.telebank.co.il';

  const instance = await phantom.create();
  const page = await instance.createPage();
  await page.open(`${baseUrl}/LoginPages/Logon?multilang=he&t=P&pageKey=home&bank=d`);
  await waitUntilElementFound(page, 'submitButton');
  await fillInput(page, 'tzId', credentials.id);
  await fillInput(page, 'tzPassword', credentials.password);
  await fillInput(page, 'aidnum', credentials.num);

  console.log('discount: logging in');
  await clickButton(page, 'submitButton');

  await waitForRedirect(page);

  const urls = {
    default: `${baseUrl}/apollo/core/templates/default/masterPage.html#/MY_ACCOUNT_HOMEPAGE`,
    invalidPassword: `${baseUrl}/LoginPages/Logon?multilang=he&t=P&pagekey=home&bank=d#`,
    changePassword: `${baseUrl}/LoginPages/Logon`,
  };

  let loginResult;
  try {
    loginResult = await waitForUrls(page, urls);
  } catch (e) {
    console.error(e);
    throw new Error('couldn\'t complete scraping');
  }

  let scrapeResult;
  switch (loginResult) {
    case 'default':
      console.log('discount: login successful');
      scrapeResult = await fetchAccountData(page);
      break;
    case 'invalidPassword':
      console.log('discount: invalid password');
      scrapeResult = {
        success: false,
        errorType: loginResult,
      };
      break;
    case 'changePassword':
      console.log('discount: need to change password');
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
