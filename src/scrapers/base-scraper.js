import { EventEmitter } from 'events';

import { SCRAPE_PROGRESS_TYPES, LOGIN_RESULT } from '../constants';
import { NAVIGATION_ERRORS } from '../helpers/navigation';

const SCRAPE_PROGRESS = 'SCRAPE_PROGRESS';

function createErrorResult(errorType, errorMessage) {
  return {
    success: false,
    errorType,
    errorMessage,
  };
}

function createTimeoutError(errorMessage) {
  return createErrorResult(NAVIGATION_ERRORS.TIMEOUT, errorMessage);
}

function createGenericNavigationError(errorMessage) {
  return createErrorResult(NAVIGATION_ERRORS.GENERIC, errorMessage);
}

class BaseScraper {
  constructor(options) {
    this.options = options;
    this.eventEmitter = new EventEmitter();
  }

  async initialize() {
    this.emitProgress(SCRAPE_PROGRESS_TYPES.INITIALIZING);
  }

  async createResult() {
    this.emitProgress(SCRAPE_PROGRESS_TYPES.SCRAPE_DATA);
    const transactionsResult = await this.fetchData();
    if (!transactionsResult.success) {
      return transactionsResult;
    }

    this.emitProgress(SCRAPE_PROGRESS_TYPES.SCRAPE_SUMMARY);
    const summaryResult = await this.fetchSummary();
    if (!summaryResult.success) {
      return summaryResult;
    }
    const { accounts } = transactionsResult;

    summaryResult.accounts.forEach((summaryAccount) => {
      let account = accounts.find(
        account => account.accountNumber === summaryAccount.accountNumber,
      );
      if (!account) {
        account = { accountNumber: summaryAccount.accountNumber };
        accounts.push(account);
      }

      account.summary = summaryAccount.summary;
    });

    return { success: true, accounts };
  }

  async scrape(credentials) {
    this.emitProgress(SCRAPE_PROGRESS_TYPES.START_SCRAPING);
    await this.initialize();

    let loginResult;
    try {
      loginResult = await this.login(credentials);
    } catch (e) {
      loginResult = e.timeout ?
        createTimeoutError(e.message) :
        createGenericNavigationError(e.message);
    }

    let scrapeResult;
    if (loginResult.success) {
      try {
        scrapeResult = await this.createResult();
      } catch (e) {
        scrapeResult =
          e.timeout ?
            createTimeoutError(e.message) :
            createGenericNavigationError(e.message);
      }
    } else {
      scrapeResult = loginResult;
    }

    await this.terminate();
    this.emitProgress(SCRAPE_PROGRESS_TYPES.END_SCRAPING);

    return scrapeResult;
  }

  async login() {
    throw new Error(`login() is not created in ${this.options.companyId}`);
  }

  async fetchData() {
    throw new Error(`fetchData() is not created in ${this.options.companyId}`);
  }

  static async fetchSummary() {
    return [];
  }

  async terminate() {
    this.emitProgress(SCRAPE_PROGRESS_TYPES.TERMINATING);
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

export { BaseScraper, LOGIN_RESULT };
