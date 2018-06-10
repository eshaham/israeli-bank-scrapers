import moment from 'moment';
import { BaseScraperWithBrowser, LOGIN_RESULT } from './base-scraper-with-browser';
import { dropdownSelect, fillInput, clickButton, waitUntilElementFound } from '../helpers/elements-interactions';
import { waitForNavigation } from '../helpers/navigation';
import { SHEKEL_CURRENCY, NORMAL_TXN_TYPE, TRANSACTION_STATUS } from '../constants';

const BASE_URL = 'https://hb2.bankleumi.co.il/';
const DATE_FORMAT = 'DD/MM/YY';

function getTransactionsUrl() {
  return `${BASE_URL}/ebanking/Accounts/ExtendedActivity.aspx?WidgetPar=1#/`;
}

function getPossibleLoginResults() {
  const urls = {};
  urls[LOGIN_RESULT.SUCCESS] = /ebanking\/SO\/SPA.aspx/;
  urls[LOGIN_RESULT.INVALID_PASSWORD] = /InternalSite\/CustomUpdate\/leumi\/LoginPage.ASP/;
  // urls[LOGIN_RESULT.CHANGE_PASSWORD] = ``; // TODO should wait until my password expires
  return urls;
}

function createLoginFields(credentials) {
  return [
    { selector: '#wtr_uid', value: credentials.username },
    { selector: '#wtr_password', value: credentials.password },
  ];
}

function getAmountData(amountStr) {
  const amountStrCopy = amountStr.replace(',', '');
  const amount = parseFloat(amountStrCopy);
  const currency = SHEKEL_CURRENCY;

  return {
    amount,
    currency,
  };
}

function convertTransactions(txns) {
  return txns.map((txn) => {
    const txnDate = moment(txn.date, DATE_FORMAT).toISOString();

    const credit = getAmountData(txn.credit).amount;
    const debit = getAmountData(txn.debit).amount;
    const amount = (Number.isNaN(credit) ? 0 : credit) - (Number.isNaN(debit) ? 0 : debit);
    return {
      type: NORMAL_TXN_TYPE,
      identifier: txn.reference ? parseInt(txn.reference, 10) : null,
      date: txnDate,
      processedDate: txnDate,
      originalAmount: amount,
      originalCurrency: SHEKEL_CURRENCY,
      chargedAmount: amount,
      status: txn.status,
      description: txn.description,
      memo: txn.memo,
    };
  });
}

async function extractCompletedTransactionsFromPage(page) {
  const txns = [];

  const tdsValues = await page.$$eval('#WorkSpaceBox #ctlActivityTable tr td', (tds) => {
    return tds.map(td =>
      ({
        classList: td.getAttribute('class'),
        innerText: td.innerText,
      }));
  });

  for (const element of tdsValues) {
    if (element.classList.includes('ExtendedActivityColumnDate')) {
      const newTransaction = { status: TRANSACTION_STATUS.COMPLETED };
      newTransaction.date = (element.innerText || '').trim();
      txns.push(newTransaction);
    } else if (element.classList.includes('ActivityTableColumn1LTR')
      || element.classList.includes('ActivityTableColumn1')) {
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

async function extractPendingTransactionsFromPage(page) {
  const txns = [];

  const tdsValues = await page.$$eval('#WorkSpaceBox #trTodayActivityNapaTableUpper tr td', (tds) => {
    return tds.map(td =>
      ({
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

async function fetchTransactionsForAccount(page, startDate) {
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
  await clickButton(page, 'a#lnkCtlExpandAll');

  const selectedSnifAccount = await page.$eval('#ddlAccounts_m_ddl option[selected="selected"]', (option) => {
    return option.innerText;
  });

  const accountNumber = selectedSnifAccount.replace('/', '_');

  const pendingTxns = await extractPendingTransactionsFromPage(page);
  const completedTxns = await extractCompletedTransactionsFromPage(page);
  const txns = [
    ...pendingTxns,
    ...completedTxns,
  ];

  return {
    accountNumber,
    txns: convertTransactions(txns),
  };
}

async function fetchTransactions(page, startDate) {
  // TODO need to extend to support multiple accounts and foreign accounts
  return [await fetchTransactionsForAccount(page, startDate)];
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

    const url = getTransactionsUrl();
    await this.navigateTo(url);

    const accounts = await fetchTransactions(this.page, startMoment);

    return {
      success: true,
      accounts,
    };
  }
}

export default LeumiScraper;
