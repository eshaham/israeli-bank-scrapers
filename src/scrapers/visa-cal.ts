import moment, { Moment } from 'moment';
import { Page } from 'puppeteer';
import { BaseScraperWithBrowser, LoginOptions, LoginResults } from './base-scraper-with-browser';
import {
  clickButton, elementPresentOnPage, fillInput, pageEval, pageEvalAll, waitUntilElementFound,
} from '../helpers/elements-interactions';
import {
  Transaction,
  TransactionInstallments,
  TransactionsAccount,
  TransactionStatuses,
  TransactionTypes,
} from '../transactions';
import { ScaperScrapingResult, ScraperCredentials } from './base-scraper';
import { waitForNavigation, waitForNavigationAndDomLoad } from '../helpers/navigation';
import {
  DOLLAR_CURRENCY, DOLLAR_CURRENCY_SYMBOL, SHEKEL_CURRENCY, SHEKEL_CURRENCY_SYMBOL,
} from '../constants';

const LOGIN_URL = 'https://www.cal-online.co.il/';
const TRANSACTIONS_URL = 'https://services.cal-online.co.il/Card-Holders/Screens/Transactions/Transactions.aspx';
const DATE_FORMAT = 'DD/MM/YY';

interface ScrapedTransaction {
  date: string;
  description: string;
  originalAmount: string;
  chargedAmount: string;
  memo: string;
}

function getLoginFrame(page: Page) {
  const frame = page
    .frames()
    .find((f) => f.url().includes('connect.cal-online'));

  if (!frame) {
    throw new Error('failed to extract login iframe');
  }

  return frame;
}

function getPossibleLoginResults() {
  const urls: LoginOptions['possibleResults'] = {
    [LoginResults.Success]: [/AccountManagement/i],
    [LoginResults.InvalidPassword]: [async (options?: { page?: Page}) => {
      const page = options?.page;
      if (!page) {
        return false;
      }
      const frame = getLoginFrame(page);
      const errorFound = await elementPresentOnPage(frame, 'div.general-error > div');
      const errorMessage = errorFound ? await pageEval(frame, 'div.general-error > div', '', (item) => {
        return (item as HTMLDivElement).innerText;
      }) : '';
      return errorMessage === 'שם המשתמש או הסיסמה שהוזנו שגויים';
    }],
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


function getAmountData(amountStr: string) {
  const amountStrCln = amountStr.replace(',', '');
  let currency: string | null = null;
  let amount: number | null = null;
  if (amountStrCln.includes(SHEKEL_CURRENCY_SYMBOL)) {
    amount = parseFloat(amountStrCln.replace(SHEKEL_CURRENCY_SYMBOL, ''));
    currency = SHEKEL_CURRENCY;
  } else if (amountStrCln.includes(DOLLAR_CURRENCY_SYMBOL)) {
    amount = parseFloat(amountStrCln.replace(DOLLAR_CURRENCY_SYMBOL, ''));
    currency = DOLLAR_CURRENCY;
  } else {
    const parts = amountStrCln.split(' ');
    amount = parseFloat(parts[0]);
    [, currency] = parts;
  }

  return {
    amount,
    currency,
  };
}

function getTransactionInstallments(memo: string): TransactionInstallments | null {
  const parsedMemo = (/תשלום (\d+) מתוך (\d+)/).exec(memo || '');

  if (!parsedMemo || parsedMemo.length === 0) {
    return null;
  }

  return {
    number: parseInt(parsedMemo[1], 10),
    total: parseInt(parsedMemo[2], 10),
  };
}
function convertTransactions(txns: ScrapedTransaction[]): Transaction[] {
  return txns.map((txn) => {
    const originalAmountTuple = getAmountData(txn.originalAmount || '');
    const chargedAmountTuple = getAmountData(txn.chargedAmount || '');

    const installments = getTransactionInstallments(txn.memo);
    const txnDate = moment(txn.date, DATE_FORMAT);

    const result: Transaction = {
      type: installments ? TransactionTypes.Installments : TransactionTypes.Normal,
      status: TransactionStatuses.Completed,
      date: txnDate.toISOString(),
      processedDate: installments ? txnDate.add(installments.number - 1, 'month').toISOString() : txnDate.toISOString(),
      originalAmount: originalAmountTuple.amount,
      originalCurrency: originalAmountTuple.currency,
      chargedAmount: chargedAmountTuple.amount,
      chargedCurrency: chargedAmountTuple.currency,
      description: txn.description || '',
      memo: txn.memo || '',
    };

    if (installments) {
      result.installments = installments;
    }

    return result;
  });
}

async function fetchTransactionsForAccount(page: Page, startDate: Moment, accountNumber: string): Promise<TransactionsAccount> {
  const startDateValue = startDate.format('MM/YYYY');
  const dateSelector = '[id$="FormAreaNoBorder_FormArea_ctlDateScopeStart_ctlMonthYearList_TextBox"]';
  const dateHiddenFieldSelector = '[id$="FormAreaNoBorder_FormArea_ctlDateScopeStart_ctlMonthYearList_HiddenField"]';
  const buttonSelector = '[id$="FormAreaNoBorder_FormArea_ctlSubmitRequest"]';
  const nextPageSelector = '[id$="FormAreaNoBorder_FormArea_ctlGridPager_btnNext"]';

  const hiddenFieldValue = await pageEvalAll(page, '[id$="FormAreaNoBorder_FormArea_clndrDebitDateScope_OptionList"] li', [], (items, startDateValue) => {
    return items.findIndex((element: any) => element.innerText === startDateValue);
  }, [startDateValue]);

  await clickButton(page, '#ctl00_FormAreaNoBorder_FormArea_rdoTransactionDate');
  await waitUntilElementFound(page, dateSelector, true);
  await fillInput(page, dateSelector, startDateValue);
  await fillInput(page, dateHiddenFieldSelector, `${hiddenFieldValue}`);
  await clickButton(page, buttonSelector);
  await waitForNavigationAndDomLoad(page);

  let hasNextPage = false;
  const txns: Transaction[] = [];
  do {
    const rawTransactions = await pageEvalAll<(ScrapedTransaction | null)[]>(page, '#ctlMainGrid > tbody tr', [], (items) => {
      return (items).map((el) => {
        const columns = el.getElementsByTagName('td');
        if (columns.length !== 2) {
          return {
            date: columns[0].innerText,
            description: columns[1].innerText,
            originalAmount: columns[2].innerText,
            chargedAmount: columns[3].innerText,
            memo: columns[4].innerText,
          };
        }
        return null;
      });
    }, []);

    txns.push(...convertTransactions((rawTransactions as ScrapedTransaction[]).filter((item) => !!item)));

    hasNextPage = await elementPresentOnPage(page, nextPageSelector);

    if (hasNextPage) {
      await clickButton(page, '[id$=FormAreaNoBorder_FormArea_ctlGridPager_btnNext]');
      await waitForNavigationAndDomLoad(page);
    }
  } while (hasNextPage);

  return {
    accountNumber,
    txns,
  };
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

  const accountId = await pageEval(page, '[id$=cboCardList_categoryList_lblCollapse]', '', (item) => {
    return (item as HTMLInputElement).value;
  }, []);

  const accountNumber = /\d+$/.exec(accountId.trim())?.[0] ?? '';
  accounts.push(await fetchTransactionsForAccount(page, startDate, accountNumber));
  // }

  return accounts;
}

async function redirectOrDialog(page: Page): Promise<any> {
  return Promise.race([
    waitForNavigation(page),
    async () => {
      const frame = getLoginFrame(page);
      return waitForNavigation(frame);
    },
  ]);
}


class VisaCalScraper extends BaseScraperWithBrowser {
  openLoginPopup = async () => {
    await clickButton(this.page, '#ccLoginDesktopBtn');

    await waitUntilElementFound(this.page, 'iframe[src*="connect.cal-online"]');
    await this.page.waitFor(3000);
    const frame = getLoginFrame(this.page);
    await waitUntilElementFound(frame, '#regular-login');
    await clickButton(frame, '#regular-login');
    await waitUntilElementFound(frame, 'regular-login');

    return frame;
  };

  getLoginOptions(credentials: Record<string, string>) {
    return {
      loginUrl: `${LOGIN_URL}`,
      fields: createLoginFields(credentials),
      submitButtonSelector: 'button[type="submit"]',
      possibleResults: getPossibleLoginResults(),
      checkReadiness: async () => waitUntilElementFound(this.page, '#ccLoginDesktopBtn'),
      preAction: this.openLoginPopup,
      postAction: () => redirectOrDialog(this.page),
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
