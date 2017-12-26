import buildUrl from 'build-url';
import moment from 'moment';

import { BaseScraper, LOGIN_RESULT } from './base-scraper';
import { waitForRedirect } from '../helpers/navigation';
import { waitUntilElementFound } from '../helpers/elements-interactions';
import { NORMAL_TXN_TYPE, INSTALLMENTS_TXN_TYPE, SHEKEL_CURRENCY } from '../constants';
import getAllMonthMoments from '../helpers/dates';
import { fixInstallments, sortTransactionsByDate, filterOldTransactions } from '../helpers/transactions';

const BASE_URL = 'https://online.leumi-card.co.il';
const DATE_FORMAT = 'DD/MM/YYYY';
const NORMAL_TYPE_NAME = 'רגילה';
const ATM_TYPE_NAME = 'חיוב עסקות מיידי';
const INSTALLMENTS_TYPE_NAME = 'תשלומים';
const POSTPONED_TYPE_NAME = 'דחוי חודש';

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

function getTransactionsUrl(monthMoment) {
  let monthCharge = null;
  let actionType = 1;
  if (monthMoment) {
    const month = monthMoment.month() + 1;
    const monthStr = month < 10 ? `0${month}` : month.toString();
    const year = monthMoment.year();
    monthCharge = `${year}${monthStr}`;
    actionType = 2;
  }
  return buildUrl(BASE_URL, {
    path: 'Registred/Transactions/ChargesDeals.aspx',
    queryParams: {
      ActionType: actionType,
      MonthCharge: monthCharge,
      Index: -2,
    },
  });
}

function getTransactionType(txnTypeStr) {
  switch (txnTypeStr.trim()) {
    case ATM_TYPE_NAME:
    case NORMAL_TYPE_NAME:
    case POSTPONED_TYPE_NAME:
      return NORMAL_TXN_TYPE;
    case INSTALLMENTS_TYPE_NAME:
      return INSTALLMENTS_TXN_TYPE;
    default:
      throw new Error(`unknown transaction type ${txnTypeStr}`);
  }
}

function getInstallmentsInfo(comments) {
  if (!comments) {
    return null;
  }
  const matches = comments.match(/\d+/g);
  if (!matches || matches.length < 2) {
    return null;
  }

  return {
    number: matches[0],
    total: matches[1],
  };
}

function convertTransactions(rawTxns) {
  return rawTxns.map((txn) => {
    return {
      type: getTransactionType(txn.typeStr),
      date: moment(txn.dateStr, DATE_FORMAT).toDate(),
      processedDate: moment(txn.processedDateStr, DATE_FORMAT).toDate(),
      originalAmount: -parseFloat(txn.originalAmountStr.replace(',', '').replace(SHEKEL_CURRENCY, '')),
      chargedAmount: -parseFloat(txn.chargedAmountStr.replace(',', '')),
      description: txn.description.trim(),
      installments: getInstallmentsInfo(txn.comments),
    };
  });
}

async function getCurrentTransactions(page) {
  const result = {};
  const cardContainers = await page.$$('.infoList_holder');
  for (let cardIndex = 0; cardIndex < cardContainers.length; cardIndex += 1) {
    const cardContainer = cardContainers[cardIndex];
    const infoContainer = await cardContainer.$('.creditCard_name');
    const numberListItems = await infoContainer.$$('li');
    const numberListItem = numberListItems[1];
    const accountNumberStr = await page.evaluate((li) => {
      return li.innerText;
    }, numberListItem);
    const accountNumber = accountNumberStr.replace('(', '').replace(')', '');

    const txns = [];
    const txnsRows = await cardContainer.$$('.jobs_regular');
    for (let txnIndex = 0; txnIndex < txnsRows.length; txnIndex += 1) {
      const txnColumns = await txnsRows[txnIndex].$$('td');
      const typeStr = await page.evaluate((td) => {
        return td.innerText;
      }, txnColumns[4]);

      const dateStr = await page.evaluate((td) => {
        return td.innerText;
      }, txnColumns[1]);

      const processedDateStr = await page.evaluate((td) => {
        return td.innerText;
      }, txnColumns[2]);

      const originalAmountStr = await page.evaluate((td) => {
        return td.innerText;
      }, txnColumns[5]);

      const chargedAmountStr = await page.evaluate((td) => {
        return td.innerText;
      }, txnColumns[6]);

      const description = await page.evaluate((td) => {
        return td.innerText;
      }, txnColumns[3]);

      const comments = await page.evaluate((td) => {
        return td.innerText;
      }, txnColumns[7]);

      const txn = {
        typeStr,
        dateStr,
        processedDateStr,
        originalAmountStr,
        chargedAmountStr,
        description,
        comments,
      };
      txns.push(txn);
    }

    result[accountNumber] = convertTransactions(txns);
  }

  return result;
}

async function fetchTransactionsForMonth(page, monthMoment) {
  const url = getTransactionsUrl(monthMoment);
  await page.goto(url);

  return getCurrentTransactions(page);
}

function addResult(allResults, result) {
  const tempResults = Object.assign({}, allResults);
  Object.keys(result).forEach((accountNumber) => {
    if (!tempResults[accountNumber]) {
      tempResults[accountNumber] = [];
    }
    tempResults[accountNumber].push(...result[accountNumber]);
  });
  return tempResults;
}

async function fetchTransactions(page, options, accountNumber) {
  const defaultStartMoment = moment().subtract(1, 'years');
  const startDate = options.startDate || defaultStartMoment.toDate();
  const startMoment = moment.max(defaultStartMoment, moment(startDate));
  const allMonths = getAllMonthMoments(startMoment, false);

  let allResults = {};
  for (let i = 0; i < allMonths.length; i += 1) {
    const result = await fetchTransactionsForMonth(page, allMonths[i]);
    allResults = addResult(allResults, result);
  }

  const result = await fetchTransactionsForMonth(page);
  allResults = addResult(allResults, result);

  let allTxns = allResults[accountNumber];
  if (!options.combineInstallments) {
    allTxns = fixInstallments(allTxns);
  }
  allTxns = sortTransactionsByDate(allTxns);
  allTxns = filterOldTransactions(allTxns, startMoment, options.combineInstallments);
  return allTxns;
}

async function getAccountData(page, options) {
  const accountsPage = `${BASE_URL}/Registred/Transactions/ChargesDeals.aspx`;
  await page.goto(accountsPage);

  const accountNumbers = await getAccountNumbers(page);
  const txns = await fetchTransactions(page, options, accountNumbers[0]);

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
