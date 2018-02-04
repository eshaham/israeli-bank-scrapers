import waitUntil from './waiting';

const NAVIGATION_ERRORS = {
  TIMEOUT: 'timeout',
  GENERIC: 'generic',
};

async function waitForNavigation(page) {
  await page.waitForNavigation();
}

async function getCurrentUrl(page) {
  return page.evaluate(() => window.location.href);
}

async function waitForRedirect(page, timeout = 20000) {
  const initial = await getCurrentUrl(page);
  try {
    await waitUntil(async () => {
      const current = await getCurrentUrl(page);
      return current !== initial;
    }, `waiting for redirect from ${initial}`, timeout, 1000);
  } catch (e) {
    if (e && e.timeout) {
      const current = await getCurrentUrl(page);
      e.lastUrl = current;
    }
    throw e;
  }
}

export { waitForNavigation, waitForRedirect, getCurrentUrl, NAVIGATION_ERRORS };
