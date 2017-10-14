import waitUntil from './waiting';

const NAVIGATION_ERRORS = {
  TIMEOUT: 'timeout',
  GENERIC: 'generic',
};

async function waitForNavigation(page) {
  await page.waitForNavigation();
}

async function waitForRedirect(page, timeout = 20000) {
  const initial = await page.url();
  try {
    await waitUntil(async () => {
      const current = await page.url();
      return current !== initial;
    }, `waiting for redirect from ${initial}`, timeout, 1000);
  } catch (e) {
    if (e && e.timeout) {
      const current = await page.url();
      e.lastUrl = current;
    }
    throw e;
  }
}

export { waitForNavigation, waitForRedirect, NAVIGATION_ERRORS };
