import { EventEmitter } from 'events';
import puppeteer from 'puppeteer';

import { SCRAPE_PROGRESS_TYPES, LOGIN_RESULT, GENERAL_ERROR } from '../constants';
import { waitForNavigation, getCurrentUrl, NAVIGATION_ERRORS } from '../helpers/navigation';
import { waitUntilElementFound, fillInput, clickButton } from '../helpers/elements-interactions';

const SCRAPE_PROGRESS = 'SCRAPE_PROGRESS';

function getKeyByValue(object, value) {
  return Object.keys(object).find(key => object[key] === value);
}

function handleLoginResult(scraper, loginResult) {
  switch (loginResult) {
    case LOGIN_RESULT.SUCCESS:
      scraper.emitProgress(SCRAPE_PROGRESS_TYPES.LOGIN_SUCCESS);
      return { success: true };
    case LOGIN_RESULT.INVALID_PASSWORD:
      scraper.emitProgress(SCRAPE_PROGRESS_TYPES.LOGIN_FAILED);
      return {
        success: false,
        errorType: loginResult,
      };
    case LOGIN_RESULT.CHANGE_PASSWORD:
      scraper.emitProgress(SCRAPE_PROGRESS_TYPES.CHANGE_PASSWORD);
      return {
        success: false,
        errorType: loginResult,
      };
    default:
      throw new Error(`unexpected login result "${loginResult}"`);
  }
}

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

function createGeneralError() {
  return createErrorResult(GENERAL_ERROR);
}

class BaseScraper {
  constructor(options) {
    this.options = options;
    this.eventEmitter = new EventEmitter();
  }

  async initialize() {
    let env = null;
    if (this.options.verbose) {
      env = Object.assign({ DEBUG: '*' }, process.env);
    }
    this.browser = await puppeteer.launch({ env });
    this.page = await this.browser.newPage();
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
        scrapeResult = await this.fetchData();
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

  getLoginOptions() {
    throw new Error(`getLoginOptions() is not created in ${this.options.companyId}`);
  }

  async fillInputs(fields) {
    const modified = [...fields];
    const input = modified.shift();
    await fillInput(this.page, input.selector, input.value);
    if (modified.length) {
      return this.fillInputs(modified);
    }
    return null;
  }

  async login(credentials) {
    if (!credentials) {
      return createGeneralError();
    }

    const loginOptions = this.getLoginOptions(credentials);

    await this.page.goto(loginOptions.loginUrl);
    if (loginOptions.checkReadiness) {
      await loginOptions.checkReadiness();
    } else {
      await waitUntilElementFound(this.page, loginOptions.submitButtonSelector);
    }

    await this.fillInputs(loginOptions.fields);
    await clickButton(this.page, loginOptions.submitButtonSelector);
    this.emitProgress(SCRAPE_PROGRESS_TYPES.LOGGING_IN);

    if (loginOptions.postAction) {
      await loginOptions.postAction();
    } else {
      await waitForNavigation(this.page);
    }

    const current = await getCurrentUrl(this.page, true);
    const loginResult = getKeyByValue(loginOptions.possibleResults, current);
    return handleLoginResult(this, loginResult);
  }

  async fetchData() {
    throw new Error(`fetchData() is not created in ${this.options.companyId}`);
  }

  async terminate() {
    await this.browser.close();
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
