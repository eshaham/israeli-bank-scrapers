import { Frame, NavigationOptions, Page } from 'puppeteer';
import { waitUntil } from './waiting';

export async function waitForNavigation(pageOrFrame: Page | Frame, options?: NavigationOptions) {
  await pageOrFrame.waitForNavigation(options);
}

export async function waitForNavigationAndDomLoad(page: Page) {
  await waitForNavigation(page, { waitUntil: 'domcontentloaded' });
}

export async function getCurrentUrl(page: Page, clientSide = false) {
  if (clientSide) {
    return page.evaluate(() => window.location.href);
  }

  return page.url();
}

export async function waitForRedirect(page: Page, timeout = 20000,
  clientSide = false, ignoreList: string[] = []) {
  const initial = await getCurrentUrl(page, clientSide);

  await waitUntil(async () => {
    const current = await getCurrentUrl(page, clientSide);
    return current !== initial && !ignoreList.includes(current);
  }, `waiting for redirect from ${initial}`, timeout, 1000);
}

export async function waitForUrl(page: Page, url: string | RegExp, timeout = 20000, clientSide = false) {
  await waitUntil(async () => {
    const current = await getCurrentUrl(page, clientSide);
    return url instanceof RegExp ? url.test(current) : url === current;
  }, `waiting for url to be ${url}`, timeout, 1000);
}
