import moment from 'moment';
import { BaseScraperWithBrowser, LOGIN_RESULT } from './base-scraper-with-browser';
import {
  dropdownSelect,
  dropdownElements,
  fillInput,
  clickButton,
  waitUntilElementFound,
  pageEvalAll,
  elementPresentOnPage,
} from '../helpers/elements-interactions';
import { waitForNavigation } from '../helpers/navigation';
import { SHEKEL_CURRENCY, NORMAL_TXN_TYPE, TRANSACTION_STATUS } from '../constants';

const BASE_URL = 'https://hb.unionbank.co.il';
const DATE_FORMAT = 'DD/MM/YY';
const NO_TRANSACTION_IN_DATE_RANGE_TEXT = 'לא קיימות תנועות מתאימות על פי הסינון שהוגדר ';
const DATE_HEADER = 'תאריך';
const DESCRIPTION_HEADER = 'תיאור';
const REFERENCE_HEADER = 'אסמכתא';
const DEBIT_HEADER = 'חובה';
const CREDIT_HEADER = 'זכות';
const PENDING_TRANSACTIONS_TABLE_ID = 'trTodayActivityNapaTableUpper';
const COMPLETED_TRANSACTIONS_TABLE_ID = 'ctlActivityTable';
let transactionsTableHeaders = null;

function getTransactionsUrl() {
  return `${BASE_URL}/eBanking/Accounts/ExtendedActivity.aspx#/`;
}

function getPossibleLoginResults() {
  const urls = {};
  urls[LOGIN_RESULT.SUCCESS] = [/eBanking\/Accounts/];
  urls[LOGIN_RESULT.INVALID_PASSWORD] = [/InternalSite\/CustomUpdate\/leumi\/LoginPage.ASP/];
  // urls[LOGIN_RESULT.CHANGE_PASSWORD] = ``; // TODO should wait until my password expires
  return urls;
}

function createLoginFields(credentials) {
    return [
        {selector: '#uid', value: credentials.username},
        {selector: '#password', value: credentials.password},
    ];
}

function getAmountData(amountStr) {
  const amountStrCopy = amountStr.replace(',', '');
  return parseFloat(amountStrCopy);
}

function getTxnAmount(txn) {
    const credit = getAmountData(txn.credit);
    const debit = getAmountData(txn.debit);
    return (Number.isNaN(credit) ? 0 : credit) - (Number.isNaN(debit) ? 0 : debit);
}

function convertTransactions(txns) {
    return txns.map((txn) => {
        const convertedDate = moment(txn.date, DATE_FORMAT).toISOString();
        const convertedAmount = getTxnAmount(txn);
        return {
            type: NORMAL_TXN_TYPE,
            identifier: txn.reference ? parseInt(txn.reference, 10) : null,
            date: convertedDate,
            processedDate: convertedDate,
            originalAmount: convertedAmount,
            originalCurrency: SHEKEL_CURRENCY,
            chargedAmount: convertedAmount,
            status: txn.status,
            description: txn.description,
            memo: txn.memo,
        };
    });
}

function getTransactionDate(tds, txnsTableHeaders, txnDetailsObj) {
    txnDetailsObj.date = tds[txnsTableHeaders[DATE_HEADER]].trim();
}

function getTransactionDescription(tds, txnsTableHeaders, txnDetailsObj) {
    txnDetailsObj.description = tds[txnsTableHeaders[DESCRIPTION_HEADER]].trim();
}

function getTransactionReference(tds, txnsTableHeaders, txnDetailsObj) {
    txnDetailsObj.reference = tds[txnsTableHeaders[REFERENCE_HEADER]].trim();
}

function getTransactionDebit(tds, txnsTableHeaders, txnDetailsObj) {
    txnDetailsObj.debit = tds[txnsTableHeaders[DEBIT_HEADER]].trim();
}

function getTransactionCredit(tds, txnsTableHeaders, txnDetailsObj) {
    txnDetailsObj.credit = tds[txnsTableHeaders[CREDIT_HEADER]].trim();
}

function extractTransactionDetails(txnRow, txnsTableHeaders, txnStatus) {
    let txnDetailsObj = {status: txnStatus};
    let tds = txnRow.innerTds;
    getTransactionDate(tds, txnsTableHeaders, txnDetailsObj);
    getTransactionDescription(tds, txnsTableHeaders, txnDetailsObj);
    getTransactionReference(tds, txnsTableHeaders, txnDetailsObj);
    getTransactionDebit(tds, txnsTableHeaders, txnDetailsObj);
    getTransactionCredit(tds, txnsTableHeaders, txnDetailsObj);
    return txnDetailsObj;
}

function isExpendedDescRow(txnRow) {
    return txnRow.id !== undefined && txnRow.id !== null && txnRow.id === 'rowAdded';
}

function editLastTransactionDesc(txnRow, lastTxn) {
    lastTxn.description = lastTxn.description + " " + txnRow.innerTds[0];
    return lastTxn;
}

function handleTransactionRow(txns, txnsTableHeaders, txnRow, txnType) {
    if (isExpendedDescRow(txnRow)) {
        txns.push(editLastTransactionDesc(txnRow, txns.pop()))
    } else {
        txns.push(extractTransactionDetails(txnRow, txnsTableHeaders, txnType));
    }
}

async function extractTransactionsFromTable(page, tableTypeId, txnType) {
    const txns = [];
    if(transactionsTableHeaders === null || transactionsTableHeaders.length === 0) {
        transactionsTableHeaders = await getTransactionsTableHeaders(page, tableTypeId);
    }
    const transactionsRows = await pageEvalAll(page, `#WorkSpaceBox #${tableTypeId} tr[class]:not([class='header'])`, [], (trs) => {
        return trs.map( (tr) => ({
            id: tr.getAttribute('id'),
            innerTds: Array.from(tr.getElementsByTagName('td')).map(td => td.innerText)
        }));
    });

    for (const txnRow of transactionsRows) {
        handleTransactionRow(txns, transactionsTableHeaders, txnRow, txnType);
    }
    return txns;
}

async function isNoTransactionInDateRangeError(page) {
  const hasErrorInfoElement = await elementPresentOnPage(page, '.errInfo');
  if (hasErrorInfoElement) {
    const errorText = await page.$eval('.errInfo', (errorElement) => {
      return errorElement.innerText;
    });
    return errorText === NO_TRANSACTION_IN_DATE_RANGE_TEXT;
  }
  return false;
}

async function getTransactionsTableHeaders(page, tableTypeId) {
    let headersMap = [];
    const headersObjs = await pageEvalAll(page, `#WorkSpaceBox #${tableTypeId} tr[class='header'] th`, null, (ths) => {
        return ths.map((th, index) => ({
            text: th.innerText.trim(),
            index: index
        }));
    });

    for(let headerObj of headersObjs) {
        headersMap[headerObj.text] = headerObj.index;
    }
    return headersMap;
}

async function chooseAccount(page, accountId) {
    const hasErrorInfoElement = await elementPresentOnPage(page, 'select#ddlAccounts_m_ddl');
    if (hasErrorInfoElement.offsetParent !== null) {
        await dropdownSelect(page, 'select#ddlAccounts_m_ddl', accountId);
    }
}

async function searchByDates(page, startDate) {
    await dropdownSelect(page, 'select#ddlTransactionPeriod', '004');
    await waitUntilElementFound(page, 'select#ddlTransactionPeriod');
    await fillInput(
        page,
        'input#dtFromDate_textBox',
        startDate.format(DATE_FORMAT),
    );
    await clickButton(page, 'input#btnDisplayDates');
    await waitForNavigation(page);
}

async function getAccountNumber(page) {
    const selectedSnifAccount = await page.$eval('#ddlAccounts_m_ddl option[selected="selected"]', (option) => {
        return option.innerText;
    });

    return selectedSnifAccount.replace('/', '_');
}

async function expandTransactionsTable(page) {
    const hasExpandAllButton = await elementPresentOnPage(page, "a[id*='lnkCtlExpandAll']");
    if (hasExpandAllButton) {
        await clickButton(page, "a[id*='lnkCtlExpandAll']");
    }
}

async function scrapeTransactionsFromTable(page) {
    const pendingTxns = await extractTransactionsFromTable(page, PENDING_TRANSACTIONS_TABLE_ID, TRANSACTION_STATUS.PENDING);
    const completedTxns = await extractTransactionsFromTable(page, COMPLETED_TRANSACTIONS_TABLE_ID, TRANSACTION_STATUS.COMPLETED);
    const txns = [
        ...pendingTxns,
        ...completedTxns,
    ];
    return convertTransactions(txns);
}

async function getAccountTransactions(page) {
    await Promise.race([
        waitUntilElementFound(page, '#ctlActivityTable', false),
        waitUntilElementFound(page, '.errInfo', false),
    ]);
    if (await isNoTransactionInDateRangeError(page)) {
        return [];
    }
    await expandTransactionsTable(page);
    return await scrapeTransactionsFromTable(page);
}

async function fetchAccountData(page, startDate, accountId) {
    await chooseAccount(page, accountId);
    await searchByDates(page, startDate);
    const accountNumber = await getAccountNumber(page);
    const txns = await getAccountTransactions(page);
    return {
        accountNumber,
        txns: txns,
    };
}

async function fetchAccounts(page, startDate) {
  const accounts = [];
  const accountsList = await dropdownElements(page, 'select#ddlAccounts_m_ddl');
  for (const account of accountsList) {
    if (account.value !== '-1') { // Skip "All accounts" option
        accounts.push(await fetchAccountData(page, startDate, account.value));
    }
  }
  return accounts;
}

async function waitForPostLogin(page) {
  // TODO check for condition to provide new password
  return Promise.race([
    waitUntilElementFound(page, '#signoff', true),
    waitUntilElementFound(page, '#restore', true),
  ]);
}

class UnionBankScraper extends BaseScraperWithBrowser {
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

    const accounts = await fetchAccounts(this.page, startMoment);

    return {
      success: true,
      accounts,
    };
  }
}

export default UnionBankScraper;
