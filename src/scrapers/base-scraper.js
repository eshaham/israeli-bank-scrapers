import puppeteer from 'puppeteer';

import ScraperNotifier from '../helpers/notifier';
import { waitForNavigation, NAVIGATION_ERRORS } from '../helpers/navigation';
import { waitUntilElementFound, fillInput, clickButton } from '../helpers/elements-interactions';

const LOGIN_RESULT = {
  SUCCESS: 'success',
  INVALID_PASSWORD: 'invalidPassword',
  CHANGE_PASSWORD: 'changePassword',
};

const GENERAL_ERROR = 'generalError';

function getKeyByValue(object, value) {
  return Object.keys(object).find(key => object[key] === value);
}

function handleLoginResult(loginResult, notifyAction) {
  switch (loginResult) {
    case LOGIN_RESULT.SUCCESS:
      notifyAction('login successful');
      return { success: true };
    case LOGIN_RESULT.INVALID_PASSWORD:
      notifyAction('invalid password');
      return {
        success: false,
        errorType: loginResult,
      };
    case LOGIN_RESULT.CHANGE_PASSWORD:
      notifyAction('need to change password');
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

function createGenericNavigationError() {
  return createErrorResult(NAVIGATION_ERRORS.GENERAL_ERROR);
}

function createGeneralError() {
  return createErrorResult(GENERAL_ERROR);
}

class BaseScraper {
  constructor(scraperName) {
    this.scraperName = scraperName || 'base';
  }

  async initialize(options) {
    this.options = options;
    this.notifier = new ScraperNotifier(this.scraperName);

    let env = null;
    if (options.verbose) {
      env = Object.assign({ DEBUG: '*' }, process.env);
    }
    this.browser = await puppeteer.launch({ env });
    this.page = await this.browser.newPage();

    this.notify('start scraping');
  }

  async scrape(credentials, options = {}) {
    await this.initialize(options);

    const loginOptions = this.getLoginOptions(credentials);

    let loginResult;
    try {
      loginResult = await this.login(loginOptions);
    } catch (e) {
      loginResult = e.timeout ? createTimeoutError(e.errorMessage) : createGenericNavigationError();
    }

    let scrapeResult;
    if (loginResult.success) {
      try {
        scrapeResult = await this.fetchData();
      } catch (e) {
        scrapeResult =
          e.timeout ? createTimeoutError(e.errorMessage) : createGenericNavigationError();
      }
    } else {
      scrapeResult = loginResult;
    }

    await this.browser.close();

    return scrapeResult;
  }

  getLoginOptions() {
    this.notify('you must override getLoginOptions()');
  }

  async fillInputs(fields) {
    const modified = [...fields];
    const input = modified.shift();
    await fillInput(this.page, input.id, input.value);
    if (modified.length) {
      return this.fillInputs(modified);
    }
    return null;
  }

  async login(options) {
    if (!options) {
      return createGeneralError();
    }

    await this.page.goto(options.loginUrl);
    await waitUntilElementFound(this.page, options.submitButtonId);

    await this.fillInputs(options.fields);
    await clickButton(this.page, options.submitButtonId);
    this.notify('logging in');

    if (options.postAction) {
      await options.postAction();
    } else {
      await waitForNavigation(this.page);
    }

    const current = await this.page.url();
    const loginResult = getKeyByValue(options.possibleResults, current);
    return handleLoginResult(loginResult, msg => this.notify(msg));
  }

  async fetchData() {
    this.notify('you must override fetchData()');
  }

  notify(msg) {
    this.notifier.notify(this.options, msg);
  }
}

export { BaseScraper, LOGIN_RESULT };
