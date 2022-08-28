import puppeteer, { Browser, Frame, Page } from 'puppeteer';

import {
  ScraperErrorTypes,
  BaseScraper, ScaperScrapingResult, ScaperProgressTypes,
  ScraperCredentials,
} from './base-scraper';
import { getCurrentUrl, waitForNavigation } from '../helpers/navigation';
import { clickButton, fillInput, waitUntilElementFound } from '../helpers/elements-interactions';
import { getDebug } from '../helpers/debug';

const VIEWPORT_WIDTH = 1024;
const VIEWPORT_HEIGHT = 768;
const OK_STATUS = 200;

const debug = getDebug('base-scraper-with-browser');

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
  submitButtonSelector: string | (() => Promise<void>);
  preAction?: () => Promise<Frame | void>;
  postAction?: () => Promise<void>;
  possibleResults: PossibleLoginResults;
  userAgent?: string;
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

  protected getViewPort() {
    return {
      width: VIEWPORT_WIDTH,
      height: VIEWPORT_HEIGHT,
    };
  }

  async initialize() {
    await super.initialize();
    debug('initialize scraper');

    let env: Record<string, any> | undefined;
    if (this.options.verbose) {
      env = { DEBUG: '*', ...process.env };
    }

    if (typeof this.options.browser !== 'undefined' && this.options.browser !== null) {
      debug('use custom browser instance provided in options');
      this.browser = this.options.browser;
    } else {
      const executablePath = this.options.executablePath || undefined;
      const args = this.options.args || [];

      const headless = !this.options.showBrowser;
      debug(`launch a browser with headless mode = ${headless}`);
      this.browser = await puppeteer.launch({
        env,
        headless,
        executablePath,
        args,
      });
    }

    if (this.options.prepareBrowser) {
      debug('execute \'prepareBrowser\' interceptor provided in options');
      await this.options.prepareBrowser(this.browser);
    }

    if (!this.browser) {
      debug('failed to initiate a browser, exit');
      return;
    }

    const pages = await this.browser.pages();
    if (pages.length) {
      debug('browser has already pages open, use the first one');
      [this.page] = pages;
    } else {
      debug('create a new browser page');
      this.page = await this.browser.newPage();
    }

    if (this.options.defaultTimeout) {
      this.page.setDefaultTimeout(this.options.defaultTimeout);
    }

    if (this.options.preparePage) {
      debug('execute \'preparePage\' interceptor provided in options');
      await this.options.preparePage(this.page);
    }

    const viewport = this.getViewPort();
    debug(`set viewport to width ${viewport.width}, height ${viewport.height}`);
    await this.page.setViewport({
      width: viewport.width,
      height: viewport.height,
    });

    this.page.on('requestfailed', (request) => {
      debug('Request failed: %s %s', request.failure()?.errorText, request.url());
    });
  }

  async navigateTo(url: string, page?: Page, timeout?: number): Promise<void> {
    const pageToUse = page || this.page;

    if (!pageToUse) {
      return;
    }

    const options = { ...(timeout === null ? null : { timeout }) };
    const response = await pageToUse.goto(url, options);

    // note: response will be null when navigating to same url while changing the hash part. the condition below will always accept null as valid result.
    if (response !== null && (response === undefined || response.status() !== OK_STATUS)) {
      throw new Error(`Error while trying to navigate to url ${url}`);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getLoginOptions(_credentials: ScraperCredentials): LoginOptions {
    throw new Error(`getLoginOptions() is not created in ${this.options.companyId}`);
  }

  async fillInputs(pageOrFrame: Page | Frame, fields: { selector: string, value: string}[]): Promise<void> {
    const modified = [...fields];
    const input = modified.shift();

    if (!input) {
      return;
    }
    await fillInput(pageOrFrame, input.selector, input.value);
    if (modified.length) {
      await this.fillInputs(pageOrFrame, modified);
    }
  }

  async login(credentials: Record<string, string>): Promise<ScaperScrapingResult> {
    if (!credentials || !this.page) {
      return createGeneralError();
    }

    debug('execute login process');
    const loginOptions = this.getLoginOptions(credentials);

    if (loginOptions.userAgent) {
      debug('set custom user agent provided in options');
      await this.page.setUserAgent(loginOptions.userAgent);
    }

    debug('navigate to login url');
    await this.navigateTo(loginOptions.loginUrl);
    if (loginOptions.checkReadiness) {
      debug('execute \'checkReadiness\' interceptor provided in login options');
      await loginOptions.checkReadiness();
    } else if (typeof loginOptions.submitButtonSelector === 'string') {
      debug('wait until submit button is available');
      await waitUntilElementFound(this.page, loginOptions.submitButtonSelector);
    }

    let loginFrameOrPage: (Page | Frame | null) = this.page;
    if (loginOptions.preAction) {
      debug('execute \'preAction\' interceptor provided in login options');
      loginFrameOrPage = await loginOptions.preAction() || this.page;
    }

    debug('fill login components input with relevant values');
    await this.fillInputs(loginFrameOrPage, loginOptions.fields);
    debug('click on login submit button');
    if (typeof loginOptions.submitButtonSelector === 'string') {
      await clickButton(loginFrameOrPage, loginOptions.submitButtonSelector);
    } else {
      await loginOptions.submitButtonSelector();
    }
    this.emitProgress(ScaperProgressTypes.LoggingIn);

    if (loginOptions.postAction) {
      debug('execute \'postAction\' interceptor provided in login options');
      await loginOptions.postAction();
    } else {
      debug('wait for page navigation');
      await waitForNavigation(this.page);
    }

    debug('check login result');
    const current = await getCurrentUrl(this.page, true);
    const loginResult = await getKeyByValue(loginOptions.possibleResults, current, this.page);
    debug(`handle login results ${loginResult}`);
    return handleLoginResult(this, loginResult);
  }

  async terminate(_success: boolean) {
    debug(`terminating browser with success = ${_success}`);
    this.emitProgress(ScaperProgressTypes.Terminating);

    if (!_success && !!this.options.storeFailureScreenShotPath) {
      debug(`create a snapshot before terminated in ${this.options.storeFailureScreenShotPath}`);
      await this.page.screenshot({
        path: this.options.storeFailureScreenShotPath,
        fullPage: true,
      });
    }

    if (!this.browser) {
      return;
    }

    await this.browser.close();
  }
}

export { BaseScraperWithBrowser };
