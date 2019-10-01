import puppeteer from 'puppeteer';

const VIEWPORT_WIDTH = 1024;
const VIEWPORT_HEIGHT = 768;

function createBrowserAdapter(options) {
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

function setBrowserPageAdapter(options) {
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

function createBrowserPageAdapter(options = {}) {
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

function closeBrowserAdapter(options = {}) {
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

export {
  closeBrowserAdapter, createBrowserAdapter, createBrowserPageAdapter, setBrowserPageAdapter,
};
