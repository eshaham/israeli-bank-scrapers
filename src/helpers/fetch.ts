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
  const result = await nodeFetch(url, request);
  return result.json();
}

export async function fetchPost(url: string, data: Record<string, any>,
  extraHeaders: Record<string, any>) {
  let headers = getJsonHeaders();
  if (extraHeaders) {
    headers = Object.assign(headers, extraHeaders);
  }
  const request = {
    method: 'POST',
    headers,
    body: JSON.stringify(data),
  };
  const result = await nodeFetch(url, request);
  return result.json();
}

export async function fetchGetWithinPage<TResult>(page: Page, url: string): Promise<TResult | null> {
  return page.evaluate((url) => {
    return new Promise<TResult | null>((resolve, reject) => {
      fetch(url, {
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

export async function fetchPostWithinPage<TResult>(page: Page, url: string,
  data: Record<string, any>, extraHeaders: Record<string, any> = {}): Promise<TResult | null> {
  return page.evaluate<(...args: any[]) => Promise<TResult | null>>((url: string, data: Record<string, any>,
    extraHeaders: Record<string, any>) => {
    return new Promise((resolve, reject) => {
      fetch(url, {
        method: 'POST',
        body: JSON.stringify(data),
        credentials: 'include',
        // eslint-disable-next-line prefer-object-spread
        headers: Object.assign({ 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' }, extraHeaders),
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
