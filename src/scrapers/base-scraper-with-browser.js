import puppeteer from 'puppeteer';

import { BaseScraper } from './base-scraper';
import {
  SCRAPE_PROGRESS_TYPES,
  LOGIN_RESULT,
  GENERAL_ERROR,
  SMS_VERIFICATION_RESULT,
} from '../constants';
import { waitForNavigation, getCurrentUrl } from '../helpers/navigation';
import { waitUntilElementFound, fillInput, clickButton } from '../helpers/elements-interactions';

const VIEWPORT_WIDTH = 1024;
const VIEWPORT_HEIGHT = 768;
const OK_STATUS = 200;

const SMS_VERIFICATION_HANDLER_MISSING = 'Scraper requires sms verification. To support manual sms verification provide an handler as part of the options';

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
    return this.handleLoginResult(loginResult);
  }

  async handleLoginResult(loginResult) {
    switch (loginResult) {
      case LOGIN_RESULT.SUCCESS:
        this.emitProgress(SCRAPE_PROGRESS_TYPES.LOGIN_SUCCESS);
        return { success: true };
      case LOGIN_RESULT.INVALID_PASSWORD:
        this.emitProgress(SCRAPE_PROGRESS_TYPES.LOGIN_FAILED);
        return {
          success: false,
          errorType: loginResult,
        };
      case LOGIN_RESULT.CHANGE_PASSWORD:
        this.emitProgress(SCRAPE_PROGRESS_TYPES.CHANGE_PASSWORD);
        return {
          success: false,
          errorType: loginResult,
        };
      case LOGIN_RESULT.SMS_VERIFICATION:
        return this.smsVerification();
      default:
        throw new Error(`unexpected login result "${loginResult}"`);
    }
  }

  async smsVerification() {
    if (!this.options.smsVerificationHandler) {
      throw new Error(SMS_VERIFICATION_HANDLER_MISSING);
    }

    const smsValue = await this.options.smsVerificationHandler();
    const smsVerificationOptions = this.getSMSVerificationOptions(smsValue);

    await this.fillInputs(smsVerificationOptions.fields);
    await clickButton(this.page, smsVerificationOptions.submitButtonSelector);
    this.emitProgress(SCRAPE_PROGRESS_TYPES.VERIFING_SMS);

    if (smsVerificationOptions.postAction) {
      await smsVerificationOptions.postAction();
    } else {
      await waitForNavigation(this.page);
    }

    const current = await getCurrentUrl(this.page, true);
    const smsVerificationResult = getKeyByValue(smsVerificationOptions.possibleResults, current);
    return this.handleSmsVerificationResult(smsVerificationResult);
  }

  async handleSmsVerificationResult(smsVerificationResult) {
    switch (smsVerificationResult) {
      case SMS_VERIFICATION_RESULT.SUCCESS:
        this.emitProgress(SCRAPE_PROGRESS_TYPES.LOGIN_SUCCESS);
        return { success: true };
      case SMS_VERIFICATION_RESULT.INVALID_SMS_VALUE:
        this.emitProgress(SCRAPE_PROGRESS_TYPES.LOGIN_FAILED);
        return {
          success: false,
          errorType: smsVerificationResult,
        };
      default:
        throw new Error(`unexpected sms verification result "${smsVerificationResult}"`);
    }
  }

  getSMSVerificationOptions() {
    throw new Error(`getSMSVerificationOptions() is not created in ${this.options.companyId}`);
  }

  async terminate() {
    this.emitProgress(SCRAPE_PROGRESS_TYPES.TERMINATING);
    await this.browser.close();
  }
}

export { BaseScraperWithBrowser, LOGIN_RESULT, SMS_VERIFICATION_RESULT };
