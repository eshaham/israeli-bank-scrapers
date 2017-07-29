import phantom from 'phantom';

function timeoutPromise(ms, promise) {
  const timeout = new Promise((resolve, reject) => {
    const id = setTimeout(() => {
      clearTimeout(id);
      reject({ timeout: true });
    }, ms);
  });

  return Promise.race([
    promise,
    timeout,
  ]);
}

function waitUntil(asyncTest, timeout = 10000, interval = 100) {
  const promise = new Promise((resolve, reject) => {
    function wait() {
      asyncTest().then((value) => {
        if (value === true) {
          resolve();
        } else {
          setTimeout(wait, interval);
        }
      }).catch((e) => {
        console.log('Error found. Rejecting.', e);
        reject();
      });
    }
    wait();
  });
  return timeoutPromise(timeout, promise);
}

async function waitUntilElementFound(page, elementName) {
  await waitUntil(() => {
    return page.evaluate((elementName) => {
      return document.getElementById(elementName) !== null;
    }, elementName);
  });
}

async function waitForUrl(page, url) {
  try {
    await waitUntil(async () => {
      const current = await page.property('url');
      return current === url;
    }, 20000, 1000);
  } catch (e) {
    if (e && e.timeout) {
      const current = await page.property('url');
      console.log(`timeout reached this page: ${current}`);
      e.lastUrl = current;
    }
    throw e;
  }
}

async function fillInput(page, inputName, inputValue) {
  await page.evaluate((inputName, inputValue) => {
    const input = document.getElementById(inputName);
    input.value = inputValue;
  }, inputName, inputValue);
}

async function clickButton(page, buttonName) {
  await page.evaluate((buttonName) => {
    const button = document.getElementById(buttonName);
    button.click();
  }, buttonName);
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

  try {
    await waitForUrl(page, `${baseUrl}/apollo/core/templates/default/masterPage.html#/MY_ACCOUNT_HOMEPAGE`);
  } catch (e) {
    // TODO: notice change password url https://start.telebank.co.il/LoginPages/Logon
    // TODO: notice invalid password url https://start.telebank.co.il/LoginPages/Logon?multilang=he&t=P&pagekey=home&bank=d#
    throw new Error('couldn\'t complete scraping');
  }

  console.log('discount: login successful');

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
    accountNumber,
    txns,
  };
  console.log(`discount: end scraping for account ${accountData.accountNumber}, found ${accountData.txns.length} transactions`);

  await instance.exit();

  return accountData;
}

export default scrape;
