import buildUrl from 'build-url';
import moment from 'moment';

import { BaseScraper, LOGIN_RESULT } from './base-scraper';
import { waitForRedirect } from '../helpers/navigation';
import { waitUntilElementFound } from '../helpers/elements-interactions';

const BASE_URL = 'https://online.leumi-card.co.il';
const DATE_FORMAT = 'DD/MM/YYYY';

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

function getTransactionsUrl(accountIndex, tableType, startDate) {
  const fromDateStr = moment(startDate).format(DATE_FORMAT);
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

async function fetchTransactionsByType(page, accountIndex, transactionsType, startDate) {
  const url = getTransactionsUrl(accountIndex, transactionsType, startDate);
  await page.goto(url);
  const current = await page.url();
  if (current.includes('error.aspx')) {
    return [];
  }
  await waitUntilElementFound(page, 'tbl1_lvTransactions_lnkPurchaseDate');

  const rawTxns = await getLoadedRawTransactions(page);
  const txns = rawTxns.map((txn) => {
    return {
      date: moment(txn.dateStr, DATE_FORMAT).toDate(),
      processedDate: moment(txn.processedDateStr, DATE_FORMAT).toDate(),
      amount: -parseFloat(txn.amountStr.replace(',', '')),
      description: txn.description.trim(),
    };
  });
  return txns;
}

async function fetchTransactions(page, accountIndex, options) {
  const defaultStartMoment = moment().subtract(1, 'years');
  let startDate = options.startDate || defaultStartMoment.toDate();
  const startMoment = moment.max(defaultStartMoment, moment(startDate));
  startDate = startMoment.toDate();

  const localTxns = await fetchTransactionsByType(page, accountIndex, 'NisTransactions', startDate);
  const futureLocalTxns = await fetchTransactionsByType(page, accountIndex, 'FutureNisTransactions', startDate);
  const foreignTxns = await fetchTransactionsByType(page, accountIndex, 'ForeignTransactions', startDate);
  const futureForeignTxns = await fetchTransactionsByType(page, accountIndex, 'FutureForeignTransactions', startDate);
  const allTxns = [...localTxns, ...futureLocalTxns, ...foreignTxns, ...futureForeignTxns];
  allTxns.sort((txn1, txn2) => {
    if (txn1.date.getTime() === txn2.date.getTime()) {
      return 0;
    }
    return txn1.date < txn2.date ? -1 : 1;
  });
  return allTxns;
}

async function getAccountData(page, options) {
  const accountsPage = `${BASE_URL}/Registred/Transactions/ChargesDeals.aspx`;
  await page.goto(accountsPage);

  const accountNumbers = await getAccountNumbers(page);
  const txns = await fetchTransactions(page, 0, options);

  return {
    success: true,
    accountNumber: accountNumbers[0],
    txns,
  };
}

function getPossibleLoginResults() {
  const urls = {};
  urls[LOGIN_RESULT.SUCCESS] = `${BASE_URL}/Registred/HomePage.aspx`;
  urls[LOGIN_RESULT.INVALID_PASSWORD] = `${BASE_URL}/Anonymous/Login/CardHoldersLogin.aspx`;
  return urls;
}

function createLoginFields(inputGroupName, credentials) {
  return [
    { id: `${inputGroupName}_txtUserName`, value: credentials.username },
    { id: `${inputGroupName}_txtPassword`, value: credentials.password },
  ];
}

class LeumiCardScraper extends BaseScraper {
  constructor() {
    super('leumi-card');
  }

  getLoginOptions(credentials) {
    const inputGroupName = 'PlaceHolderMain_CardHoldersLogin1';
    return {
      loginUrl: `${BASE_URL}/Anonymous/Login/CardHoldersLogin.aspx`,
      fields: createLoginFields(inputGroupName, credentials),
      submitButtonId: `${inputGroupName}_btnLogin`,
      postAction: async () => redirectOrDialog(this.page),
      possibleResults: getPossibleLoginResults(),
    };
  }

  async fetchData() {
    return getAccountData(this.page, this.options);
  }
}

export default LeumiCardScraper;
