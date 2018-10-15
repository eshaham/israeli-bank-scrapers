import buildUrl from 'build-url';
import moment from 'moment';

import { BaseScraperWithBrowser, LOGIN_RESULT } from './base-scraper-with-browser';
import { waitForNavigationAndDomLoad, waitForRedirect } from '../helpers/navigation';
import { waitUntilElementFound } from '../helpers/elements-interactions';
import {
  NORMAL_TXN_TYPE,
  INSTALLMENTS_TXN_TYPE,
  SHEKEL_CURRENCY_SYMBOL,
  SHEKEL_CURRENCY,
  TRANSACTION_STATUS,
} from '../constants';
import getAllMonthMoments from '../helpers/dates';
import { fixInstallments, sortTransactionsByDate, filterOldTransactions } from '../helpers/transactions';

const BASE_URL = 'https://online.leumi-card.co.il';
const DATE_FORMAT = 'DD/MM/YYYY';
const NORMAL_TYPE_NAME = 'רגילה';
const ATM_TYPE_NAME = 'חיוב עסקות מיידי';
const INTERNET_SHOPPING_TYPE_NAME = 'אינטרנט/חו"ל';
const INSTALLMENTS_TYPE_NAME = 'תשלומים';
const MONTHLY_CHARGE_TYPE_NAME = 'חיוב חודשי';
const ONE_MONTH_POSTPONED_TYPE_NAME = 'דחוי חודש';
const THIRTY_DAYS_PLUS_TYPE_NAME = 'עסקת 30 פלוס';
const TWO_MONTHS_POSTPONED_TYPE_NAME = 'דחוי חודשיים';
const MONTHLY_CHARGE_PLUS_INTEREST_TYPE_NAME = 'חודשי + ריבית';

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
    case MONTHLY_CHARGE_TYPE_NAME:
    case ONE_MONTH_POSTPONED_TYPE_NAME:
    case THIRTY_DAYS_PLUS_TYPE_NAME:
    case TWO_MONTHS_POSTPONED_TYPE_NAME:
    case INTERNET_SHOPPING_TYPE_NAME:
    case MONTHLY_CHARGE_PLUS_INTEREST_TYPE_NAME:
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
      memo: txn.comments,
      installments: getInstallmentsInfo(txn.comments),
      status: TRANSACTION_STATUS.COMPLETED,
    };
  });
}

async function getCardContainers(page) {
  return page.$$('.infoList_holder');
}

async function getCardContainer(page, cardIndex) {
  const cardContainers = await getCardContainers(page);
  const cardContainer = cardContainers[cardIndex];
  return cardContainer;
}

async function getCardSections(page, cardIndex) {
  const cardContainer = await getCardContainer(page, cardIndex);
  const cardSections = await cardContainer.$$('.NotPaddingTable');
  return cardSections;
}

async function getAccountNumber(page, cardIndex) {
  const cardContainer = await getCardContainer(page, cardIndex);
  const infoContainer = await cardContainer.$('.creditCard_name');
  const numberListItems = await infoContainer.$$('li');
  const numberListItem = numberListItems[1];
  const accountNumberStr = await page.evaluate((li) => {
    return li.innerText;
  }, numberListItem);
  const accountNumber = accountNumberStr.replace('(', '').replace(')', '');

  return accountNumber;
}

async function getTransactionsForSection(page, cardIndex, sectionIndex) {
  const cardSections = await getCardSections(page, cardIndex);
  const txnsRows = await cardSections[sectionIndex].$$('.jobs_regular');
  const txns = [];
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

  return txns;
}

async function getNextPageButtonForSection(page, cardIndex, sectionIndex) {
  const cardSections = await getCardSections(page, cardIndex);
  return cardSections[sectionIndex].$('.difdufLeft a');
}

async function getCurrentTransactions(page) {
  const result = {};
  const cardContainers = await getCardContainers(page);

  for (let cardIndex = 0; cardIndex < cardContainers.length; cardIndex += 1) {
    const txns = [];
    const cardSections = await getCardSections(page, cardIndex);
    for (let sectionIndex = 0; sectionIndex < cardSections.length; sectionIndex += 1) {
      let hasNext = true;
      while (hasNext) {
        const sectionTxns = await getTransactionsForSection(page, cardIndex, sectionIndex);
        txns.push(...sectionTxns);

        const nextPageBtn = await getNextPageButtonForSection(page, cardIndex, sectionIndex);
        if (nextPageBtn) {
          await nextPageBtn.click();
          await waitForNavigationAndDomLoad(page);
        } else {
          hasNext = false;
        }
      }
    }

    const accountNumber = await getAccountNumber(page, cardIndex);
    result[accountNumber] = convertTransactions(txns);
  }

  return result;
}

async function fetchTransactionsForMonth(browser, navigateToFunc, monthMoment) {
  const page = await browser.newPage();

  const url = getTransactionsUrl(monthMoment);
  await navigateToFunc(url, page);

  if (page.url() !== url) {
    throw new Error(`Error while trying to navigate to url ${url}`);
  }

  const txns = await getCurrentTransactions(page);
  await page.close();

  return txns;
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

async function fetchTransactions(browser, options, navigateToFunc) {
  const defaultStartMoment = moment().subtract(1, 'years');
  const startDate = options.startDate || defaultStartMoment.toDate();
  const startMoment = moment.max(defaultStartMoment, moment(startDate));
  const allMonths = getAllMonthMoments(startMoment, false);

  const allTasks = [];
  for (let i = 0; i < allMonths.length; i += 1) {
    const task = fetchTransactionsForMonth(browser, navigateToFunc, allMonths[i]);
    allTasks.push(task);
  }

  const task = fetchTransactionsForMonth(browser, navigateToFunc);
  allTasks.push(task);

  const allTasksResults = await Promise.all(allTasks);
  const allResults = allTasksResults.reduce((obj, result) => {
    return addResult(obj, result);
  }, {});

  Object.keys(allResults).forEach((accountNumber) => {
    let txns = allResults[accountNumber];
    txns = prepareTransactions(txns, startMoment, options.combineInstallments);
    allResults[accountNumber] = txns;
  });

  return allResults;
}

function getPossibleLoginResults() {
  const urls = {};
  urls[LOGIN_RESULT.SUCCESS] = [`${BASE_URL}/Registred/HomePage.aspx`];
  urls[LOGIN_RESULT.CHANGE_PASSWORD] = [`${BASE_URL}/Anonymous/Login/PasswordExpired.aspx`];
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
    const results = await fetchTransactions(this.browser, this.options, this.navigateTo);
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
}

export default LeumiCardScraper;
