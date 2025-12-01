import nodeFetch from 'node-fetch';
import { type Page } from 'puppeteer';

const JSON_CONTENT_TYPE = 'application/json';

function getJsonHeaders() {
  return {
    Accept: JSON_CONTENT_TYPE,
    'Content-Type': JSON_CONTENT_TYPE,
  };
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
  const fetchResult = await nodeFetch(url, request);

  if (fetchResult.status !== 200) {
    throw new Error(`sending a request to the institute server returned with status code ${fetchResult.status}`);
  }

  return fetchResult.json();
}

export async function fetchPost(url: string, data: Record<string, any>, extraHeaders: Record<string, any> = {}) {
  const request = {
    method: 'POST',
    headers: { ...getJsonHeaders(), ...extraHeaders },
    body: JSON.stringify(data),
  };
  const result = await nodeFetch(url, request);
  return result.json();
}

export async function fetchGraphql<TResult>(
  url: string,
  query: string,
  variables: Record<string, unknown> = {},
  extraHeaders: Record<string, any> = {},
): Promise<TResult> {
  const result = await fetchPost(url, { operationName: null, query, variables }, extraHeaders);
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
  const result = await page.evaluate(
    async (innerUrl: string, innerData: Record<string, any>, innerExtraHeaders: Record<string, any>) => {
      const response = await fetch(innerUrl, {
        method: 'POST',
        body: JSON.stringify(innerData),
        credentials: 'include',
        // eslint-disable-next-line prefer-object-spread
        headers: Object.assign(
          { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
          innerExtraHeaders,
        ),
      });
      if (response.status === 204) {
        return null;
      }
      return response.text();
    },
    url,
    data,
    extraHeaders,
  );

  try {
    if (result !== null) {
      return JSON.parse(result);
    }
  } catch (e) {
    if (!ignoreErrors) {
      throw new Error(
        `fetchPostWithinPage parse error: ${e instanceof Error ? `${e.message}\n${e.stack}` : String(e)}, url: ${url}, data: ${JSON.stringify(data)}, extraHeaders: ${JSON.stringify(extraHeaders)}, result: ${result}`,
      );
    }
  }
  return null;
}
