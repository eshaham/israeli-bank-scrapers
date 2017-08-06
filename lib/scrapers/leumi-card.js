import phantom from 'phantom';
import buildUrl from 'build-url';
import moment from 'moment';

import { login as performLogin, analyzeLogin, LOGIN_RESULT } from '../helpers/login';
import { waitForRedirect, waitForPageLoad, NAVIGATION_ERRORS } from '../helpers/navigation';
import { waitUntilElementFound } from '../helpers/elements-interactions';

const BASE_URL = 'https://online.leumi-card.co.il';
const DATE_FORMAT = 'DD/MM/YYYY';

function notify(options, message) {
  if (options.eventsCallback) {
    options.eventsCallback(message);
  }
}

async function login(page, credentials, options) {
  const loginUrl = `${BASE_URL}/Anonymous/Login/CardHoldersLogin.aspx`;
  const inputGroupName = 'PlaceHolderMain_CardHoldersLogin1';
  const loginFields = [
    { id: `${inputGroupName}_txtUserName`, value: credentials.username },
    { id: `${inputGroupName}_txtPassword`, value: credentials.password },
  ];
  await performLogin(page, loginUrl, loginFields, `${inputGroupName}_btnLogin`, () => notify(options, 'leumi card: logging in'));
}

function redirectOrDialog(page) {
  return Promise.race([
    waitForRedirect(page),
    waitUntilElementFound(page, 'popupWrongDetails', true),
  ]);
}

function getAccountNumbers(page) {
  return page.evaluate(() => {
    const creditCardDetailsList = document.getElementsByClassName('creditCard_name');
    const accountNumbers = [];
    for (let i = 0; i < creditCardDetailsList.length; i += 1) {
      const dirtyAccountNumber = creditCardDetailsList[i].lastChild.textContent;
      const accountNumber = dirtyAccountNumber.trim().replace('(', '').replace(')', '');
      accountNumbers.push(accountNumber);
    }
    return accountNumbers;
  });
}

function getTransactionsUrl(accountIndex, tableType) {
  const fromDateStr = moment().subtract(1, 'y').format(DATE_FORMAT);
  const toDateStr = moment().format(DATE_FORMAT);

  return buildUrl(BASE_URL, {
    path: 'Popups/Print.aspx',
    queryParams: {
      PrintType: 'TransactionsTable',
      CardIndex: accountIndex,
      TableType: tableType,
      ActionType: 'Dates',
      FilterParam: 'AllTranactions',
      FromDate: fromDateStr,
      ToDate: toDateStr,
      SortDirection: 'Ascending',
      SortParam: 'PaymentDate',
    },
  });
}

function getLoadedRawTransactions(page) {
  return page.evaluate(() => {
    const tables = document.getElementsByTagName('table');
    const table = tables[0];

    const rows = table.getElementsByTagName('tr');

    const txns = [];
    for (let i = 0; i < rows.length; i += 1) {
      if (rows[i].id && rows[i].id.indexOf('tbl1') >= 0) {
        const cells = rows[i].getElementsByTagName('td');

        const dateStr = cells[1].textContent.trim();
        const processedDateStr = cells[2].textContent.trim();
        const amountStr = cells[6].textContent;
        const description = cells[3].textContent;

        const txn = {
          dateStr,
          processedDateStr,
          amountStr,
          description,
        };
        txns.push(txn);
      }
    }
    return txns;
  });
}

async function fetchTransactionsByType(page, accountIndex, transactionsType) {
  const url = getTransactionsUrl(accountIndex, transactionsType);
  await page.open(url);
  await waitUntilElementFound(page, 'tbl1_lvTransactions_lnkPurchaseDate');

  const rawTxns = await getLoadedRawTransactions(page);
  const txns = rawTxns.map((txn) => {
    return {
      date: moment(txn.dateStr, DATE_FORMAT).toDate(),
      processedDate: moment(txn.processedDateStr, DATE_FORMAT).toDate(),
      amount: parseFloat(txn.amountStr),
      description: txn.description.trim(),
    };
  });
  return txns;
}

async function fetchTransactions(page, accountIndex) {
  const localTxns = await fetchTransactionsByType(page, accountIndex, 'NisTransactions');
  const futureLocalTxns = await fetchTransactionsByType(page, accountIndex, 'FutureNisTransactions');
  const foreignTxns = await fetchTransactionsByType(page, accountIndex, 'ForeignTransactions');
  const futureForeignTxns = await fetchTransactionsByType(page, accountIndex, 'FutureForeignTransactions');
  const allTxns = [...localTxns, ...futureLocalTxns, ...foreignTxns, ...futureForeignTxns];
  allTxns.sort((txn1, txn2) => {
    if (txn1.date.getTime() === txn2.date.getTime()) {
      return 0;
    }
    return txn1.date < txn2.date ? -1 : 1;
  });
  return allTxns;
}

async function getAccountData(page) {
  const accountsPage = `${BASE_URL}/Registred/Transactions/ChargesDeals.aspx`;
  await page.open(accountsPage);
  await waitForPageLoad(page);

  const accountNumbers = await getAccountNumbers(page);
  const txns = await fetchTransactions(page, 0);

  return {
    success: true,
    accountNumber: accountNumbers[0],
    txns,
  };
}

async function handleLoginResult(page, options, loginResult) {
  switch (loginResult) {
    case LOGIN_RESULT.SUCCESS:
      notify(options, 'leumi card: login successful');
      return getAccountData(page);
    case LOGIN_RESULT.INVALID_PASSWORD:
      notify(options, 'leumi card: invalid password');
      return {
        success: false,
        errorType: loginResult,
      };
    case NAVIGATION_ERRORS.TIMEOUT:
      notify(options, 'leumi card: timeout during login');
      return {
        success: false,
        errorType: loginResult,
      };
    case NAVIGATION_ERRORS.GENERIC:
      notify(options, 'leumi card: generic error during login');
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
  urls[LOGIN_RESULT.SUCCESS] = `${BASE_URL}/Registred/HomePage.aspx`;
  urls[LOGIN_RESULT.INVALID_PASSWORD] = `${BASE_URL}/Anonymous/Login/CardHoldersLogin.aspx`;
  return urls;
}

async function scrape(credentials, options = {}) {
  notify(options, 'leumi card: start scraping');

  const instance = await phantom.create();
  const page = await instance.createPage();

  await login(page, credentials, options);
  await redirectOrDialog(page);

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
