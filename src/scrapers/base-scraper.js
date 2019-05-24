import { EventEmitter } from 'events';

import { SCRAPE_PROGRESS_TYPES, LOGIN_RESULT, ERRORS } from '../constants';

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

class BaseScraper {
  constructor(options) {
    this.options = options;
    this.eventEmitter = new EventEmitter();
  }

  async initialize() {
    this.emitProgress(SCRAPE_PROGRESS_TYPES.INITIALIZING);
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
        createGenericError(e.message);
    }

    let scrapeResult;
    if (loginResult.success) {
      try {
        scrapeResult = await this.fetchData();
      } catch (e) {
        scrapeResult =
          e.timeout ?
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
    this.emitProgress(SCRAPE_PROGRESS_TYPES.END_SCRAPING);

    return scrapeResult;
  }

  async login() {
    throw new Error(`login() is not created in ${this.options.companyId}`);
  }

  async fetchData() {
    throw new Error(`fetchData() is not created in ${this.options.companyId}`);
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
