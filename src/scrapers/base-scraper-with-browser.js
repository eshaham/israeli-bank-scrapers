import puppeteer from 'puppeteer';

import { BaseScraper } from './base-scraper';
import { SCRAPE_PROGRESS_TYPES, LOGIN_RESULT, GENERAL_ERROR } from '../constants';
import { waitForNavigation, getCurrentUrl } from '../helpers/navigation';
import { waitUntilElementFound, fillInput, clickButton } from '../helpers/elements-interactions';

const VIEWPORT_WIDTH = 1024;
const VIEWPORT_HEIGHT = 768;
const OK_STATUS = 200;

async function getKeyByValue(object, value) {
  const keys = Object.keys(object);
  for (const key of keys) {
    const conditions = object[key];

    for (const condition of conditions) {
      let result = false;

      if (condition instanceof RegExp) {
        result = condition.test(value);
      } else if (typeof condition === 'function') {
        result = await condition();
      } else {
        result = value.toLowerCase() === condition.toLowerCase();
      }

      if (result) {
        return Promise.resolve(key);
      }
    }
  }

  return Promise.resolve(LOGIN_RESULT.UNKNOWN_ERROR);
}

function handleLoginResult(scraper, loginResult) {
  switch (loginResult) {
    case LOGIN_RESULT.SUCCESS:
      scraper.emitProgress(SCRAPE_PROGRESS_TYPES.LOGIN_SUCCESS);
      return { success: true };
    case LOGIN_RESULT.INVALID_PASSWORD:
    case LOGIN_RESULT.UNKNOWN_ERROR:
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

function createGeneralError() {
  return {
    success: false,
    errorType: GENERAL_ERROR,
  };
}

class BaseScraperWithBrowser extends BaseScraper {
  async initialize() {
    this.emitProgress(SCRAPE_PROGRESS_TYPES.INITIALIZING);

    let env = null;
    if (this.options.verbose) {
      env = Object.assign({ DEBUG: '*' }, process.env);
    }

    if (typeof this.options.browser !== 'undefined' && this.options.browser !== null) {
      this.browser = this.options.browser;
    } else {
      const executablePath = this.options.executablePath || undefined;
      this.browser = await puppeteer.launch({
        env,
        headless: !this.options.showBrowser,
        executablePath,
      });
    }

    const pages = await this.browser.pages();
    if (pages.length) {
      [this.page] = pages;
    } else {
      this.page = await this.browser.newPage();
    }
    await this.page.setViewport({
      width: VIEWPORT_WIDTH,
      height: VIEWPORT_HEIGHT,
    });
  }

  async navigateTo(url, page) {
    const pageToUse = page || this.page;
    const response = await pageToUse.goto(url);

    // note: response will be null when navigating to same url while changing the hash part. the condition below will always accept null as valid result.
    if (response !== null && (response === undefined || response.status() !== OK_STATUS)) {
      throw new Error(`Error while trying to navigate to url ${url}`);
    }
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

    await this.navigateTo(loginOptions.loginUrl);
    if (loginOptions.checkReadiness) {
      await loginOptions.checkReadiness();
    } else {
      await waitUntilElementFound(this.page, loginOptions.submitButtonSelector);
    }

    if (loginOptions.preAction) {
      await loginOptions.preAction();
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
    const loginResult = await getKeyByValue(loginOptions.possibleResults, current);
    return handleLoginResult(this, loginResult);
  }

  async terminate() {
    this.emitProgress(SCRAPE_PROGRESS_TYPES.TERMINATING);
    await this.browser.close();
  }
}

export { BaseScraperWithBrowser, LOGIN_RESULT };
