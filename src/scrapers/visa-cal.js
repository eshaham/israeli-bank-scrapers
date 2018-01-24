import _ from 'lodash';
import buildUrl from 'build-url';
import moment from 'moment';

import { BaseScraper, LOGIN_RESULT } from './base-scraper';
import {
  SCRAPE_PROGRESS_TYPES,
  NORMAL_TXN_TYPE,
  INSTALLMENTS_TXN_TYPE,
  SHEKEL_CURRENCY_SYMBOL,
  SHEKEL_CURRENCY,
  DOLLAR_CURRENCY_SYMBOL,
  DOLLAR_CURRENCY } from '../constants';
import { fetchGet, fetchPost } from '../helpers/fetch';
import { fixInstallments, sortTransactionsByDate, filterOldTransactions } from '../helpers/transactions';

const BASE_URL = 'https://restservices.cal-online.co.il/Cal4U';
const DATE_FORMAT = 'DD/MM/YYYY';

const NORMAL_TYPE_CODE = '5';
const REFUND_TYPE_CODE = '6';
const CANCEL_TYPE_CODE = '25';
const INSTALLMENTS_TYPE_CODE = '8';

function getBankDebitsUrl(accountId) {
  const toDate = new Date();
  const fromDate = new Date();
  toDate.setMonth(toDate.getMonth() + 2);
  fromDate.setMonth(fromDate.getMonth() - 6);

  return buildUrl(BASE_URL, {
    path: `CalBankDebits/${accountId}`,
    queryParams: {
      DebitLevel: 'A',
      DebitType: '2',
      FromMonth: fromDate.getMonth().toString(),
      FromYear: fromDate.getFullYear().toString(),
      ToMonth: toDate.getMonth().toString(),
      ToYear: toDate.getFullYear().toString(),
    },
  });
}

function getTransactionsUrl(cardId, debitDate) {
  return buildUrl(BASE_URL, {
    path: `CalTransactions/${cardId}`,
    queryParams: {
      ToDate: debitDate,
      FromDate: debitDate,
    },
  });
}

function convertTransactionType(txnType) {
  switch (txnType) {
    case NORMAL_TYPE_CODE:
    case REFUND_TYPE_CODE:
    case CANCEL_TYPE_CODE:
      return NORMAL_TXN_TYPE;
    case INSTALLMENTS_TYPE_CODE:
      return INSTALLMENTS_TXN_TYPE;
    default:
      throw new Error(`unknown transaction type ${txnType}`);
  }
}

function convertCurrency(currency) {
  switch (currency) {
    case SHEKEL_CURRENCY_SYMBOL:
      return SHEKEL_CURRENCY;
    case DOLLAR_CURRENCY_SYMBOL:
      return DOLLAR_CURRENCY;
    default:
      return currency;
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

function convertTransactions(txns) {
  return txns.map((txn) => {
    return {
      type: convertTransactionType(txn.TransType),
      date: moment(txn.Date, DATE_FORMAT).toDate(),
      processedDate: moment(txn.DebitDate, DATE_FORMAT).toDate(),
      originalAmount: -txn.Amount.Value,
      originalCurrency: convertCurrency(txn.Amount.Symbol),
      chargedAmount: -txn.DebitAmount.Value,
      description: txn.MerchantDetails.Name,
      installments: getInstallmentsInfo(txn),
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

class VisaCalScraper extends BaseScraper {
  async login(credentials) {
    const authUrl = `${BASE_URL}/CalAuthenticator`;
    const authRequest = {
      username: credentials.username,
      password: credentials.password,
    };

    this.emitProgress(SCRAPE_PROGRESS_TYPES.LOGGING_IN);

    const authResponse = await fetchPost(authUrl, authRequest);
    if (!authResponse || !authResponse.AuthenticationToken) {
      throw new Error('unknown error during login');
    }

    if (_.get(authResponse, 'Response.Status.Succeeded')) {
      this.authHeader = `CalAuthScheme ${authResponse.AuthenticationToken}`;
      this.emitProgress(SCRAPE_PROGRESS_TYPES.LOGIN_SUCCESS);
      return { success: true };
    }

    return {
      success: false,
      errorType: LOGIN_RESULT.INVALID_PASSWORD,
    };
  }

  async fetchData() {
    const defaultStartMoment = moment().subtract(1, 'years');
    const startDate = this.options.startDate || defaultStartMoment.toDate();
    const startMoment = moment.max(defaultStartMoment, moment(startDate));

    const cardsByAccountUrl = `${BASE_URL}/CardsByAccounts`;
    const banksResponse = await fetchGet(cardsByAccountUrl, this.createAuthHeader());

    if (_.get(banksResponse, 'Response.Status.Succeeded')) {
      const accounts = [];
      for (let i = 0; i < banksResponse.BankAccounts.length; i += 1) {
        const bank = banksResponse.BankAccounts[i];
        const bankDebits = await this.getBankDebits(bank.AccountID);
        if (_.get(bankDebits, 'Response.Status.Succeeded')) {
          for (let j = 0; j < bank.Cards.length; j += 1) {
            const rawTxns = await this.getTxnsOfCard(bank.Cards[j], bankDebits.Debits);
            if (rawTxns) {
              let txns = convertTransactions(rawTxns);
              txns = prepareTransactions(txns, startMoment, this.options.combineInstallments);
              const result = {
                accountNumber: bank.Cards[j].LastFourDigits,
                txns,
              };
              accounts.push(result);
            }
          }
        }
      }
      return {
        success: true,
        accounts,
      };
    }
    return { success: false };
  }

  async getTxnsOfCard(card, bankDebits) {
    const cardId = card.Id;
    const cardDebitDates = bankDebits.filter((bankDebit) => {
      return bankDebit.CardId === cardId;
    }).map((cardDebit) => {
      return cardDebit.Date;
    });
    return this.fetchTxns(cardId, cardDebitDates);
  }

  async fetchTxns(cardId, debitDates) {
    const txns = [];
    for (const date of debitDates) {
      const fetchTxnUrl = getTransactionsUrl(cardId, date);
      let txnResponse = await fetchGet(fetchTxnUrl, this.createAuthHeader());
      if (txnResponse.Transactions) {
        txns.push(...txnResponse.Transactions);
      }
      while (txnResponse.HasNextPage) {
        txnResponse = await this.getTransactionsNextPage();
        if (txnResponse.Transactions != null) {
          txns.push(...txnResponse.Transactions);
        }
      }
    }
    return txns;
  }

  async getTransactionsNextPage() {
    const hasNextPageUrl = `${BASE_URL}/CalTransNextPage`;
    return fetchGet(hasNextPageUrl, this.createAuthHeader());
  }

  async getBankDebits(accountId, cardId) {
    const bankDebitsUrl = getBankDebitsUrl(accountId, cardId);
    return fetchGet(bankDebitsUrl, this.createAuthHeader());
  }

  createAuthHeader() {
    return {
      Authorization: this.authHeader,
    };
  }
}

export default VisaCalScraper;
