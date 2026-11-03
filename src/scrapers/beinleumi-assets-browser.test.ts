import puppeteer, { type HTTPRequest } from 'puppeteer';
import { readAssets, nextPageRequest } from './beinleumi-assets-browser';
import { attachAssets } from './beinleumi-assets';

jest.setTimeout(45000);

test('reads bank FX frames and a complete paged securities portfolio without real bank traffic', async () => {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.ASSETS_TEST_CHROMIUM,
    args: process.env.PUPPETEER_NO_SANDBOX === 'true' ? ['--no-sandbox'] : [],
  });
  const fixtureSecurity = (number: string) => ({
    number,
    name: 'Fixture fund',
    type: 'MutualFund',
    amount: 10,
    lastKnownRate: 1000,
    adjustedCostRate: 900,
    holdingValue: 100,
    holdingValueInNis: 100,
    currencyISOCode: 'ILS',
    nonRevaluation: false,
  });
  const requests: string[] = [];
  const page = await browser.newPage();
  try {
    await page.setRequestInterception(true);
    page.on('request', (request: HTTPRequest) => {
      const url = new URL(request.url());
      requests.push(url.href);
      let body = '',
        contentType = 'text/html; charset=utf-8';
      if (url.origin === 'https://online.fibi.co.il' && url.pathname === '/home')
        body =
          '<fibi-balance></fibi-balance><account-select-mobile class="fibi-account-select"><div class="current-account"><span class="account_num">127-001234</span></div></account-select-mobile><a href="/fx">שערוך מט״ח</a><a href="/securities">שערוך ני״ע</a>';
      else if (url.origin === 'https://online.fibi.co.il' && url.pathname === '/fx')
        body = '<iframe src="/AuthFCTransFCPortfolio"></iframe>';
      else if (url.origin === 'https://online.fibi.co.il' && url.pathname === '/AuthFCTransFCPortfolio')
        body =
          '<div class="fibi_account"><span class="acc_num">001234</span></div><div id="maintable031"><h3>פרוט למטבע פרנק שויצר</h3><table class="rounded data tblshadow1"><tr class="transaction"><td>Action</td><td>Current</td><td>4</td><td>50</td><td>200</td><td>40</td><td>160</td></tr></table></div>';
      else if (url.origin === 'https://online.fibi.co.il' && url.pathname === '/securities')
        body = '<iframe src="https://apps.fibi.co.il/cpm3/portfolio"></iframe>';
      else if (url.origin === 'https://apps.fibi.co.il' && url.pathname === '/cpm3/portfolio')
        body =
          '<script>Promise.all([fetch("/bff-cpm3/api/v1/portfolio/securities?pageNumber=1&cacheId=fixture"),fetch("/bff-cpm3/api/v1/portfolio/main-info"),fetch("/bff-cpm3/api/v1/portfolio/accountdetails")]);</script>';
      else if (url.origin === 'https://apps.fibi.co.il' && url.pathname.startsWith('/bff-cpm3/api/v1/portfolio/')) {
        contentType = 'application/json';
        if (url.pathname.endsWith('/securities')) {
          const number = Number(url.searchParams.get('pageNumber'));
          body = JSON.stringify({
            pagedResult: {
              cacheId: 'fixture',
              pageNumber: number,
              totalNumberOfPages: 2,
              totalNumberOfRecords: 2,
              results: [fixtureSecurity(String(number))],
            },
          });
        } else if (url.pathname.endsWith('/main-info'))
          body = JSON.stringify({ currencyISOCode: 'ILS', portfolioValue: 200 });
        else if (url.pathname.endsWith('/accountdetails'))
          body = JSON.stringify([{ accounts: [{ mch: '001234', snif: '127' }] }]);
      }
      // Every request is answered locally; unknown paths fail instead of going online.
      void request.respond({ status: body ? 200 : 404, contentType, body }).catch(() => undefined);
    });
    await page.goto('https://online.fibi.co.il/home');
    const snapshot = await readAssets(page);
    const [account] = attachAssets([{ accountNumber: '001234', balance: 1000, txns: [] }], snapshot, '2026-10-04');
    expect(account.foreignCurrencyBalances).toEqual([{ currency: 'CHF', balance: 50, valueInILS: 200 }]);
    expect(account.securitiesPortfolio?.holdings).toHaveLength(2);
    expect(account.securitiesPortfolio?.value).toBe(200);
    expect(page.url()).toBe('https://online.fibi.co.il/home');
    expect(requests.some(url => url.includes('pageNumber=2'))).toBe(true);
    expect(requests.every(url => ['online.fibi.co.il', 'apps.fibi.co.il'].includes(new URL(url).hostname))).toBe(true);
  } finally {
    await browser.close();
  }
});

test('pagination copies only authenticated read parameters and rejects unsupported request shapes', () => {
  const template = {
    url: 'https://apps.fibi.co.il/bff-cpm3/api/v1/portfolio/securities',
    method: 'POST',
    headers: { authorization: 'fixture', cookie: 'private', host: 'apps.fibi.co.il' },
    body: JSON.stringify({ filter: { pageNumber: 1, cacheId: 'old' } }),
  };
  const next = nextPageRequest(template, 2, 'new');
  expect(JSON.parse(next.body!)).toEqual({ filter: { pageNumber: 2, cacheId: 'new' } });
  expect(next.headers).toEqual({ authorization: 'fixture' });
  expect(() => nextPageRequest({ ...template, body: '{}' }, 2, 'new')).toThrow(/Unsupported/);
  expect(() => nextPageRequest({ ...template, url: 'https://other.invalid/securities' }, 2, 'new')).toThrow(/Invalid/);
});
