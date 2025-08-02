import puppeteer, { type Frame, type Page, type PuppeteerLifeCycleEvent } from 'puppeteer';
import { ScraperProgressTypes } from '../definitions';
import { getDebug } from '../helpers/debug';
import { clickButton, fillInput, waitUntilElementFound } from '../helpers/elements-interactions';
import { getCurrentUrl, waitForNavigation } from '../helpers/navigation';
import { BaseScraper } from './base-scraper';
import { ScraperErrorTypes } from './errors';
import { type ScraperCredentials, type ScraperScrapingResult } from './interface';

const debug = getDebug('base-scraper-with-browser');

enum LoginBaseResults {
  Success = 'SUCCESS',
  UnknownError = 'UNKNOWN_ERROR',
}

const { Timeout, Generic, General, ...rest } = ScraperErrorTypes;
export const LoginResults = {
  ...rest,
  ...LoginBaseResults,
};

// eslint-disable-next-line @typescript-eslint/no-redeclare
export type LoginResults =
  | Exclude<ScraperErrorTypes, ScraperErrorTypes.Timeout | ScraperErrorTypes.Generic | ScraperErrorTypes.General>
  | LoginBaseResults;

export type PossibleLoginResults = {
  [key in LoginResults]?: (string | RegExp | ((options?: { page?: Page }) => Promise<boolean>))[];
};

export interface LoginOptions {
  loginUrl: string;
  checkReadiness?: () => Promise<void>;
  fields: { selector: string; value: string }[];
  submitButtonSelector: string | (() => Promise<void>);
  preAction?: () => Promise<Frame | void>;
  postAction?: () => Promise<void>;
  possibleResults: PossibleLoginResults;
  userAgent?: string;
  waitUntil?: PuppeteerLifeCycleEvent;
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

function createGeneralError(): ScraperScrapingResult {
  return {
    success: false,
    errorType: ScraperErrorTypes.General,
  };
}

class BaseScraperWithBrowser<TCredentials extends ScraperCredentials> extends BaseScraper<TCredentials> {
  private cleanups: Array<() => Promise<void>> = [];

  private defaultViewportSize = {
    width: 1024,
    height: 768,
  };

  // NOTICE - it is discouraged to use bang (!) in general. It is used here because
  // all the classes that inherit from this base assume is it mandatory.
  protected page!: Page;

  protected getViewPort() {
    return this.options.viewportSize ?? this.defaultViewportSize;
  }

  async initialize() {
    await super.initialize();
    debug('initialize scraper');
    this.emitProgress(ScraperProgressTypes.Initializing);

    const page = await this.initializePage();
    await page.setCacheEnabled(false); // Clear cache and avoid 300's response status

    if (!page) {
      debug('failed to initiate a browser page, exit');
      return;
    }

    this.page = page;

    this.cleanups.push(() => page.close());

    if (this.options.defaultTimeout) {
      this.page.setDefaultTimeout(this.options.defaultTimeout);
    }

    if (this.options.preparePage) {
      debug("execute 'preparePage' interceptor provided in options");
      await this.options.preparePage(this.page);
    }

    const viewport = this.getViewPort();
    debug(`set viewport to width ${viewport.width}, height ${viewport.height}`);
    await this.page.setViewport({
      width: viewport.width,
      height: viewport.height,
    });

    this.page.on('requestfailed', request => {
      debug('Request failed: %s %s', request.failure()?.errorText, request.url());
    });
  }

  private async initializePage() {
    debug('initialize browser page');
    if ('browserContext' in this.options) {
      debug('Using the browser context provided in options');
      return this.options.browserContext.newPage();
    }

    if ('browser' in this.options) {
      debug('Using the browser instance provided in options');
      const { browser } = this.options;

      /**
       * For backward compatibility, we will close the browser even if we didn't create it
       */
      if (!this.options.skipCloseBrowser) {
        this.cleanups.push(async () => {
          debug('closing the browser');
          await browser.close();
        });
      }

      return browser.newPage();
    }

    const { timeout, args, executablePath, showBrowser } = this.options;

    const headless = !showBrowser;
    debug(`launch a browser with headless mode = ${headless}`);

    const browser = await puppeteer.launch({
      env: this.options.verbose ? { DEBUG: '*', ...process.env } : undefined,
      headless,
      executablePath,
      args,
      timeout,
    });

    this.cleanups.push(async () => {
      debug('closing the browser');
      await browser.close();
    });

    if (this.options.prepareBrowser) {
      debug("execute 'prepareBrowser' interceptor provided in options");
      await this.options.prepareBrowser(browser);
    }

    debug('create a new browser page');
    return browser.newPage();
  }

  async navigateTo(
    url: string,
    waitUntil: PuppeteerLifeCycleEvent | undefined = 'load',
    retries = this.options.navigationRetryCount ?? 0,
  ): Promise<void> {
    const response = await this.page?.goto(url, { waitUntil });
    if (response === null) {
      // note: response will be null when navigating to same url while changing the hash part.
      // the condition below will always accept null as valid result.
      return;
    }

    if (!response) {
      throw new Error(`Error while trying to navigate to url ${url}, response is undefined`);
    }

    if (!response.ok()) {
      const status = response.status();
      if (retries > 0) {
        debug(`Failed to navigate to url ${url}, status code: ${status}, retrying ${retries} more times`);
        await this.navigateTo(url, waitUntil, retries - 1);
      } else {
        throw new Error(`Failed to navigate to url ${url}, status code: ${status}`);
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getLoginOptions(_credentials: ScraperCredentials): LoginOptions {
    throw new Error(`getLoginOptions() is not created in ${this.options.companyId}`);
  }

  async fillInputs(pageOrFrame: Page | Frame, fields: { selector: string; value: string }[]): Promise<void> {
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

  async login(credentials: ScraperCredentials): Promise<ScraperScrapingResult> {
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
    await this.navigateTo(loginOptions.loginUrl, loginOptions.waitUntil);
    if (loginOptions.checkReadiness) {
      debug("execute 'checkReadiness' interceptor provided in login options");
      await loginOptions.checkReadiness();
    } else if (typeof loginOptions.submitButtonSelector === 'string') {
      debug('wait until submit button is available');
      await waitUntilElementFound(this.page, loginOptions.submitButtonSelector);
    }

    let loginFrameOrPage: Page | Frame | null = this.page;
    if (loginOptions.preAction) {
      debug("execute 'preAction' interceptor provided in login options");
      loginFrameOrPage = (await loginOptions.preAction()) || this.page;
    }

    debug('fill login components input with relevant values');
    await this.fillInputs(loginFrameOrPage, loginOptions.fields);
    debug('click on login submit button');
    if (typeof loginOptions.submitButtonSelector === 'string') {
      await clickButton(loginFrameOrPage, loginOptions.submitButtonSelector);
    } else {
      await loginOptions.submitButtonSelector();
    }
    this.emitProgress(ScraperProgressTypes.LoggingIn);

    if (loginOptions.postAction) {
      debug("execute 'postAction' interceptor provided in login options");
      await loginOptions.postAction();
    } else {
      debug('wait for page navigation');
      await waitForNavigation(this.page);
    }

    debug('check login result');
    const current = await getCurrentUrl(this.page, true);
    debug(`[LOGIN DEBUG] Current URL after login: ${current}`);
    debug('[LOGIN DEBUG] Checking against possible results:', loginOptions.possibleResults);
    const loginResult = await getKeyByValue(loginOptions.possibleResults, current, this.page);
    debug(`[LOGIN DEBUG] Matched login result: ${loginResult}`);
    debug(`handle login results ${loginResult}`);
    return this.handleLoginResult(loginResult);
  }

  async terminate(_success: boolean) {
    debug(`terminating browser with success = ${_success}`);
    this.emitProgress(ScraperProgressTypes.Terminating);

    if (!_success && !!this.options.storeFailureScreenShotPath) {
      debug(`create a snapshot before terminated in ${this.options.storeFailureScreenShotPath}`);
      await this.page.screenshot({
        path: this.options.storeFailureScreenShotPath,
        fullPage: true,
      });
    }

    for (const [i, cleanup] of this.cleanups.reverse().entries()) {
      try {
        debug(`[TERMINATE] Running cleanup #${i}`);
        await cleanup();
        debug(`[TERMINATE] Cleanup #${i} finished successfully`);
      } catch (err) {
        debug(`[TERMINATE] Cleanup #${i} failed:`, err);
        const errorObj = err as Error;
        if (errorObj && errorObj.message && errorObj.message.includes('No target with given id found')) {
          debug(`[TERMINATE] Suppressing Puppeteer closeTarget error for cleanup #${i}`);
        } else {
          throw err;
        }
      }
    }
    this.cleanups = [];
  }

  private handleLoginResult(loginResult: LoginResults) {
    switch (loginResult) {
      case LoginResults.Success:
        this.emitProgress(ScraperProgressTypes.LoginSuccess);
        return { success: true };
      case LoginResults.InvalidPassword:
      case LoginResults.UnknownError:
        this.emitProgress(ScraperProgressTypes.LoginFailed);
        return {
          success: false,
          errorType:
            loginResult === LoginResults.InvalidPassword
              ? ScraperErrorTypes.InvalidPassword
              : ScraperErrorTypes.General,
          errorMessage: `Login failed with ${loginResult} error`,
        };
      case LoginResults.ChangePassword:
        this.emitProgress(ScraperProgressTypes.ChangePassword);
        return {
          success: false,
          errorType: ScraperErrorTypes.ChangePassword,
        };
      default:
        throw new Error(`unexpected login result "${loginResult}"`);
    }
  }
}

export { BaseScraperWithBrowser };
