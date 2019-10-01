import moment from 'moment';
import {
  clickButton,
  elementPresentOnPage,
  pageEvalAll,
} from '../../helpers/elements-interactions';
import { SHEKEL_CURRENCY, NORMAL_TXN_TYPE, TRANSACTION_STATUS } from '../../constants';
import { mapAccounts, navigateToAccountTransactions } from './adapterHelpers/accounts';
import { DATE_FORMAT } from './definitions';

const NO_TRANSACTION_IN_DATE_RANGE_TEXT = 'לא קיימות תנועות מתאימות על פי הסינון שהוגדר';


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

async function extractCompletedTransactionsFromPage(page) {
  const txns = [];
  const tdsValues = await pageEvalAll(page, '#WorkSpaceBox #ctlActivityTable tr td', [], (tds) => {
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

async function extractPendingTransactionsFromPage(page) {
  const txns = [];
  const tdsValues = await pageEvalAll(page, '#WorkSpaceBox #ctlTodayActivityTableUpper tr td', [], (tds) => {
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

/**
 *
 * @param page
 * @param options { startDate, accountId, accountName }
 * @returns {Promise<{accountNumber: string, txns: *}>}
 */
async function fetchTransactionsForAccount(page, options) {
  await navigateToAccountTransactions(page, options);

  if (await isNoTransactionInDateRangeError(page)) {
    return {
      accountNumber: options.accountName,
      txns: [],
    };
  }

  const hasExpandAllButton = await elementPresentOnPage(page, 'a#lnkCtlExpandAllInPage');

  if (hasExpandAllButton) {
    await clickButton(page, 'a#lnkCtlExpandAllInPage');
  }

  const pendingTxns = await extractPendingTransactionsFromPage(page);
  const completedTxns = await extractCompletedTransactionsFromPage(page);
  const txns = [
    ...pendingTxns,
    ...completedTxns,
  ];

  return {
    accountNumber: options.accountName,
    txns: convertTransactions(txns),
  };
}

async function fetchTransactions(page, startDate) {
  return mapAccounts(page, async (page, { accountName, accountValue }) => {
    return fetchTransactionsForAccount(page, { startDate, accountName, accountValue });
  });
}

function scrapeTransactionsAdapter(options) {
  return {
    name: 'scrapeTransactions(leumi)',
    validate: (context) => {
      const result = [];

      if (!options.startDate) {
        result.push('expected startDate to be provided by options');
      }

      if (!context.hasSessionData('puppeteer.page')) {
        result.push('expected puppeteer page to be provided by prior adapter');
      }

      return result;
    },
    action: async (context) => {
      const page = context.getSessionData('puppeteer.page');

      const defaultStartMoment = moment().subtract(1, 'years').add(1, 'day');
      const startMoment = moment.max(defaultStartMoment, moment(options.startDate));

      const accounts = await fetchTransactions(page, startMoment);

      return {
        data: {
          leumi: {
            transactions: {
              accounts,
            },
          },
        },
      };
    },
  };
}

export default scrapeTransactionsAdapter;
