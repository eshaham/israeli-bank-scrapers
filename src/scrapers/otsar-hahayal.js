import moment from 'moment';
import { BaseScraperWithBrowser, LOGIN_RESULT } from './base-scraper-with-browser';
import { waitForNavigation } from '../helpers/navigation';
import {
  fillInput,
  clickButton,
  waitUntilElementFound,
  pageEvalAll,
} from '../helpers/elements-interactions';
import { SHEKEL_CURRENCY, NORMAL_TXN_TYPE, SHEKEL_CURRENCY_SYMBOL } from '../constants';

const BASE_URL = 'https://online.bankotsar.co.il';
const DATE_FORMAT = 'DD/MM/YY';

function getPossibleLoginResults() {
  const urls = {};
  urls[LOGIN_RESULT.SUCCESS] = [`${BASE_URL}/wps/myportal/FibiMenu/Online`];
  urls[LOGIN_RESULT.INVALID_PASSWORD] = [`${BASE_URL}/LoginServices/login2.do`];
  // TODO: support change password
  /* urls[LOGIN_RESULT.CHANGE_PASSWORD] = [``]; */
  return urls;
}

function getTransactionsUrl() {
  return `${BASE_URL}/wps/myportal/FibiMenu/Online/OnAccountMngment/OnBalanceTrans/PrivateAccountFlow`;
}

function createLoginFields(credentials) {
  return [
    { selector: '#username', value: credentials.username },
    { selector: '#password', value: credentials.password },
  ];
}

function getAmountData(amountStr, hasCurrency = false) {
  const amountStrCln = amountStr.replace(',', '');
  let currency = null;
  let amount = null;
  if (!hasCurrency) {
    amount = parseFloat(amountStrCln);
    currency = SHEKEL_CURRENCY;
  } else if (amountStrCln.includes(SHEKEL_CURRENCY_SYMBOL)) {
    amount = parseFloat(amountStrCln.replace(SHEKEL_CURRENCY_SYMBOL, ''));
    currency = SHEKEL_CURRENCY;
  } else {
    const parts = amountStrCln.split(' ');
    amount = parseFloat(parts[0]);
    [, currency] = parts;
  }

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
      description: txn.description,
    };
  });
}

async function parseTransactionPage(page) {
  const tdsValues = await pageEvalAll(page, '#dataTable077 tbody tr td', (tds) => {
    return tds.map(td => ({
      classList: td.getAttribute('class'),
      innerText: td.innerText,
    }));
  });

  const txns = [];
  for (const element of tdsValues) {
    const { classList, innerText } = element;
    if (classList.includes('date')) {
      const newTransaction = {};
      newTransaction.date = innerText;
      txns.push(newTransaction);
    } else {
      const changedTransaction = txns.pop();
      if (classList.includes('reference')) {
        changedTransaction.description = innerText;
      } else if (classList.includes('details')) {
        changedTransaction.reference = innerText;
      } else if (classList.includes('credit')) {
        changedTransaction.credit = innerText;
      } else if (classList.includes('debit')) {
        changedTransaction.debit = innerText;
      } else if (classList.includes('balance')) {
        changedTransaction.balance = innerText;
      }
      txns.push(changedTransaction);
    }
  }

  return txns;
}

async function getAccountSummary(page) {
  const balanceElm = await page.$('.current_balance');
  const balanceInnerTextElm = await balanceElm.getProperty('innerText');
  const balanceText = await balanceInnerTextElm.jsonValue();
  const balanceValue = getAmountData(balanceText, true);
  // TODO: Find the credit field in bank website (could see it in my account)
  return {
    balance: Number.isNaN(balanceValue.amount) ? 0 : balanceValue.amount,
    creditLimit: 0.0,
    creditUtilization: 0.0,
    balanceCurrency: balanceValue.currency,
  };
}

async function fetchTransactionsForAccount(page, startDate) {
  const summary = await getAccountSummary(page);
  await waitUntilElementFound(page, 'input#fromDate');
  // Get account number
  const branchNum = await page.$eval('.branch_num', (span) => {
    return span.innerText;
  });

  const accountNmbr = await page.$eval('.acc_num', (span) => {
    return span.innerText;
  });
  const accountNumber = `14-${branchNum}-${accountNmbr}`;
  // Search for relavant transaction from startDate
  await clickButton(page, '#tabHeader4');
  await fillInput(
    page,
    'input#fromDate',
    startDate.format('DD/MM/YYYY'),
  );

  await clickButton(page, '#fibi_tab_dates .fibi_btn:nth-child(2)');
  await waitForNavigation(page);
  await waitUntilElementFound(page, 'table#dataTable077, #NO_DATA077');
  let hasNextPage = true;
  let txns = [];

  const noTransactionElm = await page.$('#NO_DATA077');
  if (noTransactionElm == null) {
    // Scape transactions (this maybe spanned on multiple pages)
    while (hasNextPage) {
      const pageTxns = await parseTransactionPage(page);
      txns = txns.concat(pageTxns);
      const button = await page.$('#Npage');
      hasNextPage = false;
      if (button != null) {
        hasNextPage = true;
      }
      if (hasNextPage) {
        await clickButton(page, '#Npage');
        await waitForNavigation(page);
        await waitUntilElementFound(page, 'table#dataTable077');
      }
    }
  }

  return {
    accountNumber,
    summary,
    txns: convertTransactions(txns.slice(1)), // Remove first line which is "opening balance"
  };
}

async function fetchTransactions(page, startDate) {
  // TODO need to extend to support multiple accounts and foreign accounts
  return [await fetchTransactionsForAccount(page, startDate)];
}

async function waitForPostLogin(page) {
  // TODO check for condition to provide new password
  return Promise.race([
    waitUntilElementFound(page, 'div.lotusFrame', true),
    waitUntilElementFound(page, 'div.fibi_pwd_error', true),
  ]);
}

class OtsarHahayalScraper extends BaseScraperWithBrowser {
  getLoginOptions(credentials) {
    return {
      loginUrl: `${BASE_URL}/LoginServices/login2.do?bankId=OTSARPRTAL`,
      fields: createLoginFields(credentials),
      submitButtonSelector: '#login_btn',
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

export default OtsarHahayalScraper;
