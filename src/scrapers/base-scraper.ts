import { EventEmitter } from 'events';
import { TimeoutError } from '../helpers/waiting';
import { ErrorTypes, LegacyLoginResult, LegacyScrapingResult } from '../types';
import { SCRAPERS } from '../definitions';

const SCRAPE_PROGRESS = 'SCRAPE_PROGRESS';

export type ScraperCredentials = Record<string, string>;

function createErrorResult(errorType: ErrorTypes, errorMessage: string) {
  return {
    success: false,
    errorType,
    errorMessage,
  };
}

function createTimeoutError(errorMessage: string) {
  return createErrorResult(ErrorTypes.Timeout, errorMessage);
}

function createGenericError(errorMessage: string) {
  return createErrorResult(ErrorTypes.Generic, errorMessage);
}

export interface BaseScraperOptions {
  companyId: keyof typeof SCRAPERS;
  verbose: boolean;
  startDate: Date;
  showBrowser: boolean;
  browser: any;
  executablePath?: string;
  combineInstallments?: boolean;
}


export enum ScrapeProgressTypes {
  Initializing = 'INITIALIZING',
  StartScraping = 'START_SCRAPING',
  LoggingIn = 'LOGGING_IN',
  LoginSuccess = 'LOGIN_SUCCESS',
  LoginFailed = 'LOGIN_FAILED',
  ChangePassword = 'CHANGE_PASSWORD',
  EndScraping = 'END_SCRAPING',
  Terminating = 'TERMINATING',
}

export class BaseScraper {
  private eventEmitter = new EventEmitter();

  constructor(public options: BaseScraperOptions) {
  }

  async initialize() {
    this.emitProgress(ScrapeProgressTypes.Initializing);
  }

  async scrape(credentials: ScraperCredentials): Promise<LegacyScrapingResult> {
    this.emitProgress(ScrapeProgressTypes.StartScraping);
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
      await this.terminate();
    } catch (e) {
      scrapeResult = createGenericError(e.message);
    }
    this.emitProgress(ScrapeProgressTypes.EndScraping);

    return scrapeResult;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async login(credentials: Record<string, string>): Promise<LegacyLoginResult> {
    throw new Error(`login() is not created in ${this.options.companyId}`);
  }

  async fetchData(): Promise<LegacyScrapingResult> {
    throw new Error(`fetchData() is not created in ${this.options.companyId}`);
  }

  async terminate() {
    this.emitProgress(ScrapeProgressTypes.Terminating);
  }

  emitProgress(type: ScrapeProgressTypes) {
    this.emit(SCRAPE_PROGRESS, { type });
  }

  emit(eventName: string, payload: Record<string, any>) {
    this.eventEmitter.emit(eventName, this.options.companyId, payload);
  }

  onProgress(func: (...args: any[]) => void) {
    this.eventEmitter.on(SCRAPE_PROGRESS, func);
  }
}
