import moment from 'moment';
import { BaseScraperWithBrowser, LOGIN_RESULT } from './base-scraper-with-browser';
import {
  dropdownSelect,
  fillInput,
  clickButton,
  waitUntilElementFound,
  pageEvalAll,
  pageEval,
} from '../helpers/elements-interactions';
import { waitForNavigation, navigateTo } from '../helpers/navigation';
import {
  SHEKEL_CURRENCY,
  NORMAL_TXN_TYPE,
  TRANSACTION_STATUS,
  DOLLAR_CURRENCY,
} from '../constants';

const DOLLAR_CURRENCY_LABEL = "דולר ארה''ב";
const BASE_URL = 'https://hb2.bankleumi.co.il/';
const DATE_FORMAT = 'DD/MM/YY';

function getPossibleLoginResults() {
  const urls = {};
  urls[LOGIN_RESULT.SUCCESS] = [/ebanking\/SO\/SPA.aspx/];
  urls[LOGIN_RESULT.INVALID_PASSWORD] = [/InternalSite\/CustomUpdate\/leumi\/LoginPage.ASP/];
  // urls[LOGIN_RESULT.CHANGE_PASSWORD] = ``; // TODO should wait until my password expires
  return urls;
}

function createLoginFields(credentials) {
  return [
    { selector: '#wtr_uid', value: credentials.username },
    { selector: '#wtr_password', value: credentials.password },
  ];
}

function parseAmount(amountStr) {
  if (typeof amountStr === 'number') {
    return amountStr;
  }

  if (typeof amountStr === 'undefined' || amountStr === null ||
    (typeof amountStr === 'string' && amountStr.trim().length === 0)) {
    return null;
  }

  const formattedAmount = amountStr
    .replace(',', '')
    .trim();

  const amount = parseFloat(formattedAmount);

  if (!Number.isFinite(amount) || Number.isNaN(amount)) {
    throw new Error(`cannot parse amount, failed to parse amount '${amountStr}'`);
  }

  return amount;
}

function convertTransactions(txns, currency) {
  return txns.map((txn) => {
    const txnDate = moment(txn.date, DATE_FORMAT).toISOString();

    const credit = parseAmount(txn.credit);
    const debit = parseAmount(txn.debit);
    const amount = (Number.isNaN(credit) ? 0 : credit) - (Number.isNaN(debit) ? 0 : debit);
    return {
      type: NORMAL_TXN_TYPE,
      identifier: txn.reference ? parseInt(txn.reference, 10) : null,
      date: txnDate,
      processedDate: txnDate,
      originalAmount: amount,
      originalCurrency: currency,
      chargedAmount: amount,
      chargedCurrency: currency,
      status: txn.status,
      description: txn.description,
      memo: txn.memo,
    };
  });
}

async function fetchCompletedTransactionsForLocalAccount(page) {
  const txns = [];
  const tdsValues = await pageEvalAll(page, '#WorkSpaceBox #ctlActivityTable tr td', (tds) => {
    return tds.map(td => ({
      classList: td.getAttribute('class'),
      innerText: td.innerText,
    }));
  });

  for (const element of tdsValues) {
    if (element.classList.includes('ExtendedActivityColumnDate')) {
      const newTransaction = { status: TRANSACTION_STATUS.COMPLETED };
      newTransaction.date = (element.innerText || '').trim();
      txns.push(newTransaction);
    } else if (element.classList.includes('ActivityTableColumn1LTR') || element.classList.includes('ActivityTableColumn1')) {
      const changedTransaction = txns.pop();
      changedTransaction.description = element.innerText;
      txns.push(changedTransaction);
    } else if (element.classList.includes('ReferenceNumberUniqeClass')) {
      const changedTransaction = txns.pop();
      changedTransaction.reference = element.innerText;
      txns.push(changedTransaction);
    } else if (element.classList.includes('AmountDebitUniqeClass')) {
      const changedTransaction = txns.pop();
      changedTransaction.debit = element.innerText;
      txns.push(changedTransaction);
    } else if (element.classList.includes('AmountCreditUniqeClass')) {
      const changedTransaction = txns.pop();
      changedTransaction.credit = element.innerText;
      txns.push(changedTransaction);
    } else if (element.classList.includes('number_column')) {
      const changedTransaction = txns.pop();
      changedTransaction.balance = element.innerText;
      txns.push(changedTransaction);
    } else if (element.classList.includes('tdDepositRowAdded')) {
      const changedTransaction = txns.pop();
      changedTransaction.memo = (element.innerText || '').trim();
      txns.push(changedTransaction);
    }
  }

  return txns;
}

async function fetchPendingTransactionsForLocalAccount(page) {
  const txns = [];
  const tdsValues = await pageEvalAll(page, '#WorkSpaceBox #trTodayActivityNapaTableUpper tr td', (tds) => {
    return tds.map(td => ({
      classList: td.getAttribute('class'),
      innerText: td.innerText,
    }));
  });

  for (const element of tdsValues) {
    if (element.classList.includes('Colume1Width')) {
      const newTransaction = { status: TRANSACTION_STATUS.PENDING };
      newTransaction.date = (element.innerText || '').trim();
      txns.push(newTransaction);
    } else if (element.classList.includes('Colume2Width')) {
      const changedTransaction = txns.pop();
      changedTransaction.description = element.innerText;
      txns.push(changedTransaction);
    } else if (element.classList.includes('Colume3Width')) {
      const changedTransaction = txns.pop();
      changedTransaction.reference = element.innerText;
      txns.push(changedTransaction);
    } else if (element.classList.includes('Colume4Width')) {
      const changedTransaction = txns.pop();
      changedTransaction.debit = element.innerText;
      txns.push(changedTransaction);
    } else if (element.classList.includes('Colume5Width')) {
      const changedTransaction = txns.pop();
      changedTransaction.credit = element.innerText;
      txns.push(changedTransaction);
    } else if (element.classList.includes('Colume6Width')) {
      const changedTransaction = txns.pop();
      changedTransaction.balance = element.innerText;
      txns.push(changedTransaction);
    }
  }

  return txns;
}

async function fetchTransactionsForLocalAccount(page, startDate) {
  // TODO need to extend to support multiple accounts
  const url = `${BASE_URL}/ebanking/Accounts/ExtendedActivity.aspx?WidgetPar=1#/`;
  await navigateTo(page, url);

  await dropdownSelect(page, 'select#ddlTransactionPeriod', '004');
  await waitUntilElementFound(page, 'select#ddlTransactionPeriod');
  await fillInput(
    page,
    'input#dtFromDate_textBox',
    startDate.format(DATE_FORMAT),
  );
  await clickButton(page, 'input#btnDisplayDates');
  await waitForNavigation(page);
  await waitUntilElementFound(page, 'table#WorkSpaceBox table#ctlActivityTable');
  await clickButton(page, 'a#lnkCtlExpandAllInPage');

  const selectedSnifAccount = await page.$eval('#ddlAccounts_m_ddl option[selected="selected"]', (option) => {
    return option.innerText;
  });

  const accountNumber = selectedSnifAccount.replace('/', '_');

  const pendingTxns = await fetchPendingTransactionsForLocalAccount(page);
  const completedTxns = await fetchCompletedTransactionsForLocalAccount(page);
  const txns = [
    ...pendingTxns,
    ...completedTxns,
  ];

  return {
    accountNumber,
    txns: convertTransactions(txns, SHEKEL_CURRENCY),
  };
}

async function fetchCompletedTransactionsForForeignAccount(page) {
  const txns = [];
  const txnsRows = await pageEvalAll(page, 'table#ctlActivityTable tr');

  for (let txnIndex = 0; txnIndex < txnsRows.length; txnIndex += 1) {
    const txnColumns = await pageEvalAll(txnsRows[txnIndex], 'td', (tds) => {
      return tds.map(td => (td.innerText || '').trim());
    });

    if (txnColumns.length > 0) {
      const txn = {
        date: txnColumns[0],
        description: txnColumns[1],
        reference: txnColumns[2],
        debit: txnColumns[3],
        credit: txnColumns[4],
        status: TRANSACTION_STATUS.COMPLETED,
      };
      txns.push(txn);
    }
  }

  return txns;
}
async function fetchForeignAccountsList(page) {
  const accounts = [];
  const accountRows = await pageEvalAll(page, 'table#ctlForeignAccounts tr.item');

  for (let accountRowIndex = 0; accountRowIndex < accountRows.length; accountRowIndex += 1) {
    const accountUrl = await pageEval(accountRows[accountRowIndex], 'td.ForeignColumn1 a', (anchor) => {
      return anchor.getAttribute('href');
    });

    const accountCurrencyLabel = await pageEval(accountRows[accountRowIndex], 'td.ForeignColumn2 span', (span) => {
      return span.innerText;
    });

    let currency = null;
    switch (accountCurrencyLabel) {
      case DOLLAR_CURRENCY_LABEL:
        currency = DOLLAR_CURRENCY;
        break;
      default:
        throw new Error(`failed to extract foreign account transactions, unknown currency '${accountCurrencyLabel}'`);
    }

    if (accountUrl) {
      accounts.push({
        url: accountUrl,
        currency,
      });
    }
  }

  return accounts;
}

async function fetchTransactionsForForeignAccounts(page, startDate) {
  const result = [];
  const url = `${BASE_URL}/ebanking/Accounts/ExtendedSummary.aspx?DisplayType=2&from=sideMenu`;
  await navigateTo(page, url);

  const selectedSnifAccount = await page.$eval('#ddlClientNumber_m_ddl option[selected="selected"]', (option) => {
    return option.innerText;
  });

  const accountNumber = selectedSnifAccount.replace('/', '_');
  const accounts = await fetchForeignAccountsList(page);

  for (let accountIndex = 0; accountIndex < accounts.length; accountIndex += 1) {
    const account = accounts[accountIndex];
    await navigateTo(page, `${BASE_URL}${account.url}`);

    await dropdownSelect(page, 'select#ddlTransactionPeriod', '3');
    await waitUntilElementFound(page, 'select#ddlTransactionPeriod');
    await fillInput(
      page,
      'input#dtFromDate_textBox',
      startDate.format(DATE_FORMAT),
    );
    await clickButton(page, 'input#btnDisplayDates');
    await waitForNavigation(page);
    await waitUntilElementFound(page, 'div#WorkSpaceBox > table:first-child');

    const txns = await fetchCompletedTransactionsForForeignAccount(page);

    result.push({
      accountNumber,
      txns: convertTransactions(txns, account.currency),
    });
  }

  return result;
}

async function fetchTransactions(page, startDate) {
  return [
    await fetchTransactionsForLocalAccount(page, startDate),
    ...await fetchTransactionsForForeignAccounts(page, startDate),
  ];
}

async function waitForPostLogin(page) {
  // TODO check for condition to provide new password
  return Promise.race([
    waitUntilElementFound(page, 'div.leumi-container', true),
    waitUntilElementFound(page, '#loginErrMsg', true),
  ]);
}

class LeumiScraper extends BaseScraperWithBrowser {
  getLoginOptions(credentials) {
    return {
      loginUrl: `${BASE_URL}`,
      fields: createLoginFields(credentials),
      submitButtonSelector: '#enter',
      postAction: async () => waitForPostLogin(this.page),
      possibleResults: getPossibleLoginResults(),
    };
  }

  async fetchData() {
    const defaultStartMoment = moment().subtract(1, 'years').add(1, 'day');
    const startDate = this.options.startDate || defaultStartMoment.toDate();
    const startMoment = moment.max(defaultStartMoment, moment(startDate));

    const accounts = await fetchTransactions(this.page, startMoment);

    return {
      success: true,
      accounts,
    };
  }
}

export default LeumiScraper;
