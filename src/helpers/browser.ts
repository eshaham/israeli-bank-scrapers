import { type Page } from 'puppeteer';

export async function maskHeadlessUserAgent(page: Page): Promise<void> {
  const userAgent = await page.evaluate(() => navigator.userAgent);
  await page.setUserAgent(userAgent.replace('HeadlessChrome/', 'Chrome/'));
}

/**
 * Add random human-like delay
 */
export function randomDelay(min: number = 500, max: number = 2000): Promise<void> {
  const delay = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise(resolve => setTimeout(resolve, delay));
}

/**
 * Priorities for request interception. The higher the number, the higher the priority.
 * We want to let others to have the ability to override our interception logic therefore we hardcode them.
 */
export const interceptionPriorities = {
  abort: 1000,
  continue: 10,
};
