import moment, { Moment } from 'moment';
import { Page } from 'puppeteer';
import { BaseScraperWithBrowser, LoginResults, LoginOptions } from './base-scraper-with-browser';
import {
  clickButton,
  waitUntilElementFound, fillInput, pageEvalAll,
} from '../helpers/elements-interactions';
import {
  TransactionsAccount
} from '../transactions';
import { ScaperScrapingResult, ScraperCredentials } from './base-scraper';
import {waitForNavigationAndDomLoad} from "../helpers/navigation";

const LOGIN_URL = 'https://www.cal-online.co.il/';
const TRANSACTIONS_URL = `https://services.cal-online.co.il/Card-Holders/Screens/Transactions/Transactions.aspx`;


function getPossibleLoginResults() {
  const urls: LoginOptions['possibleResults'] = {
    [LoginResults.Success]: [/AccountManagement/i],
    // [LoginResults.InvalidPassword]: [], // TODO add when reaching this scenario
    // [LoginResults.AccountBlocked]: [], // TODO add when reaching this scenario
    // [LoginResults.ChangePassword]: [], // TODO add when reaching this scenario
  };
  return urls;
}

function createLoginFields(credentials: ScraperCredentials) {
  return [
    { selector: '[formcontrolname="userName"]', value: credentials.username },
    { selector: '[formcontrolname="password"]', value: credentials.password },
  ];
}

function removeSpecialCharacters(str: string): string {
  return str.replace(/[^0-9/-]/g, '');
}

async function fetchTransactionsForAccount(page: Page, startDate: Moment, accountId: string): Promise<TransactionsAccount> {
  const startDateValue = startDate.format('MM/YYYY');
  const dateSelector = '[id$="FormAreaNoBorder_FormArea_ctlDateScopeStart_ctlMonthYearList_TextBox"]';
  const dateHiddenFieldSelector = '[id$="FormAreaNoBorder_FormArea_ctlDateScopeStart_ctlMonthYearList_HiddenField"]';
  const buttonSelector = '[id$="FormAreaNoBorder_FormArea_ctlSubmitRequest"]';

  const hiddenFieldValue = await pageEvalAll(page, '[id$="FormAreaNoBorder_FormArea_clndrDebitDateScope_OptionList"] li',[], (items, startDateValue) => {
    return items.findIndex((element: any) => element.innerText === startDateValue);
  }, [startDateValue]);

  await clickButton(page, '#ctl00_FormAreaNoBorder_FormArea_rdoTransactionDate');
  await waitUntilElementFound(page, dateSelector, true);
  await fillInput(page, dateSelector, startDateValue);
  await fillInput(page, dateHiddenFieldSelector, `${hiddenFieldValue}`);
  await clickButton(page, buttonSelector);
  await waitForNavigationAndDomLoad(page);

  // TODO fetch transactions
  throw new Error(accountId);
  //
  // const pendingTransactions = response.TodayTransactionsItems;
  // const transactions = response.HistoryTransactionsItems;
  // const balance = response.BalanceDisplay ? parseFloat(response.BalanceDisplay) : undefined;
  //
  // const pendingTxns = extractTransactionsFromPage(pendingTransactions, TransactionStatuses.Pending);
  // const completedTxns = extractTransactionsFromPage(transactions, TransactionStatuses.Completed);
  // const txns = [
  //   ...pendingTxns,
  //   ...completedTxns,
  // ];
  //
  // return {
  //   accountNumber,
  //   balance,
  //   txns,
  // };
}

async function fetchTransactions(page: Page, startDate: Moment): Promise<TransactionsAccount[]> {
  const accounts: TransactionsAccount[] = [];

  // TODO multiple accounts
 // const accountsIds = await page.evaluate(() => Array.from(document.querySelectorAll('app-masked-number-combo span.display-number-li'), (e) => e.textContent)) as string[];

  // due to a bug, the altered value might include undesired signs like & that should be removed

  // if (!accountsIds.length) {
  //   throw new Error('Failed to extract or parse the account number');
  // }

  // for (const accountId of accountsIds) {
    // if (accountsIds.length > 1) {
    //   // get list of accounts and check accountId
    //   await clickByXPath(page, '//*[contains(@class, "number") and contains(@class, "combo-inner")]');
    //   await clickByXPath(page, `//span[contains(text(), '${accountId}')]`);
    // }

  const accountId = 'dummy'
    accounts.push(await fetchTransactionsForAccount(page, startDate, removeSpecialCharacters(accountId)));
  // }

  return accounts;
}


class VisaCalScraper extends BaseScraperWithBrowser {
  openLoginPopup = async () => {
    await clickButton(this.page, '#ccLoginDesktopBtn');

    await waitUntilElementFound(this.page, 'iframe[src*="connect.cal-online"]');
    await this.page.waitFor(3000)
    const frame = await this.page
        .frames()
        .find(f => f.url().includes('connect.cal-online'));

    if (!frame) {
      throw new Error('failed to extract login iframe')
    }
    await waitUntilElementFound(frame, '#regular-login');
    await clickButton(frame, '#regular-login');
    await waitUntilElementFound(frame, 'regular-login');

    return frame;
  }

  getLoginOptions(credentials: Record<string, string>) {
    return {
      loginUrl: `${LOGIN_URL}`,
      fields: createLoginFields(credentials),
      submitButtonSelector: 'button[type="submit"]',
      possibleResults: getPossibleLoginResults(),
      checkReadiness: async () => waitUntilElementFound(this.page, '#ccLoginDesktopBtn'),
      preAction: this.openLoginPopup
    };
  }

  async fetchData(): Promise<ScaperScrapingResult> {
    const defaultStartMoment = moment().subtract(1, 'years').add(1, 'day');
    const startDate = this.options.startDate || defaultStartMoment.toDate();
    const startMoment = moment.max(defaultStartMoment, moment(startDate));

     await this.navigateTo(TRANSACTIONS_URL);

     const accounts = await fetchTransactions(this.page, startMoment);
    return {
      success: true,
      accounts,
    };
  }
}

export default VisaCalScraper;
