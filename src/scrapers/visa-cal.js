import { BaseScraper, LOGIN_RESULT } from './base-scraper';
import { SCRAPE_PROGRESS_TYPES, NORMAL_TXN_TYPE, INSTALLMENTS_TXN_TYPE, SHEKEL_CURRENCY_KEYWORD, SHEKEL_CURRENCY } from '../constants';

const BASE_URL = 'https://restservices.cal-online.co.il/Cal4U/';

const fetch = require('node-fetch');

class VisaCalScraper extends BaseScraper {
  async login(credentials) {
    const authUrl = `${BASE_URL}CalAuthenticator`;
    const authRequest = {
      username: credentials.username,
      password: credentials.password,
    };

    this.emitProgress(SCRAPE_PROGRESS_TYPES.LOGGING_IN);


    // const authResponse = await fetchPost(this.page, authUrl, authRequest);
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
      const cards = [];
      if (banks.Response.Status.Succeeded === true) {
        banks.BankAccounts.forEach((bank) => {
          bank.Cards.forEach((card) => {
            if (card.CardStatus == null) {
              cards.push(card);
            }
          });
        });
      }
      console.log(banks);
      return { success: true };
    }

    return {
      success: false,
      errorType: LOGIN_RESULT.INVALID_PASSWORD,
    };
  }

  function

  async fetchData() {
    // return getAccountData(this.page, this.options);
  }
}

export default VisaCalScraper;
