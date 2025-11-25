import nodeFetch from 'node-fetch';
import { type Page } from 'puppeteer';
import fightBotDetection from './anti-automation-detection';
import { type BotFightingOptions } from '../scrapers/interface';

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
  botFightingOptions?: BotFightingOptions,
): Promise<TResult | null> {
  if (botFightingOptions) {
    await fightBotDetection(page, botFightingOptions);
  }
  return page.evaluate(async (innerUrl: string) => {
    const response = await fetch(innerUrl, { credentials: 'include' });
    if (response.status === 204) return null;
    return response.json();
  }, url);
}

export async function fetchPostWithinPage<TResult>(
  page: Page,
  url: string,
  data: Record<string, any>,
  extraHeaders: Record<string, any> = {},
  botFightingOptions?: BotFightingOptions,
): Promise<TResult | null> {
  if (botFightingOptions) {
    await fightBotDetection(page, botFightingOptions);
  }
  return page.evaluate(
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
      if (response.status === 204) return null;
      return response.json();
    },
    url,
    data,
    extraHeaders,
  );
}
