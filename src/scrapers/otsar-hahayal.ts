// eslint-disable-next-line import/named
import moment, { Moment } from 'moment';
import { Page } from 'puppeteer';
import { SHEKEL_CURRENCY, SHEKEL_CURRENCY_SYMBOL } from '../constants';
import {
  clickButton,
  elementPresentOnPage,
  fillInput,
  pageEvalAll,
  waitUntilElementFound,
} from '../helpers/elements-interactions';
import { waitForNavigation } from '../helpers/navigation';
import { sleep } from '../helpers/waiting';
import { Transaction, TransactionStatuses, TransactionTypes } from '../transactions';
import { BaseScraperWithBrowser, LoginResults, PossibleLoginResults } from './base-scraper-with-browser';

const BASE_URL = 'https://online.bankotsar.co.il';
const LONG_DATE_FORMAT = 'DD/MM/YYYY';
const DATE_FORMAT = 'DD/MM/YY';

interface ScrapedTransaction {
  balance?: string;
  debit?: string;
  credit?: string;
  memo?: string;
  status?: string;
  reference?: string;
  description?: string;
  date: string;
}

function getPossibleLoginResults(page: Page) {
  const urls: PossibleLoginResults = {};
  urls[LoginResults.Success] = [`${BASE_URL}/wps/myportal/FibiMenu/Online`];
  urls[LoginResults.InvalidPassword] = [() => elementPresentOnPage(page, '#validationMsg')];
  // TODO: support change password
  /* urls[LOGIN_RESULT.CHANGE_PASSWORD] = [``]; */
  return urls;
}

function getTransactionsUrl() {
  return `${BASE_URL}/wps/myportal/FibiMenu/Online/OnAccountMngment/OnBalanceTrans/PrivateAccountFlow`;
}

function createLoginFields(credentials: ScraperSpecificCredentials) {
  return [
    { selector: '#username', value: credentials.username },
    { selector: '#password', value: credentials.password },
  ];
}

function getAmountData(amountStr: string, hasCurrency = false) {
  const amountStrCln = amountStr.replace(',', '');
  let currency: string | null = null;
  let amount: number | null = null;
  if (!hasCurrency) {
    amount = parseFloat(amountStrCln);
    currency = SHEKEL_CURRENCY;
  } else if (amountStrCln.includes(SHEKEL_CURRENCY_SYMBOL)) {
    amount = parseFloat(amountStrCln.replace(SHEKEL_CURRENCY_SYMBOL, ''));
    currency = SHEKEL_CURRENCY;
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

function convertTransactions(txns: ScrapedTransaction[]): Transaction[] {
  return txns.map((txn) => {
    const dateFormat =
        txn.date.length === 8 ?
          DATE_FORMAT :
          txn.date.length === 10 ?
            LONG_DATE_FORMAT :
            null;
    if (!dateFormat) {
      throw new Error('invalid date format');
    }
    const txnDate = moment(txn.date, dateFormat).toISOString();
    const credit = getAmountData(txn.credit || '').amount;
    const debit = getAmountData(txn.debit || '').amount;
    const amount = (Number.isNaN(credit) ? 0 : credit) - (Number.isNaN(debit) ? 0 : debit);

    const result: Transaction = {
      type: TransactionTypes.Normal,
      status: TransactionStatuses.Completed,
      identifier: txn.reference ? parseInt(txn.reference, 10) : undefined,
      date: txnDate,
      processedDate: txnDate,
      originalAmount: amount,
      originalCurrency: SHEKEL_CURRENCY,
      chargedAmount: amount,
      description: txn.description || '',
      memo: '',
    };

    return result;
  });
}

async function parseTransactionPage(page: Page): Promise<ScrapedTransaction[]> {
  const tdsValues = await pageEvalAll(page, '#dataTable077 tbody tr', [], (trs) => {
    return (trs).map((el) => ({
      date: (el.querySelector('.date') as HTMLElement).innerText,
      // reference and description have vice-versa class name
      description: (el.querySelector('.reference') as HTMLElement).innerText,
      reference: (el.querySelector('.details') as HTMLElement).innerText,
      credit: (el.querySelector('.credit') as HTMLElement).innerText,
      debit: (el.querySelector('.debit') as HTMLElement).innerText,
      balance: (el.querySelector('.balance') as HTMLElement).innerText,
    }));
  });

  return tdsValues;
}

async function getAccountSummary(page: Page) {
  const balanceElm = await page.$('.current_balance');
  const balanceInnerTextElm = await balanceElm!.getProperty('innerText');
  const balanceText = await balanceInnerTextElm.jsonValue();
  const balanceValue = getAmountData(balanceText as string, true);
  // TODO: Find the credit field in bank website (could see it in my account)
  return {
    balance: Number.isNaN(balanceValue.amount) ? 0 : balanceValue.amount,
    creditLimit: 0.0,
    creditUtilization: 0.0,
    balanceCurrency: balanceValue.currency,
  };
}

async function fetchTransactionsForAccount(page: Page, startDate: Moment) {
  const summary = await getAccountSummary(page);
  await waitUntilElementFound(page, 'input#fromDate');
  // Get account number
  const branchNum = await page.$eval('.branch_num', (span) => {
    return (span as HTMLElement).innerText;
  });

  const accountNmbr = await page.$eval('.acc_num', (span) => {
    return (span as HTMLElement).innerText;
  });
  const accountNumber = `14-${branchNum}-${accountNmbr}`;
  // Search for relavant transaction from startDate
  await clickButton(page, '#tabHeader4');
  await fillInput(
    page,
    'input#fromDate',
    startDate.format('DD/MM/YYYY'),
  );

  await clickButton(page, '#fibi_tab_dates .fibi_btn:nth-child(2)');
  await waitForNavigation(page);
  await waitUntilElementFound(page, 'table#dataTable077, #NO_DATA077');
  let hasNextPage = true;
  let txns: ScrapedTransaction[] = [];

  const noTransactionElm = await page.$('#NO_DATA077');
  if (noTransactionElm == null) {
    // Scape transactions (this maybe spanned on multiple pages)
    while (hasNextPage) {
      const pageTxns = await parseTransactionPage(page);
      txns = txns.concat(pageTxns);
      const button = await page.$('#Npage');
      hasNextPage = false;
      if (button != null) {
        hasNextPage = true;
      }
      if (hasNextPage) {
        await clickButton(page, '#Npage');
        await waitForNavigation(page);
        await waitUntilElementFound(page, 'table#dataTable077');
      }
    }
  }

  return {
    accountNumber,
    summary,
    txns: convertTransactions(txns.slice(1)), // Remove first line which is "opening balance"
  };
}

async function fetchTransactions(page: Page, startDate: Moment) {
  // TODO need to extend to support multiple accounts and foreign accounts
  return [await fetchTransactionsForAccount(page, startDate)];
}

async function waitForPostLogin(page: Page) {
  // TODO check for condition to provide new password
  return Promise.race([
    waitUntilElementFound(page, 'div.lotusFrame', true),
    waitUntilElementFound(page, '#validationMsg'),
  ]);
}

type ScraperSpecificCredentials = { username: string, password: string };

class OtsarHahayalScraper extends BaseScraperWithBrowser<ScraperSpecificCredentials> {
  getLoginOptions(credentials: ScraperSpecificCredentials) {
    return {
      loginUrl: `${BASE_URL}/MatafLoginService/MatafLoginServlet?bankId=OTSARPRTAL&site=Private&KODSAFA=HE`,
      fields: createLoginFields(credentials),
      submitButtonSelector: async () => {
        await sleep(1000);
        await clickButton(this.page, '#continueBtn');
      },
      postAction: async () => waitForPostLogin(this.page),
      possibleResults: getPossibleLoginResults(this.page),
    };
  }

  async fetchData() {
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

export default OtsarHahayalScraper;
