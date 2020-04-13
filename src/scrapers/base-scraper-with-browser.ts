import puppeteer, { Browser, Page } from 'puppeteer';

import { BaseScraper, ScrapeProgressTypes } from './base-scraper';
import { getCurrentUrl, waitForNavigation } from '../helpers/navigation';
import { clickButton, fillInput, waitUntilElementFound } from '../helpers/elements-interactions';
import { ErrorTypes, LegacyScrapingResult } from '../types';

const VIEWPORT_WIDTH = 1024;
const VIEWPORT_HEIGHT = 768;
const OK_STATUS = 200;

export enum LoginResults {
  Success = 'Success',
  InvalidPassword = 'InvalidPassword',
  ChangePassword = 'ChangePassword',
  UnknownError = 'UnknownError',
}

export interface LoginOptions {
  loginUrl: string;
  checkReadiness?: () => Promise<void>;
  fields: {selector: string; value: string}[];
  submitButtonSelector: string;
  preAction?: () => Promise<void>;
  postAction?: () => Promise<void>;
  possibleResults: Partial<{[key in LoginResults]: (string | RegExp)[] }>; // TODO es fix type
}

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

  return Promise.resolve(LoginResults.UnknownError);
}

function handleLoginResult(scraper, loginResult) {
  switch (loginResult) {
    case LoginResults.Success:
      scraper.emitProgress(ScrapeProgressTypes.LoginSuccess);
      return { success: true };
    case LoginResults.InvalidPassword:
    case LoginResults.UnknownError:
      scraper.emitProgress(ScrapeProgressTypes.LoginFailed);
      return {
        success: false,
        errorType: loginResult === LoginResults.InvalidPassword ? ErrorTypes.InvalidPassword :
          ErrorTypes.General,
        errorMessage: `Login failed with ${loginResult} error`,
      };
    case LoginResults.ChangePassword:
      scraper.emitProgress(ScrapeProgressTypes.ChangePassword);
      return {
        success: false,
        errorType: ErrorTypes.ChangePassword,
      };
    default:
      throw new Error(`unexpected login result "${loginResult}"`);
  }
}

function createGeneralError(): LegacyScrapingResult {
  return {
    success: false,
    errorType: ErrorTypes.General,
  };
}

class BaseScraperWithBrowser extends BaseScraper {
  protected browser: Browser;

  protected page: Page;

  async initialize() {
    this.emitProgress(ScrapeProgressTypes.Initializing);

    let env = null;
    if (this.options.verbose) {
      env = { DEBUG: '*', ...process.env };
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

  async navigateTo(url: string, page?: Page): Promise<void> {
    const pageToUse = page || this.page;
    const response = await pageToUse.goto(url);

    // note: response will be null when navigating to same url while changing the hash part. the condition below will always accept null as valid result.
    if (response !== null && (response === undefined || response.status() !== OK_STATUS)) {
      throw new Error(`Error while trying to navigate to url ${url}`);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getLoginOptions(credentials: Record<string, string>): LoginOptions {
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

  async login(credentials: Record<string, string>): Promise<LegacyScrapingResult> {
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
    this.emitProgress(ScrapeProgressTypes.LoggingIn);

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
    this.emitProgress(ScrapeProgressTypes.Terminating);
    await this.browser.close();
  }
}

export { BaseScraperWithBrowser };
