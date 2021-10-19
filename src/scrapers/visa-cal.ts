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
import { ScaperOptions, ScaperScrapingResult, ScraperCredentials } from './base-scraper';
import { waitForNavigationAndDomLoad } from '../helpers/navigation';
import {
  DOLLAR_CURRENCY, DOLLAR_CURRENCY_SYMBOL, SHEKEL_CURRENCY, SHEKEL_CURRENCY_SYMBOL,
} from '../constants';
import { waitUntil } from '../helpers/waiting';
import { filterOldTransactions } from '../helpers/transactions';

const LOGIN_URL = 'https://www.cal-online.co.il/';
const TRANSACTIONS_URL = 'https://services.cal-online.co.il/Card-Holders/Screens/Transactions/Transactions.aspx';
const LONG_DATE_FORMAT = 'DD/MM/YYYY';
const DATE_FORMAT = 'DD/MM/YY';
const InvalidPasswordMessage = 'שם המשתמש או הסיסמה שהוזנו שגויים';

interface ScrapedTransaction {
  date: string;
  processedDate: string;
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
    const processedDateFormat =
      txn.processedDate.length === 8 ?
        DATE_FORMAT :
        txn.processedDate.length === 9 || txn.processedDate.length === 10 ?
          LONG_DATE_FORMAT :
          null;
    if (!processedDateFormat) {
      throw new Error('invalid processed date');
    }
    const txnProcessedDate = moment(txn.processedDate, processedDateFormat);

    const result: Transaction = {
      type: installments ? TransactionTypes.Installments : TransactionTypes.Normal,
      status: TransactionStatuses.Completed,
      date: installments ? txnDate.add(installments.number - 1, 'month').toISOString() : txnDate.toISOString(),
      processedDate: txnProcessedDate.toISOString(),
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

async function fetchTransactionsForAccount(page: Page, startDate: Moment, accountNumber: string, scraperOptions: ScaperOptions): Promise<TransactionsAccount> {
  const startDateValue = startDate.format('MM/YYYY');
  const dateSelector = '[id$="FormAreaNoBorder_FormArea_clndrDebitDateScope_TextBox"]';
  const dateHiddenFieldSelector = '[id$="FormAreaNoBorder_FormArea_clndrDebitDateScope_HiddenField"]';
  const buttonSelector = '[id$="FormAreaNoBorder_FormArea_ctlSubmitRequest"]';
  const nextPageSelector = '[id$="FormAreaNoBorder_FormArea_ctlGridPager_btnNext"]';
  const billingLabelSelector = '[id$=FormAreaNoBorder_FormArea_ctlMainToolBar_lblCaption]';

  const options = await pageEvalAll(page, '[id$="FormAreaNoBorder_FormArea_clndrDebitDateScope_OptionList"] li', [], (items) => {
    return items.map((el: any) => el.innerText);
  });
  const startDateIndex = options.findIndex((option) => option === startDateValue);

  const accountTransactions: Transaction[] = [];
  for (let currentDateIndex = startDateIndex; currentDateIndex < options.length; currentDateIndex += 1) {
    await waitUntilElementFound(page, dateSelector, true);
    await setValue(page, dateHiddenFieldSelector, `${currentDateIndex}`);
    await clickButton(page, buttonSelector);
    await waitForNavigationAndDomLoad(page);
    const billingDateLabel = await pageEval(page, billingLabelSelector, '', ((element) => {
      return (element as HTMLSpanElement).innerText;
    }));

    const billingDate = /\d{1,2}[/]\d{2}[/]\d{2,4}/.exec(billingDateLabel)?.[0];

    if (!billingDate) {
      throw new Error('failed to fetch process date');
    }

    let hasNextPage = false;
    do {
      const rawTransactions = await pageEvalAll<(ScrapedTransaction | null)[]>(page, '#ctlMainGrid > tbody tr, #ctlSecondaryGrid > tbody tr', [], (items, billingDate) => {
        return (items).map((el) => {
          const columns = el.getElementsByTagName('td');
          if (columns.length === 6) {
            return {
              processedDate: columns[0].innerText,
              date: columns[1].innerText,
              description: columns[2].innerText,
              originalAmount: columns[3].innerText,
              chargedAmount: columns[4].innerText,
              memo: columns[5].innerText,
            };
          } if (columns.length === 5) {
            return {
              processedDate: billingDate,
              date: columns[0].innerText,
              description: columns[1].innerText,
              originalAmount: columns[2].innerText,
              chargedAmount: columns[3].innerText,
              memo: columns[4].innerText,
            };
          }
          return null;
        });
      }, billingDate);

      accountTransactions.push(...convertTransactions((rawTransactions as ScrapedTransaction[])
        .filter((item) => !!item)));

      hasNextPage = await elementPresentOnPage(page, nextPageSelector);
      if (hasNextPage) {
        await clickButton(page, '[id$=FormAreaNoBorder_FormArea_ctlGridPager_btnNext]');
        await waitForNavigationAndDomLoad(page);
      }
    } while (hasNextPage);
  }

  const txns = filterOldTransactions(accountTransactions, startDate, scraperOptions.combineInstallments || false);

  return {
    accountNumber,
    txns,
  };
}

async function getAccountNumbers(page: Page): Promise<string[]> {
  return pageEvalAll(page, '[id$=lnkItem]', [], (elements) => elements.map((e) => (e as HTMLAnchorElement).text)).then((res) => res.map((text) => /\d+$/.exec(text.trim())?.[0] ?? ''));
}

async function setAccount(page: Page, account: string) {
  await pageEvalAll(
    page,
    '[id$=lnkItem]',
    null,
    (elements, account) => {
      for (const elem of elements) {
        const a = elem as HTMLAnchorElement;
        if (a.text.includes(account)) {
          a.click();
        }
      }
    },
    account,
  );
}

async function fetchTransactions(page: Page, startDate: Moment, scraperOptions: ScaperOptions): Promise<TransactionsAccount[]> {
  const accountNumbers: string[] = await getAccountNumbers(page);
  const accounts: TransactionsAccount[] = [];

  for (const account of accountNumbers) {
    await setAccount(page, account);
    accounts.push(
      await fetchTransactionsForAccount(
        page,
        startDate,
        account,
        scraperOptions,
      ),
    );
  }

  return accounts;
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
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/78.0.3904.108 Safari/537.36',
    };
  }

  async fetchData(): Promise<ScaperScrapingResult> {
    const defaultStartMoment = moment().subtract(1, 'years').add(1, 'day');
    const startDate = this.options.startDate || defaultStartMoment.toDate();
    const startMoment = moment.max(defaultStartMoment, moment(startDate));

    await this.navigateTo(TRANSACTIONS_URL, undefined, 60000);

    const accounts = await fetchTransactions(this.page, startMoment, this.options);
    return {
      success: true,
      accounts,
    };
  }
}

export default VisaCalScraper;
