import fetch from 'node-fetch';
import queryString from 'query-string';

import { BaseScraper, LOGIN_RESULT } from './base-scraper';
import { SCRAPE_PROGRESS_TYPES } from '../constants';

const BASE_URL = 'https://restservices.cal-online.co.il/Cal4U/';

class VisaCalScraper extends BaseScraper {
  async login(credentials) {
    const authUrl = `${BASE_URL}CalAuthenticator`;
    const authRequest = {
      username: credentials.username,
      password: credentials.password,
    };

    this.emitProgress(SCRAPE_PROGRESS_TYPES.LOGGING_IN);


    const authResponse = await fetch(
      authUrl,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json, text/plain, */*',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(authRequest),
      },
    )
      .then((res) => { return res.json(); });
    if (!authResponse || !authResponse.AuthenticationToken) {
      throw new Error('unknown error during login');
    }

    if (authResponse.Response.Status.Succeeded === true) {
      this.authHeader = `CalAuthScheme ${authResponse.AuthenticationToken}`;
      const getCardsByAccount = `${BASE_URL}CardsByAccounts`;
      const banks = await fetch(
        getCardsByAccount,
        {
          method: 'GET',
          headers: {
            Accept: 'application/json, text/plain, */*',
            'Content-Type': 'application/json',
            Authorization: this.authHeader,
          },
        },
      )
        .then((res) => { return res.json(); });

      if (banks.Response.Status.Succeeded === true) {
        for (const bank of banks.BankAccounts) {
          for (const card of bank.Cards) {
            const cardTxns = await this.getTxnsOfCard(bank.AccountID, card);
            console.log(cardTxns);
          }
        }
      }
      return { success: true };
    }

    return {
      success: false,
      errorType: LOGIN_RESULT.INVALID_PASSWORD,
    };
  }

  async getTxnsOfCard(accountId, card) {
    const cardId = card.Id;
    const bankDebits = await this.getBankDebits(accountId, cardId);
    const debitDates = [];
    bankDebits.Debits.forEach((debit) => {
      debitDates.push(debit.Date);
    });
    return this.fetchTxns(cardId, debitDates);
  }

  async fetchTxns(cardId, debitDates) {
    const txns = [];
    for (const date of debitDates) {
      const params = {};
      params.ToDate = date;
      params.FromDate = date;
      const stringParams = queryString.stringify(params);
      const fetchTxnUrl = `${BASE_URL}CalTransactions/${cardId}?${stringParams}`;
      let txnResponse = await fetch(
        fetchTxnUrl,
        {
          method: 'GET',
          headers: {
            Accept: 'application/json, text/plain, */*',
            'Content-Type': 'application/json',
            Authorization: this.authHeader,
          },
        },
      )
        .then((res) => { return res.json(); });
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
    const hasNextPageUrl = `${BASE_URL}CalTransNextPage`;
    return fetch(
      hasNextPageUrl,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json, text/plain, */*',
          'Content-Type': 'application/json',
          Authorization: this.authHeader,
        },
      },
    )
      .then((res) => {
        return res.json();
      });
  }

  async getBankDebits(accountId, cardId) {
    const params = {};
    params.DebitLevel = 'A';
    params.DebitType = '2';
    params.cardID = cardId;
    const toDate = new Date();
    const fromDate = new Date();
    toDate.setMonth(toDate.getMonth() + 2);
    fromDate.setMonth(fromDate.getMonth() - 6);
    params.FromMonth = fromDate.getMonth().toString();
    params.FromYear = fromDate.getFullYear().toString();
    params.ToMonth = toDate.getMonth().toString();
    params.ToYear = toDate.getFullYear().toString();
    const stringParams = queryString.stringify(params);
    const getBankDebitsUrl = `${BASE_URL}CalBankDebits/${accountId}?${stringParams}`;

    return fetch(
      getBankDebitsUrl,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json, text/plain, */*',
          'Content-Type': 'application/json',
          Authorization: this.authHeader,
        },
      },
    )
      .then((res) => {
        return res.json();
      });
  }
}

export default VisaCalScraper;
