import { Browser, Page } from 'puppeteer';
import { CompanyTypes, ScraperProgressTypes } from '../definitions';
import { TransactionsAccount } from '../transactions';
import { ErrorResult, ScraperErrorTypes } from './errors';

// TODO: Remove this type when the scraper 'factory' will return concrete scraper types
// Instead of a generic interface (which in turn uses this type)
export type ScraperCredentials =
    { userCode: string, password: string } |
    { username: string, password: string } |
    { id: string, password: string } |
    { id: string, password: string, num: string } |
    { id: string, password: string, card6Digits: string } |
    { username: string, nationalID: string, password: string } |
    ({ email: string, password: string } & ({
      otpCodeRetriever: () => Promise<string>;
      phoneNumber: string;
    } | {
      otpLongTermToken: string;
    }));

export interface FutureDebit {
  amount: number;
  amountCurrency: string;
  chargeDate?: string;
  bankAccountNumber?: string;
}

export interface ScraperOptions {
  /**
   * The company you want to scrape
   */
  companyId: CompanyTypes;

  /**
   * include more debug info about in the output
   */
  verbose?: boolean;

  /**
   * the date to fetch transactions from (can't be before the minimum allowed time difference for the scraper)
   */
  startDate: Date;

  /**
   * shows the browser while scraping, good for debugging (default false)
   */
  showBrowser?: boolean;

  /**
   * scrape transactions to be processed X months in the future
   */
  futureMonthsToScrape?: number;

  /**
   * option from init puppeteer browser instance outside the libary scope. you can get
   * browser diretly from puppeteer via `puppeteer.launch()`
   */
  browser?: any;

  /**
   * provide a patch to local chromium to be used by puppeteer. Relevant when using
   * `israeli-bank-scrapers-core` library
   */
  executablePath?: string;

  /**
   * if set to true, all installment transactions will be combine into the first one
   */
  combineInstallments?: boolean;

  /**
   * additional arguments to pass to the browser instance. The list of flags can be found in
   *
   * https://developer.mozilla.org/en-US/docs/Mozilla/Command_Line_Options
   * https://peter.sh/experiments/chromium-command-line-switches/
   */
  args?: string[];

  /**
   * Maximum navigation time in milliseconds, pass 0 to disable timeout.
   * @default 30000
   */
  timeout?: number | undefined;

  /**
   * adjust the browser instance before it is being used
   *
   * @param browser
   */
  prepareBrowser?: (browser: Browser) => Promise<void>;

  /**
   * adjust the page instance before it is being used.
   *
   * @param page
   */
  preparePage?: (page: Page) => Promise<void>;

  /**
   * if set, store a screenshot if failed to scrape. Used for debug purposes
   */
  storeFailureScreenShotPath?: string;

  /**
   * if set, will set the timeout in milliseconds of puppeteer's `page.setDefaultTimeout`.
   */
  defaultTimeout?: number;

  /**
   * Options for manipulation of output data
   */
  outputData?: OutputDataOptions;

  /**
   * Perform additional operation for each transaction to get more information (Like category) about it.
   * Please note: It will take more time to finish the process.
   */
  additionalTransactionInformation?: boolean;
}

export interface OutputDataOptions {
  /**
   * if true, the result wouldn't be filtered out by date, and you will return unfiltered scrapped data.
   */
  enableTransactionsFilterByDate?: boolean;
}

export interface ScraperScrapingResult {
  success: boolean;
  accounts?: TransactionsAccount[];
  futureDebits?: FutureDebit[];
  errorType?: ScraperErrorTypes;
  errorMessage?: string; // only on success=false
}

export interface Scraper<TCredentials extends ScraperCredentials> {
  scrape(credentials: TCredentials): Promise<ScraperScrapingResult>;
  onProgress(func: (companyId: CompanyTypes, payload: { type: ScraperProgressTypes }) => void): void;
  triggerTwoFactorAuth(phoneNumber: string): Promise<ScraperTwoFactorAuthTriggerResult>;
  getLongTermTwoFactorToken(otpCode: string): Promise<ScraperGetLongTermTwoFactorTokenResult>;
}

export type ScraperTwoFactorAuthTriggerResult = ErrorResult | {
  success: true;
};

export type ScraperGetLongTermTwoFactorTokenResult = ErrorResult | {
  success: true;
  longTermTwoFactorAuthToken: string;
};

export interface ScraperLoginResult {
  success: boolean;
  errorType?: ScraperErrorTypes;
  errorMessage?: string; // only on success=false
  persistentOtpToken?: string;
}
