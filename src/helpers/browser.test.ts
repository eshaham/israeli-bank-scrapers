import { type Page } from 'puppeteer';
import { maskBrowserAutomation } from './browser';

function createPage(browserVersion: string) {
  const setUserAgent = jest.fn().mockResolvedValue(undefined);
  const setExtraHTTPHeaders = jest.fn().mockResolvedValue(undefined);
  const evaluateOnNewDocument = jest.fn().mockResolvedValue(undefined);
  const page = {
    browser: () => ({
      version: jest.fn().mockResolvedValue(browserVersion),
    }),
    setUserAgent,
    setExtraHTTPHeaders,
    evaluateOnNewDocument,
  } as unknown as Page;
  return { page, setUserAgent, setExtraHTTPHeaders, evaluateOnNewDocument };
}

describe('maskBrowserAutomation', () => {
  test('uses the installed Chrome version for a consistent browser fingerprint', async () => {
    const { page, setUserAgent, setExtraHTTPHeaders, evaluateOnNewDocument } = createPage('Chrome/146.0.7680.153');

    await maskBrowserAutomation(page);

    expect(setUserAgent).toHaveBeenCalledWith(expect.stringContaining('Chrome/146.0.0.0'));
    expect(setExtraHTTPHeaders).toHaveBeenCalledWith(
      expect.objectContaining({
        'sec-ch-ua': expect.stringContaining('"Chromium";v="146"'),
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
      }),
    );
    expect(evaluateOnNewDocument).toHaveBeenCalledTimes(1);
  });
});
