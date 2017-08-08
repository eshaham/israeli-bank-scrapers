import moment from 'moment';

import { BaseScraper, LOGIN_RESULT } from './base-scraper';
import { waitForRedirect } from '../helpers/navigation';
import fetch from '../helpers/fetch';
import includeJQuery from '../helpers/imported-libs';

const BASE_URL = 'https://start.telebank.co.il';
const DATE_FORMAT = 'YYYYMMDD';

function convertTransactions(txns) {
  return txns.map((txn) => {
    return {
      identifier: txn.OperationNumber,
      date: moment(txn.OperationDate, DATE_FORMAT).toDate(),
      processedDate: moment(txn.ValueDate, DATE_FORMAT).toDate(),
      amount: txn.OperationAmount,
      description: txn.OperationDescriptionToDisplay,
    };
  });
}

async function fetchAccountData(page, options, notifyAction) {
  await includeJQuery(page);

  const apiSiteUrl = `${BASE_URL}/Titan/gatewayAPI`;

  const accountDataUrl = `${apiSiteUrl}/userAccountsData`;
  const accountInfo = await fetch(page, accountDataUrl);
  const accountNumber = accountInfo.UserAccountsData.DefaultAccountNumber;

  notifyAction(`found account number ${accountNumber}`);

  const defaultStartMoment = moment().subtract(1, 'years').add(1, 'day');
  const startDate = options.startDate || defaultStartMoment.toDate();
  const startMoment = moment.max(defaultStartMoment, moment(startDate));

  const startDateStr = startMoment.format(DATE_FORMAT);
  const txnsUrl = `${apiSiteUrl}/lastTransactions/${accountNumber}/Date?IsCategoryDescCode=True&IsTransactionDetails=True&IsEventNames=True&FromDate=${startDateStr}`;
  const txnsResult = await fetch(page, txnsUrl);
  if (txnsResult.Error) {
    return {
      success: false,
      errorType: 'generic',
      errorMessage: txnsResult.Error.MsgText,
    };
  }
  const txns = convertTransactions(txnsResult.CurrentAccountLastTransactions.OperationEntry);

  const accountData = {
    success: true,
    accountNumber,
    txns,
  };
  notifyAction(`end scraping for account ${accountData.accountNumber}, found ${accountData.txns.length} transactions`);

  return accountData;
}

function getPossibleLoginResults() {
  const urls = {};
  urls[LOGIN_RESULT.SUCCESS] = `${BASE_URL}/apollo/core/templates/default/masterPage.html#/MY_ACCOUNT_HOMEPAGE`;
  urls[LOGIN_RESULT.INVALID_PASSWORD] = `${BASE_URL}/LoginPages/Logon?multilang=he&t=P&pagekey=home&bank=d#`;
  urls[LOGIN_RESULT.CHANGE_PASSWORD] = `${BASE_URL}/LoginPages/Logon`;
  return urls;
}

function createLoginFields(credentials) {
  return [
    { id: 'tzId', value: credentials.id },
    { id: 'tzPassword', value: credentials.password },
    { id: 'aidnum', value: credentials.num },
  ];
}

class DiscountScraper extends BaseScraper {
  async scrape(credentials, options = {}) {
    await this.initialize('discount', options);

    const loginOptions = {
      loginUrl: `${BASE_URL}/LoginPages/Logon?multilang=he&t=P&pageKey=home&bank=d`,
      fields: createLoginFields(credentials),
      submitButtonId: 'submitButton',
      postAction: async () => waitForRedirect(this.page),
      possibleResults: getPossibleLoginResults(),
    };
    const loginResult = await this.login(loginOptions);

    let scrapeResult;
    if (loginResult.success) {
      scrapeResult = await fetchAccountData(this.page, this.options, msg => this.notify(msg));
    } else {
      scrapeResult = loginResult;
    }

    await this.exit();

    return scrapeResult;
  }
}

export default DiscountScraper;
