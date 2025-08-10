import moment, { type Moment } from 'moment';
import { type HTTPResponse, type Page } from 'puppeteer';
import { SHEKEL_CURRENCY } from '../constants';
import { getDebug } from '../helpers/debug';
import { clickButton, fillInput, pageEval, pageEvalAll, waitUntilElementFound } from '../helpers/elements-interactions';
import { waitForNavigation } from '../helpers/navigation';
import { TransactionStatuses, TransactionTypes, type Transaction, type TransactionsAccount } from '../transactions';
import { type Investment, type Portfolio } from '../investments';
import { BaseScraperWithBrowser, LoginResults, type LoginOptions } from './base-scraper-with-browser';
import { type ScraperScrapingResult } from './interface';

const debug = getDebug('leumi');
const BASE_URL = 'https://hb2.bankleumi.co.il';
const LOGIN_URL = 'https://www.leumi.co.il/';
const TRANSACTIONS_URL = `${BASE_URL}/eBanking/SO/SPA.aspx#/ts/BusinessAccountTrx?WidgetPar=1`;
const FILTERED_TRANSACTIONS_URL = `${BASE_URL}/ChannelWCF/Broker.svc/ProcessRequest?moduleName=UC_SO_27_GetBusinessAccountTrx`;
const LEUMI_TRADING_URL = `${BASE_URL}/lti/lti-app/trade/portfolio`;

const DATE_FORMAT = 'DD.MM.YY';
const ACCOUNT_BLOCKED_MSG = 'המנוי חסום';
const INVALID_PASSWORD_MSG = 'אחד או יותר מפרטי ההזדהות שמסרת שגויים. ניתן לנסות שוב';

function getPossibleLoginResults() {
  const urls: LoginOptions['possibleResults'] = {
    [LoginResults.Success]: [/ebanking\/SO\/SPA.aspx/i],
    [LoginResults.InvalidPassword]: [
      async options => {
        if (!options || !options.page) {
          throw new Error('missing page options argument');
        }
        const errorMessage = await pageEvalAll(options.page, 'svg#Capa_1', '', element => {
          return (element[0]?.parentElement?.children[1] as HTMLDivElement)?.innerText;
        });

        return errorMessage?.startsWith(INVALID_PASSWORD_MSG);
      },
    ],
    [LoginResults.AccountBlocked]: [
      // NOTICE - might not be relevant starting the Leumi re-design during 2022 Sep
      async options => {
        if (!options || !options.page) {
          throw new Error('missing page options argument');
        }
        const errorMessage = await pageEvalAll(options.page, '.errHeader', '', label => {
          return (label[0] as HTMLElement)?.innerText;
        });

        return errorMessage?.startsWith(ACCOUNT_BLOCKED_MSG);
      },
    ],
    [LoginResults.ChangePassword]: ['https://hb2.bankleumi.co.il/authenticate'], // NOTICE - might not be relevant starting the Leumi re-design during 2022 Sep
  };
  return urls;
}

function createLoginFields(credentials: ScraperSpecificCredentials) {
  return [
    { selector: 'input[placeholder="שם משתמש"]', value: credentials.username },
    { selector: 'input[placeholder="סיסמה"]', value: credentials.password },
  ];
}

function extractTransactionsFromPage(transactions: any[], status: TransactionStatuses): Transaction[] {
  if (transactions === null || transactions.length === 0) {
    return [];
  }

  const result: Transaction[] = transactions.map(rawTransaction => {
    const date = moment(rawTransaction.DateUTC).milliseconds(0).toISOString();
    const newTransaction: Transaction = {
      status,
      type: TransactionTypes.Normal,
      date,
      processedDate: date,
      description: rawTransaction.Description || '',
      identifier: rawTransaction.ReferenceNumberLong,
      memo: rawTransaction.AdditionalData || '',
      originalCurrency: SHEKEL_CURRENCY,
      chargedAmount: rawTransaction.Amount,
      originalAmount: rawTransaction.Amount,
    };

    return newTransaction;
  });

  return result;
}

function hangProcess(timeout: number) {
  return new Promise<void>(resolve => {
    setTimeout(() => {
      resolve();
    }, timeout);
  });
}

async function clickByXPath(page: Page, xpath: string): Promise<void> {
  await page.waitForSelector(xpath, { timeout: 30000, visible: true });
  const elm = await page.$$(xpath);
  await elm[0].click();
}

function removeSpecialCharacters(str: string): string {
  return str.replace(/[^0-9/-]/g, '');
}

async function fetchTransactionsForAccount(
  page: Page,
  startDate: Moment,
  accountId: string,
): Promise<TransactionsAccount> {
  // DEVELOPER NOTICE the account number received from the server is being altered at
  // runtime for some accounts after 1-2 seconds so we need to hang the process for a short while.
  await hangProcess(4000);

  await waitUntilElementFound(page, 'button[title="חיפוש מתקדם"]', true);
  await clickButton(page, 'button[title="חיפוש מתקדם"]');
  await waitUntilElementFound(page, 'bll-radio-button', true);
  await clickButton(page, 'bll-radio-button:not([checked])');

  await waitUntilElementFound(page, 'input[formcontrolname="txtInputFrom"]', true);

  await fillInput(page, 'input[formcontrolname="txtInputFrom"]', startDate.format(DATE_FORMAT));

  // we must blur the from control otherwise the search will use the previous value
  await page.focus("button[aria-label='סנן']");

  await clickButton(page, "button[aria-label='סנן']");
  const finalResponse = await page.waitForResponse(response => {
    return response.url() === FILTERED_TRANSACTIONS_URL && response.request().method() === 'POST';
  });

  const responseJson: any = await finalResponse.json();

  const accountNumber = accountId.replace('/', '_').replace(/[^\d-_]/g, '');

  const response = JSON.parse(responseJson.jsonResp);

  const pendingTransactions = response.TodayTransactionsItems;
  const transactions = response.HistoryTransactionsItems;
  const balance = response.BalanceDisplay ? parseFloat(response.BalanceDisplay) : undefined;

  const pendingTxns = extractTransactionsFromPage(pendingTransactions, TransactionStatuses.Pending);
  const completedTxns = extractTransactionsFromPage(transactions, TransactionStatuses.Completed);
  const txns = [...pendingTxns, ...completedTxns];

  return {
    accountNumber,
    balance,
    txns,
  };
}

async function fetchTransactions(page: Page, startDate: Moment): Promise<TransactionsAccount[]> {
  const accounts: TransactionsAccount[] = [];

  // DEVELOPER NOTICE the account number received from the server is being altered at
  // runtime for some accounts after 1-2 seconds so we need to hang the process for a short while.
  await hangProcess(4000);

  const accountsIds = (await page.evaluate(() =>
    Array.from(document.querySelectorAll('app-masked-number-combo span.display-number-li'), e => e.textContent),
  )) as string[];

  // due to a bug, the altered value might include undesired signs like & that should be removed

  if (!accountsIds.length) {
    throw new Error('Failed to extract or parse the account number');
  }

  for (const accountId of accountsIds) {
    if (accountsIds.length > 1) {
      // get list of accounts and check accountId
      await clickByXPath(page, 'xpath///*[contains(@class, "number") and contains(@class, "combo-inner")]');
      await clickByXPath(page, `xpath///span[contains(text(), '${accountId}')]`);
    }

    accounts.push(await fetchTransactionsForAccount(page, startDate, removeSpecialCharacters(accountId)));
  }

  return accounts;
}

async function navigateToLogin(page: Page): Promise<void> {
  const loginButtonSelector = '.enter-account a[originaltitle="כניסה לחשבונך"]';
  debug('wait for homepage to click on login button');
  await waitUntilElementFound(page, loginButtonSelector);
  debug('navigate to login page');
  const loginUrl = await pageEval(page, loginButtonSelector, null, element => {
    return (element as any).href;
  });
  debug(`navigating to page (${loginUrl})`);
  await page.goto(loginUrl);
  debug('waiting for page to be loaded (networkidle2)');
  await waitForNavigation(page, { waitUntil: 'networkidle2' });
  debug('waiting for components of login to enter credentials');
  await Promise.all([
    waitUntilElementFound(page, 'input[placeholder="שם משתמש"]', true),
    waitUntilElementFound(page, 'input[placeholder="סיסמה"]', true),
    waitUntilElementFound(page, 'button[type="submit"]', true),
  ]);
}

async function waitForPostLogin(page: Page): Promise<void> {
  await Promise.race([
    waitUntilElementFound(page, 'a[title="דלג לחשבון"]', true, 60000),
    waitUntilElementFound(page, 'div.main-content', false, 60000),
    page.waitForSelector(`xpath//div[contains(string(),"${INVALID_PASSWORD_MSG}")]`),
    waitUntilElementFound(page, 'form[action="/changepassword"]', true, 60000), // not sure if they kept this one
  ]);
}

type ScraperSpecificCredentials = { username: string; password: string };

function extractPortfolios(response: HTTPResponse, portfolios: Portfolio[]) {
  response
    .json()
    .then(data => {
      debug('Portfolio data received:', data);

      const portfoliosData = data?.data.user?.Portfolios;
      debug('Portfolios:', portfoliosData);

      for (const item of portfoliosData) {
        const portfolio: Portfolio = {
          portfolioId: item.PortfolioId,
          portfolioName: item.PortfolioName,
          investments: [],
        };

        portfolios.push(portfolio);
      }
    })
    .catch(error => {
      debug('Error parsing response JSON:', error);
    });
}

function extractPortfolioInvestments(response: HTTPResponse, investments: Investment[]) {
  response
    .json()
    .then(data => {
      debug('Investment data received:', data);

      const userStatement = data?.data.UserStatement?.DataSource;
      debug('User statement:', userStatement);

      for (const item of userStatement) {
        const investment: Investment = {
          paperId: item.PaperId,
          paperName: item.PaperName,
          symbol: item.Symbol,
          amount: parseFloat(item.Amount),
          value: parseFloat(item.Value),
          currency: SHEKEL_CURRENCY,
        };

        investments.push(investment);
      }
    })
    .catch(error => {
      debug('Error parsing response JSON:', error);
    });
}

class LeumiScraper extends BaseScraperWithBrowser<ScraperSpecificCredentials> {
  getLoginOptions(credentials: ScraperSpecificCredentials) {
    return {
      loginUrl: LOGIN_URL,
      fields: createLoginFields(credentials),
      submitButtonSelector: "button[type='submit']",
      checkReadiness: async () => navigateToLogin(this.page),
      postAction: async () => waitForPostLogin(this.page),
      possibleResults: getPossibleLoginResults(),
    };
  }

  async fetchData(): Promise<ScraperScrapingResult> {
    const minimumStartMoment = moment().subtract(3, 'years').add(1, 'day');
    const defaultStartMoment = moment().subtract(1, 'years').add(1, 'day');
    const startDate = this.options.startDate || defaultStartMoment.toDate();
    const startMoment = moment.max(minimumStartMoment, moment(startDate));

    await this.navigateTo(TRANSACTIONS_URL);

    const accounts = await fetchTransactions(this.page, startMoment);
    const investments = await this.fetchInvestments();

    return {
      success: true,
      accounts,
      portfolios: investments,
    };
  }

  async fetchInvestments(): Promise<Portfolio[]> {
    await this.page.setRequestInterception(true);

    this.page.on('request', request => {
      request.continue().catch(error => {
        debug('Error continuing request:', error);
      });
    });

    const investments: Investment[] = [];
    const portfolios: Portfolio[] = [];

    this.page.on('response', response => {
      // You can filter responses based on criteria like URL, method, or resource type.
      // For XHR requests, check if the resource type is 'xhr' or 'fetch'.
      if (response.request().resourceType() !== 'xhr' && response.request().resourceType() !== 'fetch') {
        return;
      }

      if (response.url().includes('Statement')) {
        extractPortfolioInvestments(response, investments);
        return;
      }

      if (response.url().includes('lti-app/api/config')) {
        extractPortfolios(response, portfolios);
        return;
      }

      return;
    });

    await this.navigateTo(LEUMI_TRADING_URL);

    await this.page.waitForSelector('.portfolio-tbl-sticky-native', { visible: true });
    await hangProcess(5000); // Wait for the investments data to load

    portfolios[0].investments = investments;

    return portfolios;
  }
}

export default LeumiScraper;
