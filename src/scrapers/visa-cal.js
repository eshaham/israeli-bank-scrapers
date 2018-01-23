import _ from 'lodash';
import buildUrl from 'build-url';
import moment from 'moment';

import { BaseScraper, LOGIN_RESULT } from './base-scraper';
import { SCRAPE_PROGRESS_TYPES, NORMAL_TXN_TYPE, INSTALLMENTS_TXN_TYPE, SHEKEL_CURRENCY_SYMBOL, SHEKEL_CURRENCY } from '../constants';
import { fetchGet, fetchPost } from '../helpers/fetch';

const BASE_URL = 'https://restservices.cal-online.co.il/Cal4U';
const DATE_FORMAT = 'DD/MM/YYYY';

const NORMAL_TYPE_CODE = '5';
const REFUND_TYPE_CODE = '6';
const CANCEL_TYPE_CODE = '25';
const INSTALLMENTS_TYPE_CODE = '8';

function getBankDebitsUrl(accountId, cardId) {
  const toDate = new Date();
  const fromDate = new Date();
  toDate.setMonth(toDate.getMonth() + 2);
  fromDate.setMonth(fromDate.getMonth() - 6);

  return buildUrl(BASE_URL, {
    path: `CalBankDebits/${accountId}`,
    queryParams: {
      DebitLevel: 'A',
      DebitType: '2',
      cardID: cardId,
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
  if (currency === SHEKEL_CURRENCY_SYMBOL) {
    return SHEKEL_CURRENCY;
  }

  return currency;
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
    const cardsByAccountUrl = `${BASE_URL}/CardsByAccounts`;
    const banksResponse = await fetchGet(cardsByAccountUrl, this.createAuthHeader());

    if (_.get(banksResponse, 'Response.Status.Succeeded')) {
      for (let i = 0; i < banksResponse.BankAccounts.length; i += 1) {
        const bank = banksResponse.BankAccounts[i];
        for (let j = 0; j < bank.Cards.length; j += 1) {
          const rawTxns = await this.getTxnsOfCard(bank.AccountID, bank.Cards[j]);
          if (rawTxns) {
            const txns = convertTransactions(rawTxns);
            console.log(txns);
          }
        }
      }
      return { success: true };
    }
    return { success: false };
  }

  async getTxnsOfCard(accountId, card) {
    const cardId = card.Id;
    const bankDebits = await this.getBankDebits(accountId, cardId);
    if (_.get(bankDebits, 'Response.Status.Succeeded')) {
      const debitDates = [];
      bankDebits.Debits.forEach((debit) => {
        debitDates.push(debit.Date);
      });
      return this.fetchTxns(cardId, debitDates);
    }
    return null;
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
