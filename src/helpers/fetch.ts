import https from 'https';
import { type Page } from 'puppeteer';

const JSON_CONTENT_TYPE = 'application/json';

function getJsonHeaders() {
  return {
    Accept: JSON_CONTENT_TYPE,
    'Content-Type': JSON_CONTENT_TYPE,
  };
}

function assertAutomationNotBlocked(status: number, responseText: string | null, url: string) {
  if (status === 429 || (responseText && /block automation|bot detection/i.test(responseText))) {
    throw new Error(
      `Automation detected and blocked by server. Status: ${status}, URL: ${url}. The site is actively blocking automated access. Consider: 1) Using showBrowser:true, 2) Adding longer delays, 3) Using residential proxies, 4) Running at different times of day`,
    );
  }
}

export async function fetchGet<TResult>(url: string, extraHeaders: Record<string, any>): Promise<TResult> {
  let headers = getJsonHeaders();
  if (extraHeaders) {
    headers = Object.assign(headers, extraHeaders);
  }
  const request = {
    method: 'GET',
    headers,
  };
  const fetchResult = await fetch(url, request);

  if (fetchResult.status !== 200) {
    throw new Error(`sending a request to the institute server returned with status code ${fetchResult.status}`);
  }

  return fetchResult.json();
}

export interface ClientCertificate {
  cert: string;
  key: string;
}

function fetchPostWithMtls(url: string, headers: Record<string, string>, body: string, clientCert: ClientCertificate) {
  return new Promise<{ status: number; text: string }>((resolve, reject) => {
    const request = https.request(
      url,
      { method: 'POST', headers: { ...headers, 'Content-Length': Buffer.byteLength(body) }, ...clientCert },
      response => {
        const chunks: Buffer[] = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => resolve({ status: response.statusCode ?? 0, text: Buffer.concat(chunks).toString() }));
      },
    );
    request.on('error', reject);
    request.end(body);
  });
}

export async function fetchPost<TResult = any>(
  url: string,
  data: Record<string, any>,
  extraHeaders: Record<string, any> = {},
  clientCert?: ClientCertificate,
): Promise<TResult> {
  const headers = { ...getJsonHeaders(), ...extraHeaders };
  const body = JSON.stringify(data);
  const { status, text } = clientCert
    ? await fetchPostWithMtls(url, headers, body, clientCert)
    : await fetch(url, { method: 'POST', headers, body }).then(async result => ({
        status: result.status,
        text: await result.text(),
      }));
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `sending a request to the institute server returned with status code ${status} and a non-JSON body`,
    );
  }
}

export async function fetchGraphql<TResult>(
  url: string,
  query: string,
  variables: Record<string, unknown> = {},
  extraHeaders: Record<string, any> = {},
  clientCert?: ClientCertificate,
): Promise<TResult> {
  const result = await fetchPost(url, { operationName: null, query, variables }, extraHeaders, clientCert);
  if (result.errors?.length) {
    throw new Error(result.errors[0].message);
  }
  return result.data as Promise<TResult>;
}

export async function fetchGetWithinPage<TResult>(
  page: Page,
  url: string,
  ignoreErrors = false,
): Promise<TResult | null> {
  const [result, status] = await page.evaluate(async innerUrl => {
    let response: Response | undefined;
    try {
      response = await fetch(innerUrl, { credentials: 'include' });
      if (response.status === 204) {
        return [null, response.status] as const;
      }
      return [await response.text(), response.status] as const;
    } catch (e) {
      throw new Error(
        `fetchGetWithinPage error: ${e instanceof Error ? `${e.message}\n${e.stack}` : String(e)}, url: ${innerUrl}, status: ${response?.status}`,
      );
    }
  }, url);

  if (!ignoreErrors) {
    assertAutomationNotBlocked(status, result, url);
  }

  if (result !== null) {
    try {
      return JSON.parse(result);
    } catch (e) {
      if (!ignoreErrors) {
        throw new Error(
          `fetchGetWithinPage parse error: ${e instanceof Error ? `${e.message}\n${e.stack}` : String(e)}, url: ${url}, result: ${result}, status: ${status}`,
        );
      }
    }
  }
  return null;
}

export async function fetchPostWithinPage<TResult>(
  page: Page,
  url: string,
  data: Record<string, any>,
  extraHeaders: Record<string, any> = {},
  ignoreErrors = false,
): Promise<TResult | null> {
  const [resultText, status] = await page.evaluate(
    async (innerUrl: string, innerData: Record<string, any>, innerExtraHeaders: Record<string, any>) => {
      const response = await fetch(innerUrl, {
        method: 'POST',
        body: JSON.stringify(innerData),
        credentials: 'include',

        headers: Object.assign(
          { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
          innerExtraHeaders,
        ),
      });
      if (response.status === 204) {
        return [null, response.status] as const;
      }
      return [await response.text(), response.status] as const;
    },
    url,
    data,
    extraHeaders,
  );

  if (!ignoreErrors) {
    assertAutomationNotBlocked(status, resultText, url);
  }

  try {
    if (resultText !== null) {
      return JSON.parse(resultText);
    }
  } catch (e) {
    if (!ignoreErrors) {
      throw new Error(
        `fetchPostWithinPage parse error: ${e instanceof Error ? `${e.message}\n${e.stack}` : String(e)}, url: ${url}, data: ${JSON.stringify(data)}, extraHeaders: ${JSON.stringify(extraHeaders)}, result: ${resultText}`,
      );
    }
  }
  return null;
}
