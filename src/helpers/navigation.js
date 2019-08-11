import waitUntil from './waiting';

export async function waitForNavigation(page, options) {
  await page.waitForNavigation(options);
}

export async function waitForNavigationAndDomLoad(page) {
  await waitForNavigation(page, { waitUntil: 'domcontentloaded' });
}

export async function getCurrentUrl(page, clientSide = false) {
  if (clientSide) {
    return page.evaluate(() => window.location.href);
  }

  return page.url();
}

export async function waitForRedirect(page, timeout = 20000, clientSide = false, ignoreList = []) {
  const initial = await getCurrentUrl(page, clientSide);

  try {
    await waitUntil(async () => {
      const current = await getCurrentUrl(page, clientSide);
      return current !== initial && !ignoreList.includes(current);
    }, `waiting for redirect from ${initial}`, timeout, 1000);
  } catch (e) {
    if (e && e.timeout) {
      const current = await getCurrentUrl(page, clientSide);
      e.lastUrl = current;
    }
    throw e;
  }
}
