import moment from 'moment';
import { BaseScraperWithBrowser, LOGIN_RESULT } from './base-scraper-with-browser';
import { waitForRedirect } from '../helpers/navigation';
import {
  dropdownSelect,
  dropdownElements,
  fillInput,
  clickButton,
  waitUntilElementFound,
  elementPresentOnPage,
} from '../helpers/elements-interactions';

const BASE_URL = 'https://www.mizrahi-tefahot.co.il';
const LOGIN_URL = `${BASE_URL}/he/bank/Pages/Default.aspx`;
const AFTER_LOGIN_BASE_URL = 'https://mto.mizrahi-tefahot.co.il/ngOnline/index.html';
const DATE_FORMAT = 'DD/MM/YY';

function getTransactionsUrl() {
  return `${AFTER_LOGIN_BASE_URL}#/main/uis/legacy/Osh/p428//legacy.Osh.p428`;
}

async function fetchTransactionsForAccount(page, startDate, accountId) {
  await dropdownSelect(page, 'select#sky-account-combo', accountId);
  await waitUntilElementFound(page, 'a#btnCustomDate');
  await clickButton(page, 'a#btnCustomDate');
  await waitUntilElementFound(page, 'div#dvCustomDateRange');
  await fillInput(
    page,
    'input#ctl00_ContentPlaceHolder2_SkyDRP_SkyDatePicker1ID_radDatePickerID_dateInput',
    startDate.format(DATE_FORMAT),
  );
  await clickButton(page, 'input#btnShow');
  // TODO: continue from here
  await waitUntilElementFound(page, 'table#WorkSpaceBox table#ctlActivityTable');

  const hasExpandAllButton = await elementPresentOnPage(page, 'a#lnkCtlExpandAllInPage');

  if (hasExpandAllButton) {
    await clickButton(page, 'a#lnkCtlExpandAllInPage');
  }

  const selectedSnifAccount = await page.$eval('#ddlAccounts_m_ddl option[selected="selected"]', (option) => {
    return option.innerText;
  });

  const accountNumber = selectedSnifAccount.replace('/', '_');

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

class MizrahiScraper extends BaseScraperWithBrowser {
  getLoginOptions(credentials) {
    return {
      loginUrl: `${LOGIN_URL}`,
      fields: createLoginFields(credentials),
      submitButtonSelector: '#ctl00_PlaceHolderLogin_ctl00_Enter',
      postAction: async () => waitForRedirect(this.page, undefined, undefined,
        ['https://mto.mizrahi-tefahot.co.il/Online/Default.aspx',
          'https://www.mizrahi-tefahot.co.il/login/MiddlePage.aspx']),
      possibleResults: getPossibleLoginResults(),
    };
  }

  async fetchData() {
    console.debug('Starting fetch Data - Mizrahi');
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

export default MizrahiScraper;
