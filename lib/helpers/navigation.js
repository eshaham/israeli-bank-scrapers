import waitUntil from './waiting';

const NAVIGATION_ERRORS = {
  TIMEOUT: 'timeout',
  GENERIC: 'generic',
};

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
    if (e.timeout) {
      const current = await page.property('url');
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
      e.lastUrl = current;
    }
    throw e;
  }
}

async function waitForPageLoad(page, timeout = 20000) {
  const eventName = 'onLoadFinished';

  let loading = true;
  await page.on(eventName, () => {
    loading = false;
    page.off(eventName);
  });

  await waitUntil(async () => {
    return !loading;
  }, timeout, 1000);
}

export { waitForUrls, waitForUrl, waitForRedirect, waitForPageLoad, NAVIGATION_ERRORS };
