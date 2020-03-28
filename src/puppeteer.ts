import puppeteer from 'puppeteer';
import { RunnerAdapter } from './runner-adapter';

const VIEWPORT_WIDTH = 1024;
const VIEWPORT_HEIGHT = 768;

function createBrowserAdapter(options): RunnerAdapter {
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

      return { success: true};
    },
  };
}

function setBrowserPageAdapter(options): RunnerAdapter {
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
      return { success: true}
    },
  };
}

export interface CreateBrowserPageAdapterOptions {
  browser?: any;
}

function createBrowserPageAdapter(options: CreateBrowserPageAdapterOptions = {}): RunnerAdapter {
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
      return { success: true}
    },
  };
}


export interface CloseBrowserAdapterOptions {
  browser?: any;
}

function closeBrowserAdapter(options: CloseBrowserAdapterOptions = {}): RunnerAdapter {
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
      return { success: true}
    },
  };
}

export {
  closeBrowserAdapter, createBrowserAdapter, createBrowserPageAdapter, setBrowserPageAdapter,
};
