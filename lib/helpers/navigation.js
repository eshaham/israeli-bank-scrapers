import waitUntil from './waiting';

function getKeyByValue(object, value) {
  return Object.keys(object).find(key => object[key] === value);
}

async function waitForUrls(page, urls, timeout = 20000) {
  try {
    await waitUntil(async () => {
      const current = await page.property('url');
      return getKeyByValue(urls, current) != null;
    }, timeout, 1000);
  } catch (e) {
    if (e && e.timeout) {
      const current = await page.property('url');
      console.log(`timeout reached this page: ${current}`);
      e.lastUrl = current;
    }
    throw e;
  }

  const current = await page.property('url');
  return getKeyByValue(urls, current);
}

function waitForUrl(page, url, timeout) {
  return waitForUrls(page, { default: url }, timeout);
}

async function waitForRedirect(page, timeout = 20000) {
  const initial = await page.property('url');
  try {
    await waitUntil(async () => {
      const current = await page.property('url');
      return current !== initial;
    }, timeout, 1000);
  } catch (e) {
    if (e && e.timeout) {
      const current = await page.property('url');
      console.log(`timeout reached this page: ${current}`);
      e.lastUrl = current;
    }
    throw e;
  }
}

export { waitForUrls, waitForUrl, waitForRedirect };
