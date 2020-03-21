import moment from 'moment';
import _ from 'lodash';
import {
  NORMAL_TXN_TYPE,
  TRANSACTION_STATUS,
  INSTALLMENTS_TXN_TYPE,
} from '../../constants';
import { convertCurrency } from './adapter-helpers/currency';
import { HEADER_SITE, BASE_URL, DATE_FORMAT } from './definitions';
import { getBankDebitsUrl, getTransactionsUrl } from './adapter-helpers/urls';
import { filterOldTransactions, fixInstallments, sortTransactionsByDate } from '../../helpers/transactions';
import { fetchGet } from '../../helpers/fetch';
import { validateInThePastYear } from '../../helpers/dates';

const NO_DATA_FOUND_MSG = 'לא נמצאו חיובים לטווח תאריכים זה';

const NORMAL_TYPE_CODE = '5';
const REFUND_TYPE_CODE = '6';
const WITHDRAWAL_TYPE_CODE = '7';
const INSTALLMENTS_TYPE_CODE = '8';
const CANCEL_TYPE_CODE = '25';
const WITHDRAWAL_TYPE_CODE_2 = '27';
const CREDIT_PAYMENTS_CODE = '59';
const MEMBERSHIP_FEE_TYPE_CODE = '67';
const SERVICES_REFUND_TYPE_CODE = '71';
const SERVICES_TYPE_CODE = '72';
const REFUND_TYPE_CODE_2 = '76';

function convertTransactionType(txnType) {
  switch (txnType) {
    case NORMAL_TYPE_CODE:
    case REFUND_TYPE_CODE:
    case CANCEL_TYPE_CODE:
    case WITHDRAWAL_TYPE_CODE:
    case WITHDRAWAL_TYPE_CODE_2:
    case REFUND_TYPE_CODE_2:
    case SERVICES_REFUND_TYPE_CODE:
    case MEMBERSHIP_FEE_TYPE_CODE:
    case SERVICES_TYPE_CODE:
      return NORMAL_TXN_TYPE;
    case INSTALLMENTS_TYPE_CODE:
    case CREDIT_PAYMENTS_CODE:
      return INSTALLMENTS_TXN_TYPE;
    default:
      throw new Error(`unknown transaction type ${txnType}`);
  }
}

function getInstallmentsInfo(txn) {
  if (!txn.CurrentPayment || txn.CurrentPayment === '0') {
    return null;
  }

  return {
    number: parseInt(txn.CurrentPayment, 10),
    total: parseInt(txn.TotalPayments, 10),
  };
}

function getTransactionMemo(txn) {
  const { TransType: txnType, TransTypeDesc: txnTypeDescription } = txn;
  switch (txnType) {
    case NORMAL_TYPE_CODE:
      return txnTypeDescription === 'רכישה רגילה' ? '' : txnTypeDescription;
    case INSTALLMENTS_TYPE_CODE:
      return `תשלום ${txn.CurrentPayment} מתוך ${txn.TotalPayments}`;
    default:
      return txn.TransTypeDesc;
  }
}

function convertTransactions(txns) {
  return txns.map((txn) => {
    return {
      type: convertTransactionType(txn.TransType),
      date: moment(txn.Date, DATE_FORMAT).toISOString(),
      processedDate: moment(txn.DebitDate, DATE_FORMAT).toISOString(),
      originalAmount: -txn.Amount.Value,
      originalCurrency: convertCurrency(txn.Amount.Symbol),
      chargedAmount: -txn.DebitAmount.Value,
      description: txn.MerchantDetails.Name,
      memo: getTransactionMemo(txn),
      installments: getInstallmentsInfo(txn),
      status: TRANSACTION_STATUS.COMPLETED,
    };
  });
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

async function getBankDebits(authHeader, accountId) {
  const fromDate = moment().subtract(6, 'months');
  const bankDebitsUrl = getBankDebitsUrl(accountId, fromDate);
  return fetchGet(bankDebitsUrl, authHeader);
}

async function getTransactionsNextPage(authHeader) {
  const hasNextPageUrl = `${BASE_URL}/CalTransNextPage`;
  return fetchGet(hasNextPageUrl, authHeader);
}

async function fetchTxns(authHeader, cardId, debitDates) {
  const txns = [];
  for (const date of debitDates) {
    const fetchTxnUrl = getTransactionsUrl(cardId, date);
    let txnResponse = await fetchGet(fetchTxnUrl, authHeader);
    if (txnResponse.Transactions) {
      txns.push(...txnResponse.Transactions);
    }
    while (txnResponse.HasNextPage) {
      txnResponse = await getTransactionsNextPage(authHeader);
      if (txnResponse.Transactions != null) {
        txns.push(...txnResponse.Transactions);
      }
    }
  }
  return txns;
}

async function getTxnsOfCard(authHeader, card, bankDebits) {
  const cardId = card.Id;
  const cardDebitDates = bankDebits.filter((bankDebit) => {
    return bankDebit.CardId === cardId;
  }).map((cardDebit) => {
    return cardDebit.Date;
  });
  return fetchTxns(authHeader, cardId, cardDebitDates);
}

async function getTransactionsForAllAccounts(authHeader, startMoment, options) {
  const cardsByAccountUrl = `${BASE_URL}/CardsByAccounts`;
  const banksResponse = await fetchGet(cardsByAccountUrl, authHeader);

  if (!_.get(banksResponse, 'Response.Status.Succeeded')) {
    return new Error('failed to get bank accounts list');
  }

  const accounts = [];
  for (let i = 0; i < banksResponse.BankAccounts.length; i += 1) {
    const bank = banksResponse.BankAccounts[i];
    const bankDebits = await getBankDebits(authHeader, bank.AccountID);
    // Check that the bank has an active card to scrape
    if (bank.Cards.some((card) => card.IsEffectiveInd)) {
      if (_.get(bankDebits, 'Response.Status.Succeeded')) {
        for (let j = 0; j < bank.Cards.length; j += 1) {
          const rawTxns = await getTxnsOfCard(authHeader, bank.Cards[j], bankDebits.Debits);
          if (rawTxns) {
            let txns = convertTransactions(rawTxns);
            txns = prepareTransactions(txns, startMoment, options.combineInstallments);
            const result = {
              accountNumber: bank.Cards[j].LastFourDigits,
              txns,
            };
            accounts.push(result);
          }
        }
      } else {
        const { Description, Message } = bankDebits.Response.Status;

        if (Message !== NO_DATA_FOUND_MSG) {
          const message = `${Description}. ${Message}`;
          throw new Error(message);
        }
      }
    }
  }
  return accounts;
}

function scrapeTransactionsAdapter(options) {
  return {
    name: 'scrapeTransactions(visaCal)',
    validate: (context) => {
      const result = [];
      const [startDateValidationMessage] = validateInThePastYear(options.startDate);

      if (startDateValidationMessage) {
        result.push(startDateValidationMessage);
      }

      if (!context.hasSessionData('visaCal.authHeader')) {
        result.push('expected \'visaCal.authHeader\' to be provided by prior adapter');
      }

      return result;
    },
    action: async (context) => {
      const defaultStartMoment = moment().subtract(1, 'years');
      const startDate = options.startDate || defaultStartMoment.toDate();
      const startMoment = moment.max(defaultStartMoment, moment(startDate));

      const authHeader = {
        Authorization: context.getSessionData('visaCal.authHeader'),
        ...HEADER_SITE,
      };
      const accounts = await getTransactionsForAllAccounts(authHeader, startMoment, options);

      return {
        data: {
          visaCal: {
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
