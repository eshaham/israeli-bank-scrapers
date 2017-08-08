import phantom from 'phantom';

import ScraperNotifier from '../helpers/notifier';
import { waitForUrls, NAVIGATION_ERRORS } from '../helpers/navigation';
import { waitUntilElementFound, fillInput, clickButton } from '../helpers/elements-interactions';

const LOGIN_RESULT = {
  SUCCESS: 'success',
  INVALID_PASSWORD: 'invalidPassword',
  CHANGE_PASSWORD: 'changePassword',
};

const GENERAL_ERROR = 'generalError';

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

function createErrorResult(errorType) {
  return {
    success: false,
    errorType,
  };
}

function createTimeoutError() {
  return createErrorResult(NAVIGATION_ERRORS.TIMEOUT);
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
    this.instance = await phantom.create();
    this.page = await this.instance.createPage();

    this.notify('start scraping');
  }

  async scrape(credentials, options = {}) {
    await this.initialize(options);

    const loginOptions = this.getLoginOptions(credentials);

    let loginResult;
    try {
      loginResult = await this.login(loginOptions);
    } catch (e) {
      loginResult = e.timeout ? createTimeoutError() : createGenericNavigationError();
    }

    let scrapeResult;
    if (loginResult.success) {
      try {
        scrapeResult = await this.fetchData();
      } catch (e) {
        scrapeResult = e.timeout ? createTimeoutError() : createGenericNavigationError();
      }
    } else {
      scrapeResult = loginResult;
    }

    await this.instance.exit();

    return scrapeResult;
  }

  getLoginOptions() {
    this.notify('you must override getLoginOptions()');
  }

  async login(options) {
    if (!options) {
      return createGeneralError();
    }

    await this.page.open(options.loginUrl);
    await waitUntilElementFound(this.page, options.submitButtonId);

    await Promise.all(options.fields.map((field) => {
      return fillInput(this.page, field.id, field.value);
    }));

    await clickButton(this.page, options.submitButtonId);
    this.notify('logging in');

    if (options.postAction) {
      await options.postAction();
    }

    const loginResult = await waitForUrls(this.page, options.possibleResults);
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
