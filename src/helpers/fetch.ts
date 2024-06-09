import nodeFetch from 'node-fetch';
import { Page } from 'puppeteer';

const JSON_CONTENT_TYPE = 'application/json';

function getJsonHeaders() {
  return {
    Accept: JSON_CONTENT_TYPE,
    'Content-Type': JSON_CONTENT_TYPE,
  };
}

export async function fetchGet<TResult>(url: string,
  extraHeaders: Record<string, any>): Promise<TResult> {
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

export async function fetchPost(url: string, data: Record<string, any>,
  extraHeaders: Record<string, any> = {}) {
  const request = {
    method: 'POST',
    headers: { ...getJsonHeaders(), ...extraHeaders },
    body: JSON.stringify(data),
  };
  const result = await nodeFetch(url, request);
  return result.json();
}

export async function fetchGraphql<TResult>(url: string, query: string,
  variables: Record<string, unknown> = {},
  extraHeaders: Record<string, any> = {}): Promise<TResult> {
  const result = await fetchPost(url, { operationName: null, query, variables }, extraHeaders);
  if (result.errors?.length) {
    throw new Error(result.errors[0].message);
  }
  return result.data as Promise<TResult>;
}

export function fetchGetWithinPage<TResult>(page: Page, url: string): Promise<TResult | null> {
  return page.evaluate((innerUrl) => {
    return new Promise<TResult | null>((resolve, reject) => {
      fetch(innerUrl, {
        credentials: 'include',
      }).then((result) => {
        if (result.status === 204) {
          resolve(null);
        } else {
          resolve(result.json());
        }
      }).catch((e) => {
        reject(e);
      });
    });
  }, url);
}

export function fetchPostWithinPage<TResult>(page: Page, url: string,
  data: Record<string, any>, extraHeaders: Record<string, any> = {}): Promise<TResult | null> {
  return page.evaluate((innerUrl: string, innerData: Record<string, any>,
    innerExtraHeaders: Record<string, any>) => {
    return new Promise<TResult | null>((resolve, reject) => {
      fetch(innerUrl, {
        method: 'POST',
        body: JSON.stringify(innerData),
        credentials: 'include',
        // eslint-disable-next-line prefer-object-spread
        headers: Object.assign({ 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' }, innerExtraHeaders),
      }).then((result) => {
        if (result.status === 204) {
          // No content response
          resolve(null);
        } else {
          resolve(result.json());
        }
      }).catch((e) => {
        reject(e);
      });
    });
  }, url, data, extraHeaders);
}
