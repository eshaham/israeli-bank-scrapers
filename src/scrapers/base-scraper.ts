import { EventEmitter } from 'events';
import { Browser, Page } from 'puppeteer';
import moment from 'moment-timezone';
import { TimeoutError } from '../helpers/waiting';
import { TransactionsAccount } from '../transactions';
import { CompanyTypes } from '../definitions';

const SCRAPE_PROGRESS = 'SCRAPE_PROGRESS';

export enum ScraperErrorTypes {
  InvalidPassword ='INVALID_PASSWORD',
  ChangePassword = 'CHANGE_PASSWORD',
  Timeout = 'TIMEOUT',
  AccountBlocked = 'ACCOUNT_BLOCKED',
  Generic = 'GENERIC',
  General = 'GENERAL_ERROR'
}

export interface ScaperLoginResult {
  success: boolean;
  errorType?: ScraperErrorTypes;
  errorMessage?: string; // only on success=false
}

export interface FutureDebit {
  amount: number;
  amountCurrency: string;
  chargeDate?: string;
  bankAccountNumber?: string;
}

export interface ScaperScrapingResult {
  success: boolean;
  accounts?: TransactionsAccount[];
  futureDebits?: FutureDebit[];
  errorType?: ScraperErrorTypes;
  errorMessage?: string; // only on success=false
}

export type ScraperCredentials = Record<string, string>;

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
}

export enum ScaperProgressTypes {
  Initializing = 'INITIALIZING',
  StartScraping = 'START_SCRAPING',
  LoggingIn = 'LOGGING_IN',
  LoginSuccess = 'LOGIN_SUCCESS',
  LoginFailed = 'LOGIN_FAILED',
  ChangePassword = 'CHANGE_PASSWORD',
  EndScraping = 'END_SCRAPING',
  Terminating = 'TERMINATING',
}

function createErrorResult(errorType: ScraperErrorTypes, errorMessage: string) {
  return {
    success: false,
    errorType,
    errorMessage,
  };
}

function createTimeoutError(errorMessage: string) {
  return createErrorResult(ScraperErrorTypes.Timeout, errorMessage);
}

function createGenericError(errorMessage: string) {
  return createErrorResult(ScraperErrorTypes.Generic, errorMessage);
}

export class BaseScraper {
  private eventEmitter = new EventEmitter();

  constructor(public options: ScraperOptions) {
  }

  // eslint-disable-next-line  @typescript-eslint/require-await
  async initialize() {
    this.emitProgress(ScaperProgressTypes.Initializing);

    moment.tz.setDefault('Asia/Jerusalem');
  }

  async scrape(credentials: ScraperCredentials): Promise<ScaperScrapingResult> {
    this.emitProgress(ScaperProgressTypes.StartScraping);
    await this.initialize();

    let loginResult;
    try {
      loginResult = await this.login(credentials);
    } catch (e) {
      loginResult = e instanceof TimeoutError ?
        createTimeoutError(e.message) :
        createGenericError(e.message);
    }

    let scrapeResult;
    if (loginResult.success) {
      try {
        scrapeResult = await this.fetchData();
      } catch (e) {
        scrapeResult =
          e instanceof TimeoutError ?
            createTimeoutError(e.message) :
            createGenericError(e.message);
      }
    } else {
      scrapeResult = loginResult;
    }

    try {
      const success = scrapeResult && scrapeResult.success === true;
      await this.terminate(success);
    } catch (e) {
      scrapeResult = createGenericError(e.message);
    }
    this.emitProgress(ScaperProgressTypes.EndScraping);

    return scrapeResult;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/require-await
  async login(_credentials: Record<string, string>): Promise<ScaperLoginResult> {
    throw new Error(`login() is not created in ${this.options.companyId}`);
  }

  // eslint-disable-next-line  @typescript-eslint/require-await
  async fetchData(): Promise<ScaperScrapingResult> {
    throw new Error(`fetchData() is not created in ${this.options.companyId}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/require-await
  async terminate(_success: boolean) {
    this.emitProgress(ScaperProgressTypes.Terminating);
  }

  emitProgress(type: ScaperProgressTypes) {
    this.emit(SCRAPE_PROGRESS, { type });
  }

  emit(eventName: string, payload: Record<string, any>) {
    this.eventEmitter.emit(eventName, this.options.companyId, payload);
  }

  onProgress(func: (...args: any[]) => void) {
    this.eventEmitter.on(SCRAPE_PROGRESS, func);
  }
}
