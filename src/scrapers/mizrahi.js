import moment from 'moment';
import { BaseScraperWithBrowser, LOGIN_RESULT } from './base-scraper-with-browser';
import {
  dropdownSelect,
  dropdownElements,
  fillInput,
  clickButton,
  waitUntilElementFound,
  elementPresentOnPage,
  waitUntilElementIs,
} from '../helpers/elements-interactions';

const BASE_URL = 'https://www.mizrahi-tefahot.co.il';
const LOGIN_URL = `${BASE_URL}/he/bank/Pages/Default.aspx`;
const AFTER_LOGIN_BASE_URL = 'https://mto.mizrahi-tefahot.co.il/ngOnline/index.html#/main/uis/osh/p428/';
const DATE_FORMAT = 'DD/MM/YYYY';

async function fetchTransactionsForAccount(page, startDate, accountId) {
  const btnCustomDateSelector = '.linkPannel button.ng-binding:last-of-type';
  await dropdownSelect(page, 'select#sky-account-combo', accountId);
  await waitUntilElementFound(page, btnCustomDateSelector);
  await page.$eval(btnCustomDateSelector, el => el.click());
  await waitUntilElementFound(page, 'div.well > .row', true);
  await fillInput(
    page,
    'input#dpFromDateK',
    startDate.format(DATE_FORMAT),
  );

  await page.$eval('div.form-group > button', el => el.click());
  // await page.$eval('div.from-to-datepicker > div.row > div.form-group > button', el => el.click());
  await waitUntilElementFound(page, 'table[role="treegrid"]');

  const hasExpandAllButton = await elementPresentOnPage(page, 'a#lnkCtlExpandAllInPage');

  if (hasExpandAllButton) {
    await clickButton(page, 'a#lnkCtlExpandAllInPage');
  }

  const selectedSnifAccount = await page.$eval('#ddlAccounts_m_ddl option[selected="selected"]', (option) => {
    return option.innerText;
  });

  const accountNumber = selectedSnifAccount.replace('/', '_');
  console.log(accountNumber);
  // const pendingTxns = await extractPendingTransactionsFromPage(page);
  // const completedTxns = await extractCompletedTransactionsFromPage(page);
  // const txns = [
  //   ...pendingTxns,
  //   ...completedTxns,
  // ];

  // return {
  //   accountNumber,
  //   txns: convertTransactions(txns),
  // };
}

async function fetchTransactions(page, startDate) {
  const res = [];

  // Loop through all available accounts and collect transactions from all
  const accounts = await dropdownElements(page, 'select#sky-account-combo');
  for (const account of accounts) {
    // Skip "All accounts" option
    if (account.value !== '-1') {
      res.push(await fetchTransactionsForAccount(page, startDate, account.value));
    }
  }
  return res;
}

function createLoginFields(credentials) {
  return [
    { selector: '#ctl00_PlaceHolderLogin_ctl00_tbUserName', value: credentials.username },
    { selector: '#ctl00_PlaceHolderLogin_ctl00_tbPassword', value: credentials.password },
  ];
}

function getPossibleLoginResults() {
  const urls = {};
  urls[LOGIN_RESULT.SUCCESS] = [`${AFTER_LOGIN_BASE_URL}`];
  urls[LOGIN_RESULT.INVALID_PASSWORD] = [`${BASE_URL}/login/loginMTO.aspx`];
  urls[LOGIN_RESULT.CHANGE_PASSWORD] = [
    `${AFTER_LOGIN_BASE_URL}/main/uis/ge/changePassword/`,
  ];
  return urls;
}

async function waitForPostLogin(page) {
  return Promise.race([
    waitUntilElementFound(page, '#container', true),
  ]);
}

class MizrahiScraper extends BaseScraperWithBrowser {
  getLoginOptions(credentials) {
    return {
      loginUrl: `${LOGIN_URL}`,
      fields: createLoginFields(credentials),
      submitButtonSelector: '#ctl00_PlaceHolderLogin_ctl00_Enter',
      // TODO Replace waitForRedirect with waitUntilElementFound from leumi
      postAction: async () => waitForPostLogin(this.page),
      possibleResults: getPossibleLoginResults(),
    };
  }

  async fetchData() {
    console.debug('Starting fetch Data - Mizrahi');
    const defaultStartMoment = moment().subtract(1, 'years').add(1, 'day');
    const startDate = this.options.startDate || defaultStartMoment.toDate();
    const startMoment = moment.max(defaultStartMoment, moment(startDate));

    const accounts = await fetchTransactions(this.page, startMoment);

    return {
      success: true,
      accounts,
    };
  }
}

export default MizrahiScraper;
