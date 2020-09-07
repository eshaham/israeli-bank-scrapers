import puppeteer, { Browser, Page } from 'puppeteer';
import { RunnerAdapter } from '@core/runner';

const VIEWPORT_WIDTH = 1024;
const VIEWPORT_HEIGHT = 768;

export interface BrowserAdapterOptions {
  /**
   * include more debug info about in the output
   */
  verbose?: boolean;

  /**
   * shows the browser while scraping, good for debugging (default false)
   */
  showBrowser?: boolean;

  /**
   * provide a patch to local chromium to be used by puppeteer. Relevant when using
   * `israeli-bank-scrapers-core` library
   */
  executablePath?: string;

  /**
   * additional arguments to pass to the browser instance. The list of flags can be found in
   *
   * https://developer.mozilla.org/en-US/docs/Mozilla/Command_Line_Options
   * https://peter.sh/experiments/chromium-command-line-switches/
   */
  args?: string[];

  /**
   * adjust the browser instance before it is being used
   *
   * @param browser
   */
  prepareBrowser?: (browser: Browser) => Promise<void>;
}

export function createBrowserAdapter(options: BrowserAdapterOptions): RunnerAdapter {
  return {
    name: 'createBrowser(puppeteer)',
    validate: () => { return []; },
    action: async (context) => {
      const {
        args, verbose, executablePath, prepareBrowser,
      } = options;
      let env = {};
      if (verbose) {
        env = { DEBUG: '*', ...process.env };
      }
      const browser = await puppeteer.launch({
        env,
        headless: !options.showBrowser,
        executablePath,
        args,
      });

      if (prepareBrowser) {
        await prepareBrowser(browser);
      }

      context.setSessionData('puppeteer.browser', browser);
    },
  };
}

export interface SetBrowserAdapterOptions {
  browser: Browser;
}

export function setBrowserAdapter(options: SetBrowserAdapterOptions): RunnerAdapter {
  return {
    name: 'setBrowser(puppeteer)',
    validate: () => {
      if (!options.browser) {
        return ['expected puppeteer browser to be provided by option'];
      }

      return [];
    },
    action: async (context) => {
      context.setSessionData('puppeteer.browser', options.browser);
    },
  };
}

export interface SetBrowserPageAdapterOptions {
  page: Page;
}

export function setBrowserPageAdapter(options: SetBrowserPageAdapterOptions): RunnerAdapter {
  return {
    name: 'setBrowserPage(puppeteer)',
    validate: () => {
      if (!options.page) {
        return ['expected puppeteer browser page to be provided by option'];
      }

      return [];
    },
    action: async (context) => {
      context.setSessionData('puppeteer.page', options.page);
    },
  };
}

export function createBrowserPageAdapter(): RunnerAdapter {
  return {
    name: 'createBrowserPage(puppeteer)',
    validate: (context) => {
      if (!context.hasSessionData('puppeteer.browser')) {
        return ['expected puppeteer browser to be provided by prior adapter'];
      }

      return [];
    },
    action: async (context) => {
      const browser = context.getSessionData('puppeteer.browser');
      let page = null;
      const pages = await browser.pages();
      if (pages.length) {
        [page] = pages;
      } else {
        page = await browser.newPage();
      }
      await page.setViewport({
        width: VIEWPORT_WIDTH,
        height: VIEWPORT_HEIGHT,
      });

      context.setSessionData('puppeteer.page', page);
    },
  };
}

export function closeBrowserAdapter(): RunnerAdapter {
  return {
    name: 'closeBrowser(puppeteer)',
    validate: (context) => {
      if (!context.hasSessionData('puppeteer.browser')) {
        return ['expected puppeteer browser to be provided by option or by prior adapter'];
      }

      return [];
    },
    action: async (context) => {
      const browser = context.getSessionData('puppeteer.browser');
      browser.close();
    },
  };
}
