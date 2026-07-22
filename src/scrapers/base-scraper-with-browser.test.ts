import { extendAsyncTimeout, getTestsConfig } from '../tests/tests-utils';
import { BaseScraperWithBrowser } from './base-scraper-with-browser';
import { type DeviceTrustData, type ScraperOptions } from './interface';

const testsConfig = getTestsConfig();

/** Minimal options good enough to construct a scraper without launching a browser. */
function buildOptions(): ScraperOptions {
  return { companyId: 'test', startDate: new Date() } as unknown as ScraperOptions;
}

/** A puppeteer `Page` stand-in that records the device-trust calls without a real browser. */
function createMockPage(overrides: Record<string, unknown> = {}) {
  return {
    setCookie: jest.fn().mockResolvedValue(undefined),
    goto: jest.fn().mockResolvedValue(undefined),
    evaluate: jest.fn().mockResolvedValue(undefined),
    cookies: jest.fn().mockResolvedValue([]),
    ...overrides,
  };
}

/** Build a scraper with its private `page` replaced by a mock. */
function scraperWithMockPage(page: ReturnType<typeof createMockPage>) {
  const scraper = new BaseScraperWithBrowser(buildOptions());
  (scraper as any).page = page;
  return scraper;
}

const injectTrust = (scraper: any, data: DeviceTrustData) => scraper.injectDeviceTrustData(data);
const extractTrust = (scraper: any): Promise<DeviceTrustData> => scraper.extractDeviceTrustData();

describe('Device trust data', () => {
  describe('injectDeviceTrustData', () => {
    test('restores localStorage on the recorded origin', async () => {
      const page = createMockPage();
      const scraper = scraperWithMockPage(page);

      await injectTrust(scraper, {
        cookies: [{ name: 'a', value: 'b', domain: 'login.bankhapoalim.co.il' }] as DeviceTrustData['cookies'],
        localStorage: { RFDEVICEID: 'xyz' },
        origin: 'https://login.bankhapoalim.co.il',
      });

      expect(page.setCookie).toHaveBeenCalledWith({ name: 'a', value: 'b', domain: 'login.bankhapoalim.co.il' });
      expect(page.goto).toHaveBeenCalledWith('https://login.bankhapoalim.co.il', { waitUntil: 'domcontentloaded' });
      expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), { RFDEVICEID: 'xyz' });
    });

    test('without an origin, falls back to the most specific host-only cookie domain', async () => {
      const page = createMockPage();
      const scraper = scraperWithMockPage(page);

      await injectTrust(scraper, {
        cookies: [
          { name: 'wildcard', value: '1', domain: '.bankhapoalim.co.il' }, // parent wildcard — ignored
          { name: 'short', value: '2', domain: 'bankhapoalim.co.il' }, // host-only, shorter
          { name: 'long', value: '3', domain: 'login.bankhapoalim.co.il' }, // host-only, most specific
        ] as DeviceTrustData['cookies'],
        localStorage: { k: 'v' },
      });

      // The most specific host-only domain wins, not the first cookie's (often wildcard) domain.
      expect(page.goto).toHaveBeenCalledWith('https://login.bankhapoalim.co.il', { waitUntil: 'domcontentloaded' });
      expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), { k: 'v' });
    });

    test('with an invalid origin, falls back to the most specific host-only cookie domain', async () => {
      const page = createMockPage();
      const scraper = scraperWithMockPage(page);

      await injectTrust(scraper, {
        cookies: [
          { name: 'wildcard', value: '1', domain: '.bankhapoalim.co.il' },
          { name: 'login', value: '2', domain: 'login.bankhapoalim.co.il' },
        ] as DeviceTrustData['cookies'],
        localStorage: { k: 'v' },
        origin: 'not-an-origin',
      });

      expect(page.goto).toHaveBeenCalledWith('https://login.bankhapoalim.co.il', { waitUntil: 'domcontentloaded' });
      expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), { k: 'v' });
    });

    test('skips localStorage restore when no origin can be determined', async () => {
      const page = createMockPage();
      const scraper = scraperWithMockPage(page);

      await injectTrust(scraper, {
        // only a wildcard domain — not usable as an origin
        cookies: [{ name: 'a', value: '1', domain: '.bankhapoalim.co.il' }] as DeviceTrustData['cookies'],
        localStorage: { k: 'v' },
      });

      expect(page.setCookie).toHaveBeenCalledTimes(1); // cookies are still restored
      expect(page.goto).not.toHaveBeenCalled();
      expect(page.evaluate).not.toHaveBeenCalled();
    });

    test('skips navigation when there is no localStorage to restore', async () => {
      const page = createMockPage();
      const scraper = scraperWithMockPage(page);

      await injectTrust(scraper, {
        cookies: [{ name: 'a', value: 'b', domain: 'login.bankhapoalim.co.il' }] as DeviceTrustData['cookies'],
        localStorage: {},
        origin: 'https://login.bankhapoalim.co.il',
      });

      expect(page.setCookie).toHaveBeenCalledTimes(1);
      expect(page.goto).not.toHaveBeenCalled();
      expect(page.evaluate).not.toHaveBeenCalled();
    });

    test('does nothing (and does not throw) on empty trust data', async () => {
      const page = createMockPage();
      const scraper = scraperWithMockPage(page);

      await injectTrust(scraper, { cookies: [], localStorage: {} });

      expect(page.setCookie).not.toHaveBeenCalled();
      expect(page.goto).not.toHaveBeenCalled();
      expect(page.evaluate).not.toHaveBeenCalled();
    });
  });

  describe('extractDeviceTrustData', () => {
    test('serializes only the whitelisted cookie fields plus localStorage and origin', async () => {
      const page = createMockPage({
        cookies: jest.fn().mockResolvedValue([
          {
            name: 'a',
            value: 'b',
            domain: 'login.bankhapoalim.co.il',
            path: '/',
            expires: -1,
            httpOnly: true,
            secure: true,
            sameSite: 'Lax',
            // fields that must NOT be persisted:
            size: 42,
            session: false,
          },
        ]),
        evaluate: jest
          .fn()
          .mockResolvedValueOnce({ RFDEVICEID: 'xyz' }) // localStorage snapshot
          .mockResolvedValueOnce('https://login.bankhapoalim.co.il'), // window.location.origin
      });
      const scraper = scraperWithMockPage(page);

      const data = await extractTrust(scraper);

      expect(data.cookies).toEqual([
        {
          name: 'a',
          value: 'b',
          domain: 'login.bankhapoalim.co.il',
          path: '/',
          expires: -1,
          httpOnly: true,
          secure: true,
          sameSite: 'Lax',
        },
      ]);
      expect(data.localStorage).toEqual({ RFDEVICEID: 'xyz' });
      expect(data.origin).toBe('https://login.bankhapoalim.co.il');
    });
  });

  test('round-trip: extracted trust is re-injected on the same origin', async () => {
    const extractPage = createMockPage({
      cookies: jest.fn().mockResolvedValue([{ name: 'a', value: 'b', domain: 'login.bankhapoalim.co.il' }]),
      evaluate: jest
        .fn()
        .mockResolvedValueOnce({ RFDEVICEID: 'xyz' })
        .mockResolvedValueOnce('https://login.bankhapoalim.co.il'),
    });
    const extracted = await extractTrust(scraperWithMockPage(extractPage));

    const injectPage = createMockPage();
    await injectTrust(scraperWithMockPage(injectPage), extracted);

    expect(injectPage.goto).toHaveBeenCalledWith('https://login.bankhapoalim.co.il', { waitUntil: 'domcontentloaded' });
    expect(injectPage.evaluate).toHaveBeenCalledWith(expect.any(Function), { RFDEVICEID: 'xyz' });
  });
});

function isNoSandbox(browser: any) {
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
