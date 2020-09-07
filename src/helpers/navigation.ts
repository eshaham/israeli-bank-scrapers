import { NavigationOptions, Page } from 'puppeteer';
import { waitUntil } from './waiting';

const OK_STATUS = 200;

export async function waitForNavigation(page: Page, options?: NavigationOptions) {
  await page.waitForNavigation(options);
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

export async function navigateTo(page: Page, url: string) {
  const response = await page.goto(url);
  if (!response || response.status() !== OK_STATUS) {
    throw new Error(`Error while trying to navigate to url ${url}`);
  }
}
