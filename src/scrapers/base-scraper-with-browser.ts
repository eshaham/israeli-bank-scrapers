import puppeteer, { Browser, Page } from 'puppeteer';

import {
  ScraperErrorTypes,
  BaseScraper, ScaperScrapingResult, ScaperProgressTypes,
  ScraperCredentials,
} from './base-scraper';
import { getCurrentUrl, waitForNavigation } from '../helpers/navigation';
import { clickButton, fillInput, waitUntilElementFound } from '../helpers/elements-interactions';

const VIEWPORT_WIDTH = 1024;
const VIEWPORT_HEIGHT = 768;
const OK_STATUS = 200;

enum LoginBaseResults {
  Success = 'SUCCESS',
  UnknownError = 'UNKNOWN_ERROR'
}

const {
  Timeout, Generic, General, ...rest
} = ScraperErrorTypes;
export const LoginResults = {
  ...rest,
  ...LoginBaseResults,
};

export type LoginResults = Exclude<ScraperErrorTypes,
ScraperErrorTypes.Timeout
| ScraperErrorTypes.Generic
| ScraperErrorTypes.General> | LoginBaseResults;

export type PossibleLoginResults = {
  [key in LoginResults]?: (string | RegExp | ((options?: { page?: Page}) => Promise<boolean>))[]
};

export interface LoginOptions {
  loginUrl: string;
  checkReadiness?: () => Promise<void>;
  fields: {selector: string, value: string}[];
  submitButtonSelector: string;
  preAction?: () => Promise<void>;
  postAction?: () => Promise<void>;
  possibleResults: PossibleLoginResults;
}

async function getKeyByValue(object: PossibleLoginResults, value: string, page: Page): Promise<LoginResults> {
  const keys = Object.keys(object);
  for (const key of keys) {
    // @ts-ignore
    const conditions = object[key];

    for (const condition of conditions) {
      let result = false;

      if (condition instanceof RegExp) {
        result = condition.test(value);
      } else if (typeof condition === 'function') {
        result = await condition({ page, value });
      } else {
        result = value.toLowerCase() === condition.toLowerCase();
      }

      if (result) {
        // @ts-ignore
        return Promise.resolve(key);
      }
    }
  }

  return Promise.resolve(LoginResults.UnknownError);
}

function handleLoginResult(scraper: BaseScraperWithBrowser, loginResult: LoginResults) {
  switch (loginResult) {
    case LoginResults.Success:
      scraper.emitProgress(ScaperProgressTypes.LoginSuccess);
      return { success: true };
    case LoginResults.InvalidPassword:
    case LoginResults.UnknownError:
      scraper.emitProgress(ScaperProgressTypes.LoginFailed);
      return {
        success: false,
        errorType: loginResult === LoginResults.InvalidPassword ? ScraperErrorTypes.InvalidPassword :
          ScraperErrorTypes.General,
        errorMessage: `Login failed with ${loginResult} error`,
      };
    case LoginResults.ChangePassword:
      scraper.emitProgress(ScaperProgressTypes.ChangePassword);
      return {
        success: false,
        errorType: ScraperErrorTypes.ChangePassword,
      };
    default:
      throw new Error(`unexpected login result "${loginResult}"`);
  }
}

function createGeneralError(): ScaperScrapingResult {
  return {
    success: false,
    errorType: ScraperErrorTypes.General,
  };
}

class BaseScraperWithBrowser extends BaseScraper {
  // NOTICE - it is discourage to use bang (!) in general. It is used here because
  // all the classes that inherit from this base assume is it mandatory.
  protected browser!: Browser;

  // NOTICE - it is discourage to use bang (!) in general. It is used here because
  // all the classes that inherit from this base assume is it mandatory.
  protected page!: Page;

  async initialize() {
    this.emitProgress(ScaperProgressTypes.Initializing);

    let env: Record<string, any> | undefined;
    if (this.options.verbose) {
      env = { DEBUG: '*', ...process.env };
    }

    if (typeof this.options.browser !== 'undefined' && this.options.browser !== null) {
      this.browser = this.options.browser;
    } else {
      const executablePath = this.options.executablePath || undefined;
      const args = this.options.args || [];
      this.browser = await puppeteer.launch({
        env,
        headless: !this.options.showBrowser,
        executablePath,
        args,
      });
    }

    if (this.options.prepareBrowser) {
      await this.options.prepareBrowser(this.browser);
    }

    if (!this.browser) {
      return;
    }

    const pages = await this.browser.pages();
    if (pages.length) {
      [this.page] = pages;
    } else {
      this.page = await this.browser.newPage();
    }

    if (this.options.preparePage) {
      await this.options.preparePage(this.page);
    }

    await this.page.setViewport({
      width: VIEWPORT_WIDTH,
      height: VIEWPORT_HEIGHT,
    });
  }

  async navigateTo(url: string, page?: Page): Promise<void> {
    const pageToUse = page || this.page;

    if (!pageToUse) {
      return;
    }

    const response = await pageToUse.goto(url);

    // note: response will be null when navigating to same url while changing the hash part. the condition below will always accept null as valid result.
    if (response !== null && (response === undefined || response.status() !== OK_STATUS)) {
      throw new Error(`Error while trying to navigate to url ${url}`);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getLoginOptions(_credentials: ScraperCredentials): LoginOptions {
    throw new Error(`getLoginOptions() is not created in ${this.options.companyId}`);
  }

  async fillInputs(fields: { selector: string, value: string}[]): Promise<void> {
    const modified = [...fields];
    const input = modified.shift();

    if (!input) {
      return;
    }
    await fillInput(this.page, input.selector, input.value);
    if (modified.length) {
      await this.fillInputs(modified);
    }
  }

  async login(credentials: Record<string, string>): Promise<ScaperScrapingResult> {
    if (!credentials || !this.page) {
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
    this.emitProgress(ScaperProgressTypes.LoggingIn);

    if (loginOptions.postAction) {
      await loginOptions.postAction();
    } else {
      await waitForNavigation(this.page);
    }

    const current = await getCurrentUrl(this.page, true);
    const loginResult = await getKeyByValue(loginOptions.possibleResults, current, this.page);
    return handleLoginResult(this, loginResult);
  }

  async terminate() {
    this.emitProgress(ScaperProgressTypes.Terminating);

    if (!this.browser) {
      return;
    }

    await this.browser.close();
  }
}

export { BaseScraperWithBrowser };
