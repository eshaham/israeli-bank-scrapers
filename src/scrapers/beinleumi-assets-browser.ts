import { type Page, type Frame } from 'puppeteer';
import { type AssetSnapshot, type SecuritiesPage, type PortfolioSummary } from './beinleumi-assets';
const securitiesPath = '/bff-cpm3/api/v1/portfolio/securities';
export interface ReadTemplate {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}
function bankFrame(page: Page, path: string): Frame | undefined {
  return page
    .frames()
    .find(f => f.url().startsWith('https://online.fibi.co.il/') && new URL(f.url()).pathname.includes(path));
}
const appResponse = (url: string, path: string) => {
  try {
    const u = new URL(url);
    return u.origin === 'https://apps.fibi.co.il' && u.pathname === path;
  } catch {
    return false;
  }
};

export function nextPageRequest(template: ReadTemplate, pageNumber: number, cacheId: string): ReadTemplate {
  if (
    !appResponse(template.url, securitiesPath) ||
    !['GET', 'POST'].includes(template.method) ||
    !Number.isInteger(pageNumber) ||
    pageNumber < 0
  )
    throw new Error('Invalid FIBI pagination request');
  const url = new URL(template.url);
  let body = template.body,
    updated = false;
  if (body) {
    const parsed = JSON.parse(body);
    function update(value: any) {
      if (!value || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) {
        if (key === 'pageNumber') {
          value[key] = pageNumber;
          updated = true;
        } else if (key === 'cacheId') value[key] = cacheId;
        else update(child);
      }
    }
    update(parsed);
    body = JSON.stringify(parsed);
  }
  if (url.searchParams.has('pageNumber')) {
    url.searchParams.set('pageNumber', String(pageNumber));
    updated = true;
  }
  if (url.searchParams.has('cacheId')) url.searchParams.set('cacheId', cacheId);
  if (!updated) throw new Error('Unsupported FIBI pagination request shape');
  const headers = Object.fromEntries(
    Object.entries(template.headers).filter(
      ([key]) =>
        !/^(?:cookie|host|content-length|origin|referer|user-agent|accept-encoding|connection|sec-)/i.test(key),
    ),
  );
  return { url: url.href, method: template.method, headers, ...(body ? { body } : {}) };
}

export async function readAssets(page: Page): Promise<AssetSnapshot> {
  await page.waitForSelector('fibi-balance', { timeout: 45000 });
  await page.waitForSelector('.fibi-account-select .current-account .account_num', { timeout: 30000 });
  const home = page.url(),
    snapshot: AssetSnapshot = {
      accountNumber: await page.$eval('.fibi-account-select .current-account .account_num', element =>
        (element as HTMLElement).innerText.trim(),
      ),
    };
  const fxAvailable = await page.evaluate(() =>
    Array.from(document.querySelectorAll('a')).some(a => /שערוך.*מט/.test(a.innerText)),
  );
  if (fxAvailable) {
    await page.evaluate(() =>
      Array.from(document.querySelectorAll('a'))
        .find(a => /שערוך.*מט/.test(a.innerText))!
        .click(),
    );
    await page.waitForFrame(
      f =>
        f.url().startsWith('https://online.fibi.co.il/') &&
        new URL(f.url()).pathname.includes('AuthFCTransFCPortfolio'),
      { timeout: 45000 },
    );
    const frame = bankFrame(page, 'AuthFCTransFCPortfolio')!;
    await frame.waitForSelector('#maintable031', { timeout: 30000 });
    snapshot.fx = await frame.evaluate(() => {
      const accountNumber = document.querySelector<HTMLElement>('div.fibi_account span.acc_num')?.innerText.trim();
      if (!accountNumber) throw new Error('Missing FX account scope');
      const sections: { currencyLabel: string; rows: string[][] }[] = [];
      let label = '';
      for (const e of document.querySelectorAll('h1,h2,h3,table.rounded.data.tblshadow1')) {
        if (e.matches('h1,h2,h3')) {
          const text = (e as HTMLElement).innerText.trim();
          if (/פרוט למטבע|פירוט למטבע/.test(text)) label = text;
        } else {
          if (!label) throw new Error('Missing FX currency heading');
          sections.push({
            currencyLabel: label,
            rows: Array.from(e.querySelectorAll('tr.transaction')).map(row =>
              Array.from(row.querySelectorAll(':scope > td')).map(cell => (cell as HTMLElement).innerText.trim()),
            ),
          });
        }
      }
      if (!sections.length) throw new Error('FIBI FX currency tables unavailable');
      return { accountNumber, sections };
    });
    await page.goto(home, { waitUntil: 'networkidle2', timeout: 45000 });
    await page.waitForSelector('fibi-balance', { timeout: 30000 });
  }
  const securitiesAvailable = await page.evaluate(() =>
    Array.from(document.querySelectorAll('a')).some(a => a.innerText.includes('שערוך ני')),
  );
  if (securitiesAvailable) {
    const pending = [
      securitiesPath,
      '/bff-cpm3/api/v1/portfolio/main-info',
      '/bff-cpm3/api/v1/portfolio/accountdetails',
    ].map(path => page.waitForResponse(r => appResponse(r.url(), path) && r.status() === 200, { timeout: 45000 }));
    // Attach a rejection handler immediately: navigation failures must not leave
    // delayed response-wait promises as unhandled rejections in the worker.
    const all = Promise.all(pending);
    void all.catch(() => undefined);
    await page.evaluate(() =>
      Array.from(document.querySelectorAll('a'))
        .find(a => a.innerText.includes('שערוך ני'))!
        .click(),
    );
    const [securities, mainInfo, details] = await all;
    const first = (await securities.json()) as SecuritiesPage,
      pages = [first],
      summary = (await mainInfo.json()) as PortfolioSummary,
      accountDetails = (await details.json()) as NonNullable<AssetSnapshot['securities']>['accountDetails'];
    const request = securities.request(),
      template: ReadTemplate = {
        url: request.url(),
        method: request.method(),
        headers: request.headers(),
        body: request.postData(),
      };
    if (
      !first.pagedResult ||
      !Number.isInteger(first.pagedResult.totalNumberOfPages) ||
      first.pagedResult.totalNumberOfPages > 100
    )
      throw new Error('Invalid FIBI securities pagination');
    if (first.pagedResult.totalNumberOfPages > 1) {
      await page.waitForFrame(f => f.url().startsWith('https://apps.fibi.co.il/cpm3/'), { timeout: 30000 });
      const frame = page.frames().find(f => f.url().startsWith('https://apps.fibi.co.il/cpm3/'))!;
      for (let offset = 1; offset < first.pagedResult.totalNumberOfPages; offset++) {
        const next = nextPageRequest(template, first.pagedResult.pageNumber + offset, first.pagedResult.cacheId);
        const payload = await frame.evaluate(async options => {
          const response = await fetch(options.url, {
            method: options.method,
            headers: options.headers,
            body: options.body,
            credentials: 'include',
            redirect: 'error',
            signal: AbortSignal.timeout(30000),
          });
          if (!response.ok) throw new Error('Securities page unavailable');
          return response.json();
        }, next);
        pages.push(payload as SecuritiesPage);
      }
    }
    snapshot.securities = { pages, summary, accountDetails };
  }
  await page.goto(home, { waitUntil: 'networkidle2', timeout: 45000 });
  return snapshot;
}
