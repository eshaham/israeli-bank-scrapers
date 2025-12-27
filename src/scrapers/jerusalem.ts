import moment, { type Moment } from 'moment';
import { type Page } from 'puppeteer';
// @ts-ignore - puppeteer-extra doesn't have types
import puppeteerExtra from 'puppeteer-extra';
// @ts-ignore - puppeteer-extra-plugin-stealth doesn't have types
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { SHEKEL_CURRENCY } from '../constants';
import { ScraperProgressTypes } from '../definitions';
import { getDebug } from '../helpers/debug';
import { waitUntilElementFound } from '../helpers/elements-interactions';
import { TransactionStatuses, TransactionTypes, type Transaction, type TransactionsAccount } from '../transactions';
import { BaseScraperWithBrowser, LoginResults, type LoginOptions } from './base-scraper-with-browser';
import { type ScraperScrapingResult } from './interface';

// Configure stealth plugin to get past Radware anti-bot detection
const stealthPlugin = StealthPlugin();
stealthPlugin.enabledEvasions.delete('user-agent-override'); // Disable user-agent-override evasion so we can set a custom user agent
puppeteerExtra.use(stealthPlugin);

const debug = getDebug('jerusalem');
const BASE_URL = 'https://services.bankjerusalem.co.il';
const LOGIN_URL = `${BASE_URL}/en/Pages/Login.aspx`; // Use English pages so all text and errors are in English
const TRANSACTIONS_URL = `${BASE_URL}/en/currentaccount/pages/default.aspx`;
const SAVINGS_URL = `${BASE_URL}/en/savingsanddeposits/pages/default.aspx`;

const DATE_FORMAT = 'DD.MM.YYYY';

/**
 * Returns possible login result configurations for authentication detection.
 * Checks for successful login or invalid password scenarios.
 */
function getPossibleLoginResults() {
  const urls: LoginOptions['possibleResults'] = {
    [LoginResults.Success]: [new RegExp(`${BASE_URL}/(en/)?Pages/Trans.aspx`, 'i')],
    [LoginResults.InvalidPassword]: [
      async options => {
        if (!options || !options.page) {
          return false;
        }
        // Check for the error message that appears on invalid credentials
        const errorElement = await options.page.$('.loginErrorMsg');
        if (!errorElement) {
          return false;
        }
        const errorText = await options.page.evaluate(el => el?.textContent || '', errorElement);
        return errorText.includes('Identifying data entered is incorrect');
      },
    ],
  };
  return urls;
}

/**
 * Creates login field configuration for form filling.
 * @param credentials - User credentials containing username and password
 * @returns Array of field selectors and values for the login form
 */
function createLoginFields(credentials: ScraperSpecificCredentials) {
  return [
    { selector: '#txtUsername', value: credentials.username },
    { selector: '#txtPassword', value: credentials.password },
  ];
}

/**
 * Converts raw transaction data into standardized Transaction objects.
 * @param transactions - Array of raw transaction data from the bank
 * @param status - Transaction status (completed, pending, etc.)
 * @returns Array of normalized Transaction objects
 */
function extractTransactionsFromPage(transactions: any[], status: TransactionStatuses): Transaction[] {
  if (transactions === null || transactions.length === 0) {
    return [];
  }

  const result: Transaction[] = transactions.map(rawTransaction => {
    const date = moment(rawTransaction.date, DATE_FORMAT).milliseconds(0).toISOString();
    const newTransaction: Transaction = {
      status,
      type: TransactionTypes.Normal,
      date,
      processedDate: date,
      description: rawTransaction.description || '',
      identifier: rawTransaction.reference || undefined,
      memo: rawTransaction.memo || '',
      originalCurrency: SHEKEL_CURRENCY,
      chargedAmount: rawTransaction.amount,
      originalAmount: rawTransaction.amount,
    };

    return newTransaction;
  });

  return result;
}

/**
 * Removes special characters from account numbers, keeping only digits, hyphens, and slashes.
 * @param str - String to clean
 * @returns Cleaned string with only allowed characters
 */
function removeSpecialCharacters(str: string): string {
  return str.replace(/[^0-9/-]/g, '');
}

/**
 * Fetches transactions for a specific account from the transactions page.
 * @param page - Puppeteer page instance
 * @param startDate - Starting date for transaction history
 * @param accountId - Account identifier
 * @param alreadyOnPage - Whether already navigated to the transactions page (optimization)
 * @returns Promise resolving to account with transactions and balance
 */
async function fetchTransactionsForAccount(
  page: Page,
  startDate: Moment,
  accountId: string,
  alreadyOnPage = false,
): Promise<TransactionsAccount> {
  debug('Fetching transactions for account: %s', accountId);

  // Navigate to transactions page with date range only if not already there
  if (!alreadyOnPage) {
    const endDate = moment();
    const transactionsUrlWithDates = `${TRANSACTIONS_URL}?ltFrom=${startDate.format(DATE_FORMAT)}&ltTo=${endDate.format(DATE_FORMAT)}`;

    debug('Navigating to: %s', transactionsUrlWithDates);
    await page.goto(transactionsUrlWithDates, { waitUntil: 'networkidle2' });
  }

  // Extract transactions from the page using actual Bank of Jerusalem HTML structure
  const transactions = await page.evaluate(() => {
    const txnElements = document.querySelectorAll('table.ServiceTable.CurrentAccountLastTransactions tbody tr');
    const txns: any[] = [];

    txnElements.forEach(element => {
      const cells = element.querySelectorAll('td');
      if (cells.length < 5) return;

      // Get date from first cell with DateHover span
      const dateSpan = cells[0].querySelector('span.DateHover');
      const dateText = dateSpan?.textContent?.trim();

      // Get description from second cell with transSpan
      const descSpan = cells[1].querySelector('span.transSpan');
      const descriptionText = descSpan?.textContent?.trim() || cells[1].textContent?.trim();

      // Get reference from third cell ReferenceID div - default to '0' if empty
      const refDiv = cells[2].querySelector('div.ReferenceID');
      const referenceText = refDiv?.textContent?.trim() || '0';

      // Get amount from fourth cell (last-transactions-amount)
      const amountDiv = cells[3].querySelector('div');
      const amountText = amountDiv?.textContent?.trim();

      // Get balance from fifth cell (last-transactions-balance)
      const balanceDiv = cells[4].querySelector('div');
      const balanceText = balanceDiv?.textContent?.trim();

      if (dateText && descriptionText && amountText) {
        const amount = parseFloat(amountText.replace(/[^0-9.-]/g, ''));
        const balance = balanceText ? parseFloat(balanceText.replace(/[^0-9.-]/g, '')) : undefined;

        txns.push({
          date: dateText,
          description: descriptionText,
          amount,
          reference: referenceText || '',
          memo: '',
          balance,
        });
      }
    });

    return txns;
  });

  // Extract account balance from the revaluedBalance table
  const balance = await page.evaluate(() => {
    const balanceCell = document.querySelector('td.revaluedBalance');
    if (balanceCell) {
      // Get the second div which contains the actual balance number
      const balanceDivs = balanceCell.querySelectorAll('div');
      if (balanceDivs.length >= 2) {
        const balanceText = balanceDivs[1].textContent?.trim() || '';
        const balanceValue = parseFloat(balanceText.replace(/[^0-9.-]/g, ''));
        return isNaN(balanceValue) ? undefined : balanceValue;
      }
    }
    return undefined;
  });

  const accountNumber = removeSpecialCharacters(accountId);

  // Separate pending and completed transactions based on status indicators
  const allTxns = extractTransactionsFromPage(transactions, TransactionStatuses.Completed);

  return {
    accountNumber,
    balance,
    txns: allTxns,
  };
}

/**
 * Fetches savings/deposit accounts associated with the main account.
 * Extracts deposit information including balance and deposit numbers.
 * @param page - Puppeteer page instance
 * @param accountId - Main account identifier
 * @returns Promise resolving to array of savings account objects
 */
async function getSavingsAccounts(page: Page, accountId: string): Promise<TransactionsAccount[]> {
  debug('========== FETCHING SAVINGS ACCOUNTS ==========');
  debug('Account: %s', accountId);

  const accounts: TransactionsAccount[] = [];

  try {
    debug('Navigating to savings page: %s', SAVINGS_URL);
    await page.goto(SAVINGS_URL, { waitUntil: 'networkidle2' });

    // Extract savings deposits using div.depositsEntry elements
    const deposits = await page.evaluate(() => {
      const depositsData: any[] = [];

      // Find all deposit entries (div.depositsEntry)
      const depositEntries = document.querySelectorAll('div.depositsEntry');

      depositEntries.forEach(entry => {
        try {
          // Get deposit number from title
          const depositTitleNumber = entry.querySelector('span.depositTitleNumber');
          let depositNumber = '';

          if (depositTitleNumber) {
            const depositNumberMatch = depositTitleNumber.textContent?.match(/Deposit number\s+(\d+)/i);
            if (depositNumberMatch) {
              depositNumber = depositNumberMatch[1];
            }
          }

          // Get product name from title
          const depositTitleName = entry.querySelector('span.depositTitleName');
          const productName = depositTitleName?.textContent?.trim() || 'Deposit';

          // Get the revalued balance (current balance)
          let balance = 0;

          // Look for "Revalued balance" in depositDetailsLast
          const detailsLastDivs = entry.querySelectorAll('div.depositDetailsLast');

          for (const detailDiv of Array.from(detailsLastDivs)) {
            const detailName = detailDiv.querySelector('span.detailsName');
            if (detailName?.textContent?.includes('Revalued balance')) {
              const detailValue = detailDiv.querySelector('div.detailsValue');
              if (detailValue) {
                const balanceText = detailValue.textContent || '';
                const balanceMatch = balanceText.match(/(?:NIS|₪)\s*([\d,]+\.?\d*)/);

                if (balanceMatch) {
                  const balanceValue = balanceMatch[1].replace(/,/g, '');
                  balance = parseFloat(balanceValue);
                }
              }
              break;
            }
          }

          // If we have valid data, add to deposits
          if (depositNumber && !isNaN(balance) && balance > 0) {
            depositsData.push({
              depositNumber,
              productName,
              balance,
            });
          }
        } catch (error) {
          console.error('Error parsing deposit entry:', error);
        }
      });

      return depositsData;
    });

    if (!deposits || deposits.length === 0) {
      debug('  - No savings deposits found');
      return accounts;
    }

    debug('✓ Found %d savings deposits', deposits.length);

    // Create a separate account for each individual deposit
    for (const deposit of deposits) {
      const depositAccountNumber = `${accountId}-${deposit.depositNumber}`;

      debug('  - Deposit: %s, Product: %s, Balance: %s', deposit.depositNumber, deposit.productName, deposit.balance);

      accounts.push({
        accountNumber: depositAccountNumber,
        balance: deposit.balance,
        txns: [],
        savingsAccount: true,
      });
    }
  } catch (error) {
    debug('Error fetching savings accounts: %s', error);
  }

  debug('Returning %d savings account(s)', accounts.length);
  return accounts;
}

/**
 * Main function to fetch all checking accounts and their transactions.
 * Extracts account IDs from the page and fetches transaction data for each.
 * @param page - Puppeteer page instance
 * @param startDate - Starting date for transaction history
 * @returns Promise resolving to array of transaction accounts
 */
async function fetchTransactions(page: Page, startDate: Moment): Promise<TransactionsAccount[]> {
  const accounts: TransactionsAccount[] = [];

  // Navigate to transactions page first to extract account number
  const endDate = moment();
  const transactionsUrlWithDates = `${TRANSACTIONS_URL}?ltFrom=${startDate.format(DATE_FORMAT)}&ltTo=${endDate.format(DATE_FORMAT)}`;

  debug('Navigating to transactions page: %s', transactionsUrlWithDates);
  await page.goto(transactionsUrlWithDates, { waitUntil: 'networkidle2' });

  // Extract account ID from the transactions page
  const accountsIds = await page.evaluate(() => {
    // Bank of Jerusalem displays account in format "Account 123-456789012 | NIS | ..."
    const accountLabel = document.querySelector(
      '#ctl00_PlaceHolderMain_AccountsDDL_lblAccountDetails, [id*="AccountsDDL_lblAccountDetails"]',
    );
    if (accountLabel) {
      const text = accountLabel.textContent?.trim() || '';
      // Extract account number from "Account 123-456789012 | NIS | ..."
      const match = text.match(/Account\s+([\d-]+)/i);
      if (match && match[1]) {
        return [match[1]];
      }
    }

    // Fallback to generic selectors
    const accountElements = document.querySelectorAll(
      '.account-number, [data-account-number], .account-selector option',
    );
    return Array.from(accountElements, element => {
      const text = element.textContent?.trim() || '';
      return text;
    }).filter(id => id.length > 0);
  });

  if (!accountsIds.length) {
    debug('No account IDs found');
    return accounts;
  }

  debug('Found %d account(s): %s', accountsIds.length, accountsIds.join(', '));

  // Extract transactions for the account (we're already on the page)
  for (const accountId of accountsIds) {
    accounts.push(await fetchTransactionsForAccount(page, startDate, removeSpecialCharacters(accountId), true));
  }

  return accounts;
}

/**
 * Waits for post-login page elements to appear or error messages.
 * Used to verify login completion before proceeding.
 * @param page - Puppeteer page instance
 */
async function waitForPostLogin(page: Page): Promise<void> {
  debug('Waiting for post-login page load...');
  const currentUrl = page.url();
  debug('Current URL after login: %s', currentUrl);

  await Promise.race([
    waitUntilElementFound(page, '.account-summary, .main-content, #mainContent', false, 60000),
    page.waitForSelector('.loginErrorMsgWrapper'),
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }),
  ]);

  const finalUrl = page.url();
  debug('Final URL after wait: %s', finalUrl);

  // Log page title and some content to help debug
  const title = await page.title();
  debug('Page title: %s', title);
}

type ScraperSpecificCredentials = { username: string; password: string };

class JerusalemScraper extends BaseScraperWithBrowser<ScraperSpecificCredentials> {
  /**
   * Override initialize to set up anti-bot detection measures with puppeteer-extra stealth
   */
  async initialize() {
    // Initialize the scraper but skip default browser setup
    this.emitProgress(ScraperProgressTypes.Initializing);
    debug('initialize scraper with comprehensive anti-bot measures');

    // Create browser with puppeteer-extra (stealth plugin is already applied)
    const { timeout, args, executablePath, showBrowser } = this.options as any;
    debug(`launch a stealth browser with headless mode = ${!showBrowser}`);

    // Essential launch arguments for anti-bot measures and CI/CD
    const requiredArgs = ['--no-sandbox', '--disable-setuid-sandbox'];
    const launchArgs = args ? [...requiredArgs, ...args] : requiredArgs;

    const browser = await puppeteerExtra.launch({
      headless: !showBrowser,
      executablePath,
      args: launchArgs,
      timeout,
    });

    debug('create a new stealth browser page');
    this.page = (await browser.newPage()) as any;

    // Clean up browser on terminate
    const cleanup = async () => {
      debug('closing the stealth browser');
      await browser.close();
    };

    // Store cleanup function (access private property carefully)
    (this as any).cleanups = (this as any).cleanups || [];
    (this as any).cleanups.push(cleanup);

    if (this.options.defaultTimeout) {
      this.page.setDefaultTimeout(this.options.defaultTimeout);
    }

    if (this.options.preparePage) {
      debug("execute 'preparePage' interceptor provided in options");
      await this.options.preparePage(this.page);
    }

    // Set a realistic user agent (stealth plugin's user-agent-override is disabled)
    await this.page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    );
  }

  getLoginOptions(credentials: ScraperSpecificCredentials) {
    return {
      loginUrl: LOGIN_URL,
      fields: createLoginFields(credentials),
      submitButtonSelector: '#btnConnect',
      checkReadiness: async () => {
        debug('Checking login page readiness');

        // Wait for login form elements to appear (handles captcha redirect if any)
        debug('Waiting for login form elements...');

        try {
          await waitUntilElementFound(this.page, '#txtUsername', true, 30000);
          await waitUntilElementFound(this.page, '#txtPassword', true, 30000);
          await waitUntilElementFound(this.page, '#btnConnect', true, 30000);

          debug('✓ Login form elements found - no captcha!');
        } catch (error) {
          // Check if we're stuck on a captcha page
          const pageContent = await this.page.content();
          if (
            pageContent.includes('captcha') ||
            pageContent.includes('hCaptcha') ||
            pageContent.includes('Shield Square') ||
            pageContent.includes('validate.perfdrive')
          ) {
            debug('⚠️  Captcha detected on page');
            throw new Error('Captcha page detected - bot detection triggered');
          }

          debug('Error during readiness check: %s', error);
          throw error;
        }
      },
      postAction: async () => waitForPostLogin(this.page),
      possibleResults: getPossibleLoginResults(),
    };
  }

  async fetchData(): Promise<ScraperScrapingResult> {
    const minimumStartMoment = moment().subtract(3, 'years').add(1, 'day');
    const defaultStartMoment = moment().subtract(1, 'years').add(1, 'day');
    const startDate = this.options.startDate || defaultStartMoment.toDate();
    const startMoment = moment.max(minimumStartMoment, moment(startDate));

    debug('Fetching data from %s', startMoment.format(DATE_FORMAT));

    // Fetch regular accounts
    const accounts = await fetchTransactions(this.page, startMoment);

    // Fetch savings accounts for each regular account
    const regularAccountCount = accounts.length;
    for (let i = 0; i < regularAccountCount; i++) {
      const regularAccount = accounts[i];
      const savingsAccounts = await getSavingsAccounts(this.page, regularAccount.accountNumber);
      accounts.push(...savingsAccounts);
    }

    debug('Total accounts (including savings): %d', accounts.length);

    return {
      success: true,
      accounts,
    };
  }
}

export default JerusalemScraper;
