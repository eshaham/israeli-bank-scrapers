import buildUrl from 'build-url';
import moment from 'moment';

import { BaseScraperWithBrowser, LOGIN_RESULT } from './base-scraper-with-browser';
import { waitForRedirect } from '../helpers/navigation';
import { waitUntilElementFound } from '../helpers/elements-interactions';
import { NORMAL_TXN_TYPE, INSTALLMENTS_TXN_TYPE, SHEKEL_CURRENCY_SYMBOL, SHEKEL_CURRENCY } from '../constants';
import getAllMonthMoments from '../helpers/dates';
import { fixInstallments, sortTransactionsByDate, filterOldTransactions } from '../helpers/transactions';

const BASE_URL = 'https://online.leumi-card.co.il';
const DATE_FORMAT = 'DD/MM/YYYY';
const NORMAL_TYPE_NAME = 'רגילה';
const ATM_TYPE_NAME = 'חיוב עסקות מיידי';
const INTERNET_SHOPPING_TYPE_NAME = 'אינטרנט/חו"ל';
const INSTALLMENTS_TYPE_NAME = 'תשלומים';
const ONE_MONTH_POSTPONED_TYPE_NAME = 'דחוי חודש';
const TWO_MONTHS_POSTPONED_TYPE_NAME = 'דחוי חודשיים';

function redirectOrDialog(page) {
  return Promise.race([
    waitForRedirect(page),
    waitUntilElementFound(page, '#popupWrongDetails', true),
  ]);
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
    case ONE_MONTH_POSTPONED_TYPE_NAME:
    case TWO_MONTHS_POSTPONED_TYPE_NAME:
    case INTERNET_SHOPPING_TYPE_NAME:
      return NORMAL_TXN_TYPE;
    case INSTALLMENTS_TYPE_NAME:
      return INSTALLMENTS_TXN_TYPE;
    default:
      throw new Error(`unknown transaction type ${txnTypeStr}`);
  }
}

function getAmountData(amountStr) {
  const amountStrCopy = amountStr.replace(',', '');
  let currency = null;
  let amount = null;
  if (amountStrCopy.includes(SHEKEL_CURRENCY_SYMBOL)) {
    amount = parseFloat(amountStrCopy.replace(SHEKEL_CURRENCY_SYMBOL, ''));
    currency = SHEKEL_CURRENCY;
  } else {
    const parts = amountStrCopy.split(' ');
    amount = parseFloat(parts[0]);
    [, currency] = parts;
  }

  return {
    amount,
    currency,
  };
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
    number: parseInt(matches[0], 10),
    total: parseInt(matches[1], 10),
  };
}

function convertTransactions(rawTxns) {
  return rawTxns.map((txn) => {
    const originalAmountData = getAmountData(txn.originalAmountStr);
    const chargedAmountData = getAmountData(txn.chargedAmountStr);
    return {
      type: getTransactionType(txn.typeStr),
      date: moment(txn.dateStr, DATE_FORMAT).toISOString(),
      processedDate: moment(txn.processedDateStr, DATE_FORMAT).toISOString(),
      originalAmount: -originalAmountData.amount,
      originalCurrency: originalAmountData.currency,
      chargedAmount: -chargedAmountData.amount,
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
  const clonedResults = Object.assign({}, allResults);
  Object.keys(result).forEach((accountNumber) => {
    if (!clonedResults[accountNumber]) {
      clonedResults[accountNumber] = [];
    }
    clonedResults[accountNumber].push(...result[accountNumber]);
  });
  return clonedResults;
}

function prepareTransactions(txns, startMoment, combineInstallments) {
  let clonedTxns = Array.from(txns);
  if (!combineInstallments) {
    clonedTxns = fixInstallments(clonedTxns);
  }
  clonedTxns = sortTransactionsByDate(clonedTxns);
  clonedTxns = filterOldTransactions(clonedTxns, startMoment, combineInstallments);
  return clonedTxns;
}

async function fetchTransactions(page, options) {
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

  Object.keys(allResults).forEach((accountNumber) => {
    let txns = allResults[accountNumber];
    txns = prepareTransactions(txns, startMoment, options.combineInstallments);
    allResults[accountNumber] = txns;
  });

  return allResults;
}

async function getAccountData(page, options) {
  const accountsPage = `${BASE_URL}/Registred/Transactions/ChargesDeals.aspx`;
  await page.goto(accountsPage);

  const results = await fetchTransactions(page, options);
  const accounts = Object.keys(results).map((accountNumber) => {
    return {
      accountNumber,
      txns: results[accountNumber],
    };
  });

  return {
    success: true,
    accounts,
  };
}

function getPossibleLoginResults() {
  const urls = {};
  urls[LOGIN_RESULT.SUCCESS] = [`${BASE_URL}/Registred/HomePage.aspx`];
  urls[LOGIN_RESULT.INVALID_PASSWORD] = [`${BASE_URL}/Anonymous/Login/CardHoldersLogin.aspx`];
  return urls;
}

function createLoginFields(inputGroupName, credentials) {
  return [
    { selector: `#${inputGroupName}_txtUserName`, value: credentials.username },
    { selector: `#${inputGroupName}_txtPassword`, value: credentials.password },
  ];
}

class LeumiCardScraper extends BaseScraperWithBrowser {
  getLoginOptions(credentials) {
    const inputGroupName = 'PlaceHolderMain_CardHoldersLogin1';
    return {
      loginUrl: `${BASE_URL}/Anonymous/Login/CardHoldersLogin.aspx`,
      fields: createLoginFields(inputGroupName, credentials),
      submitButtonSelector: `#${inputGroupName}_btnLogin`,
      postAction: async () => redirectOrDialog(this.page),
      possibleResults: getPossibleLoginResults(),
    };
  }

  async fetchData() {
    return getAccountData(this.page, this.options);
  }
}

export default LeumiCardScraper;
