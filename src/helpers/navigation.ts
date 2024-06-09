import {
  Frame,
  Page, WaitForOptions,
} from 'puppeteer';
import { waitUntil } from './waiting';

export async function waitForNavigation(pageOrFrame: Page | Frame, options?: WaitForOptions) {
  await pageOrFrame.waitForNavigation(options);
}

export async function waitForNavigationAndDomLoad(page: Page) {
  await waitForNavigation(page, { waitUntil: 'domcontentloaded' });
}

export function getCurrentUrl(pageOrFrame: Page | Frame, clientSide = false) {
  if (clientSide) {
    return pageOrFrame.evaluate(() => window.location.href);
  }

  return pageOrFrame.url();
}

export async function waitForRedirect(pageOrFrame: Page | Frame, timeout = 20000,
  clientSide = false, ignoreList: string[] = []) {
  const initial = await getCurrentUrl(pageOrFrame, clientSide);

  await waitUntil(async () => {
    const current = await getCurrentUrl(pageOrFrame, clientSide);
    return current !== initial && !ignoreList.includes(current);
  }, `waiting for redirect from ${initial}`, timeout, 1000);
}

export async function waitForUrl(pageOrFrame: Page | Frame, url: string | RegExp, timeout = 20000, clientSide = false) {
  await waitUntil(async () => {
    const current = await getCurrentUrl(pageOrFrame, clientSide);
    return url instanceof RegExp ? url.test(current) : url === current;
  }, `waiting for url to be ${url}`, timeout, 1000);
}
