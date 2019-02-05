import puppeteer from 'puppeteer';

import { BaseScraper } from './base-scraper';
import {
  SCRAPE_PROGRESS_TYPES,
  LOGIN_RESULT,
  GENERAL_ERROR,
  OK_STATUS,
} from '../constants';
import { waitForNavigation, getCurrentUrl } from '../helpers/navigation';
import { waitUntilElementFound, fillInput, clickButton } from '../helpers/elements-interactions';

const VIEWPORT_WIDTH = 1024;
const VIEWPORT_HEIGHT = 768;

function getKeyByValue(object, value) {
  return Object.keys(object).find((key) => {
    const compareTo = object[key];
    let result = false;

    result = compareTo.find((item) => {
      if (item instanceof RegExp) {
        return item.test(value);
      }

      return value === item;
    });

    return !!result;
  });
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
      this.browser = await puppeteer.launch({ env, headless: !this.options.showBrowser });
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
    if (!response || response.status() !== OK_STATUS) {
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

  async terminate() {
    this.emitProgress(SCRAPE_PROGRESS_TYPES.TERMINATING);
    await this.browser.close();
  }
}

export { BaseScraperWithBrowser, LOGIN_RESULT };
