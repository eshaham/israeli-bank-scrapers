import { extendAsyncTimeout, getTestsConfig } from '../tests/tests-utils';
import { BaseScraperWithBrowser } from './base-scraper-with-browser';

const testsConfig = getTestsConfig();

function isNoSandbox(browser: any) {
  // eslint-disable-next-line no-underscore-dangle
  const args = browser._process.spawnargs;
  return args.includes('--no-sandbox');
}

describe('Base scraper with browser', () => {
  beforeAll(() => {
    extendAsyncTimeout(); // The default timeout is 5 seconds per async test, this function extends the timeout value
  });

  xtest('should pass custom args to scraper if provided', async () => {
    const options = {
      ...testsConfig.options,
      companyId: 'test',
      showBrowser: false,
      args: [],
    };

    // avoid false-positive result by confirming that --no-sandbox is not a default flag provided by puppeteer
    let baseScraperWithBrowser = new BaseScraperWithBrowser(options);
    try {
      await baseScraperWithBrowser.initialize();
      // @ts-ignore
      expect(baseScraperWithBrowser.browser).toBeDefined();
      // @ts-ignore
      expect(isNoSandbox(baseScraperWithBrowser.browser)).toBe(false);
      await baseScraperWithBrowser.terminate(true);
    } catch (e) {
      await baseScraperWithBrowser.terminate(false);
      throw e;
    }

    // set --no-sandbox flag and expect it to be passed by puppeteer.lunch to the new created browser instance
    options.args = ['--no-sandbox', '--disable-gpu', '--window-size=1920x1080'];
    baseScraperWithBrowser = new BaseScraperWithBrowser(options);
    try {
      await baseScraperWithBrowser.initialize();
      // @ts-ignore
      expect(baseScraperWithBrowser.browser).toBeDefined();
      // @ts-ignore
      expect(isNoSandbox(baseScraperWithBrowser.browser)).toBe(true);
      await baseScraperWithBrowser.terminate(true);
    } catch (e) {
      await baseScraperWithBrowser.terminate(false);
      throw e;
    }
  });
});
