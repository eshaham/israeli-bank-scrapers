import { type Page } from 'puppeteer';

export async function getFromSessionStorage<T>(page: Page, key: string): Promise<T | null> {
  const strData = await page.evaluate((k: string) => {
    return sessionStorage.getItem(k);
  }, key);

  if (!strData) return null;

  return JSON.parse(strData) as T;
}
