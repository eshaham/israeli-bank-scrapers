import _ from 'lodash';
import buildUrl from 'build-url';

import { BaseScraper, LOGIN_RESULT } from './base-scraper';
import { SCRAPE_PROGRESS_TYPES } from '../constants';
import { fetchGet, fetchPost } from '../helpers/fetch';

const BASE_URL = 'https://restservices.cal-online.co.il/Cal4U';

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

function getTxnsUrl(cardId, debitDate) {
  return buildUrl(BASE_URL, {
    path: `CalTransactions/${cardId}`,
    queryParams: {
      ToDate: debitDate,
      FromDate: debitDate,
    },
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
      for (const bank of banksResponse.BankAccounts) {
        for (const card of bank.Cards) {
          const cardTxns = await this.getTxnsOfCard(bank.AccountID, card);
          console.log(cardTxns);
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
      const fetchTxnUrl = getTxnsUrl(cardId, date);
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
