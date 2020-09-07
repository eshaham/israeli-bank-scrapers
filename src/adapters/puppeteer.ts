import puppeteer from 'adapters/puppeteer';
import { RunnerAdapter } from '@core/runner/runner-adapter';

const VIEWPORT_WIDTH = 1024;
const VIEWPORT_HEIGHT = 768;

export function createBrowserAdapter(options): RunnerAdapter {
  return {
    name: 'createBrowser(puppeteer)',
    validate: () => { return []; },
    action: async (context) => {
      const { verbose, executablePath } = options;
      let env = {};
      if (verbose) {
        env = { DEBUG: '*', ...process.env };
      }

      const browser = await puppeteer.launch({
        env,
        headless: !options.showBrowser,
        executablePath,
      });

      context.setSessionData('puppeteer.browser', browser);
    },
  };
}

export function setBrowserPageAdapter(options): RunnerAdapter {
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

export interface CreateBrowserPageAdapterOptions {
  browser?: any;
}

export function createBrowserPageAdapter(options: CreateBrowserPageAdapterOptions = {}): RunnerAdapter {
  return {
    name: 'createBrowserPage(puppeteer)',
    validate: (context) => {
      if (!options.browser && !context.hasSessionData('puppeteer.browser')) {
        return ['expected puppeteer browser to be provided by option or by prior adapter'];
      }

      return [];
    },
    action: async (context) => {
      const browser = options.browser || context.getSessionData('puppeteer.browser');
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

export interface CloseBrowserAdapterOptions {
  browser?: any;
}

export function closeBrowserAdapter(options: CloseBrowserAdapterOptions = {}): RunnerAdapter {
  return {
    name: 'closeBrowser(puppeteer)',
    validate: (context) => {
      if (!options.browser && !context.hasSessionData('puppeteer.browser')) {
        return ['expected puppeteer browser to be provided by option or by prior adapter'];
      }

      return [];
    },
    action: async (context) => {
      const browser = options.browser || context.getSessionData('puppeteer.browser');
      browser.close();
    },
  };
}
