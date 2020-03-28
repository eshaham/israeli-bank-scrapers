import waitUntil from '@core/helpers/waiting';
import { BASE_URL } from '../definitions';


export async function getRestContext(page) {
  await waitUntil(async () => {
    return page.evaluate(() => !!window.bnhpApp);
  }, 'waiting for app data load');

  const result = await page.evaluate(() => {
    return window.bnhpApp.restContext;
  });

  return result.slice(1);
}

export async function getAPISiteUrl(page) {
  const restContext = await getRestContext(page);
  return `${BASE_URL}/${restContext}`;
}
