import { type Page } from 'puppeteer';

export async function maskHeadlessUserAgent(page: Page): Promise<void> {
  const userAgent = await page.evaluate(() => navigator.userAgent);
  await page.setUserAgent(userAgent.replace('HeadlessChrome/', 'Chrome/'));
}
