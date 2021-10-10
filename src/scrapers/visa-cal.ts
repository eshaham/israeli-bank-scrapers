import moment, { Moment } from 'moment';
import { Frame, Page } from 'puppeteer';
import { BaseScraperWithBrowser, LoginOptions, LoginResults } from './base-scraper-with-browser';
import {
  clickButton, elementPresentOnPage, pageEval, pageEvalAll, setValue, waitUntilElementFound,
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
import { waitUntil } from '../helpers/waiting';

const LOGIN_URL = 'https://www.cal-online.co.il/';
const TRANSACTIONS_URL = 'https://services.cal-online.co.il/Card-Holders/Screens/Transactions/Transactions.aspx';
const DATE_FORMAT = 'DD/MM/YY';
const InvalidPasswordMessage = 'שם המשתמש או הסיסמה שהוזנו שגויים';

interface ScrapedTransaction {
  date: string;
  description: string;
  originalAmount: string;
  chargedAmount: string;
  memo: string;
}

async function getLoginFrame(page: Page) {
  let frame: Frame | null = null;
  await waitUntil(() => {
    frame = page
      .frames()
      .find((f) => f.url().includes('connect.cal-online')) || null;
    return Promise.resolve(!!frame);
  }, 'wait for iframe with login form', 10000, 1000);

  if (!frame) {
    throw new Error('failed to extract login iframe');
  }

  return frame;
}

async function hasInvalidPasswordError(page: Page) {
  const frame = await getLoginFrame(page);
  const errorFound = await elementPresentOnPage(frame, 'div.general-error > div');
  const errorMessage = errorFound ? await pageEval(frame, 'div.general-error > div', '', (item) => {
    return (item as HTMLDivElement).innerText;
  }) : '';
  return errorMessage === InvalidPasswordMessage;
}

function getPossibleLoginResults() {
  const urls: LoginOptions['possibleResults'] = {
    [LoginResults.Success]: [/AccountManagement/i],
    [LoginResults.InvalidPassword]: [async (options?: { page?: Page}) => {
      const page = options?.page;
      if (!page) {
        return false;
      }
      return hasInvalidPasswordError(page);
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
    amount = -parseFloat(amountStrCln.replace(SHEKEL_CURRENCY_SYMBOL, ''));
    currency = SHEKEL_CURRENCY;
  } else if (amountStrCln.includes(DOLLAR_CURRENCY_SYMBOL)) {
    amount = -parseFloat(amountStrCln.replace(DOLLAR_CURRENCY_SYMBOL, ''));
    currency = DOLLAR_CURRENCY;
  } else {
    const parts = amountStrCln.split(' ');
    amount = -parseFloat(parts[0]);
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
      date: installments ? txnDate.add(installments.number - 1, 'month').toISOString() : txnDate.toISOString(),
      processedDate: txnDate.toISOString(),
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

// @eran.sakal - I don't have any load more links.. are they still needed in the monthly view?
async function fetchTransactionsForAccount(page: Page, startDate: Moment, accountNumber: string): Promise<TransactionsAccount> {
  const startDateValue = startDate.format('MM/YYYY');
  const dateSelector = '[id$="FormAreaNoBorder_FormArea_clndrDebitDateScope_TextBox"]';
  const dateHiddenFieldSelector = '[id$="FormAreaNoBorder_FormArea_clndrDebitDateScope_HiddenField"]';
  const buttonSelector = '[id$="FormAreaNoBorder_FormArea_ctlSubmitRequest"]';
  const nextPageSelector = '[id$="FormAreaNoBorder_FormArea_ctlGridPager_btnNext"]';

  const options = await pageEvalAll(page, '[id$="FormAreaNoBorder_FormArea_clndrDebitDateScope_OptionList"] li', [], (items) => {
    return items.map((el: any) => el.innerText);
  });
  const startDateIndex = options.findIndex((option) => option === startDateValue);

  const txns: Transaction[] = [];
  for (let currentDateIndex = startDateIndex; currentDateIndex < options.length; currentDateIndex += 1) {
    await waitUntilElementFound(page, dateSelector, true);
    await setValue(page, dateHiddenFieldSelector, `${currentDateIndex}`);
    await clickButton(page, buttonSelector);
    await waitForNavigationAndDomLoad(page);

    let hasNextPage = false;
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
  }

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
    (async () => {
      try {
        await waitUntil(async () => {
          return hasInvalidPasswordError(page);
        }, 'wait for concrete error message', 10000, 1000);
      } catch (e) {
        // this is a valid scenario, waitUntil will fail once promise.race will handle the first promise
      }
    })(),
  ]);
}


class VisaCalScraper extends BaseScraperWithBrowser {
  openLoginPopup = async () => {
    await waitUntilElementFound(this.page, '#ccLoginDesktopBtn', true);
    await clickButton(this.page, '#ccLoginDesktopBtn');
    const frame = await getLoginFrame(this.page);
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
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/78.0.3904.108 Safari/537.36',
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
