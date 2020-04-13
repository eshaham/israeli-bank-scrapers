import { EventEmitter } from 'events';

import { ScrapeProgressTypes, ERRORS } from '../constants';
import { TimeoutError } from '../helpers/waiting';
import { LegacyLoginResult, LegacyScrapingResult } from '../types';

const SCRAPE_PROGRESS = 'SCRAPE_PROGRESS';

function createErrorResult(errorType, errorMessage) {
  return {
    success: false,
    errorType,
    errorMessage,
  };
}

function createTimeoutError(errorMessage) {
  return createErrorResult(ERRORS.TIMEOUT, errorMessage);
}

function createGenericError(errorMessage) {
  return createErrorResult(ERRORS.GENERIC, errorMessage);
}

// TODO es consider browser type
export interface BaseScraperOptions {
  companyId: string;
  verbose: boolean;
  startDate: Date;
  showBrowser: boolean;
  browser: any;
  executablePath?: string;
}

class BaseScraper {
  private eventEmitter = new EventEmitter();

  constructor(public options: BaseScraperOptions) {
  }

  async initialize() {
    this.emitProgress(ScrapeProgressTypes.Initializing);
  }

  async scrape(credentials) {
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

  emitProgress(type) {
    this.emit(SCRAPE_PROGRESS, { type });
  }

  emit(eventName, payload) {
    this.eventEmitter.emit(eventName, this.options.companyId, payload);
  }

  onProgress(func) {
    this.eventEmitter.on(SCRAPE_PROGRESS, func);
  }
}

export { BaseScraper };
