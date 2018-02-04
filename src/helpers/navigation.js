import waitUntil from './waiting';

const NAVIGATION_ERRORS = {
  TIMEOUT: 'timeout',
  GENERIC: 'generic',
};

async function waitForNavigation(page) {
  await page.waitForNavigation();
}

async function getCurrentUrl(page, clientSide = false) {
  if (clientSide) {
    return page.evaluate(() => window.location.href);
  }

  return page.url();
}

async function waitForRedirect(page, timeout = 20000, clientSide = false) {
  const initial = await getCurrentUrl(page, clientSide);
  try {
    await waitUntil(async () => {
      const current = await getCurrentUrl(page, clientSide);
      return current !== initial;
    }, `waiting for redirect from ${initial}`, timeout, 1000);
  } catch (e) {
    if (e && e.timeout) {
      const current = await getCurrentUrl(page, clientSide);
      e.lastUrl = current;
    }
    throw e;
  }
}

export { waitForNavigation, waitForRedirect, getCurrentUrl, NAVIGATION_ERRORS };
