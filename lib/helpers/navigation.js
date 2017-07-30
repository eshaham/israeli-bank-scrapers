import waitUntil from './waiting';

async function waitForUrl(page, url) {
  try {
    await waitUntil(async () => {
      const current = await page.property('url');
      return current === url;
    }, 20000, 1000);
  } catch (e) {
    if (e && e.timeout) {
      const current = await page.property('url');
      console.log(`timeout reached this page: ${current}`);
      e.lastUrl = current;
    }
    throw e;
  }
}

export default waitForUrl;
