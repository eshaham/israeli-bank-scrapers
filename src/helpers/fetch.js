import nodeFetch from 'node-fetch';

const JSON_CONTENT_TYPE = 'application/json';

function getJsonHeaders() {
  return {
    Accept: JSON_CONTENT_TYPE,
    'Content-Type': JSON_CONTENT_TYPE,
  };
}

export async function fetchGet(url, extraHeaders) {
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

export async function fetchPost(url, data, extraHeaders) {
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

export async function fetchGetWithinPage(page, url) {
  return page.evaluate((url) => {
    return new Promise((resolve, reject) => {
      fetch(url, {
        credentials: 'include',
      }).then((result) => {
        resolve(result.json());
      }).catch((e) => {
        reject(e);
      });
    });
  }, url);
}

export async function fetchPostWithinPage(page, url, data) {
  return page.evaluate((url, data) => {
    return new Promise((resolve, reject) => {
      fetch(url, {
        method: 'POST',
        body: JSON.stringify(data),
        credentials: 'include',
        headers: new Headers({ 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' }),
      }).then((result) => {
        resolve(result.json());
      }).catch((e) => {
        reject(e);
      });
    });
  }, url, data);
}
