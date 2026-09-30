import { type Page } from 'puppeteer';

const FALLBACK_CHROME_MAJOR_VERSION = '127';

export async function maskBrowserAutomation(page: Page): Promise<void> {
  const browserVersion = await page.browser().version();
  const chromeMajorVersion = browserVersion.match(/Chrome\/(\d+)/)?.[1] ?? FALLBACK_CHROME_MAJOR_VERSION;
  const userAgent =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    `(KHTML, like Gecko) Chrome/${chromeMajorVersion}.0.0.0 Safari/537.36`;

  await page.setUserAgent(userAgent);
  await page.setExtraHTTPHeaders({
    'sec-ch-ua':
      `"Chromium";v="${chromeMajorVersion}", "Not)A;Brand";v="99", ` + `"Google Chrome";v="${chromeMajorVersion}"`,
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'accept-language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7',
  });
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });
}

/**
 * Priorities for request interception. The higher the number, the higher the priority.
 * We want to let others to have the ability to override our interception logic therefore we hardcode them.
 */
export const interceptionPriorities = {
  abort: 1000,
  continue: 10,
};
