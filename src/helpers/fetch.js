async function fetchGet(page, url, method = 'GET', data) {
  return page.evaluate((url, method, data) => {
    return new Promise((resolve, reject) => {
      fetch(url, {
        method,
        body: data,
        credentials: 'include',
      }).then((result) => {
        resolve(result.json());
      }).catch((e) => {
        reject(e);
      });
    });
  }, url, method, data);
}

async function fetchPost(page, url, data) {
  return fetch(page, url, 'POST', data);
}

export { fetchGet, fetchPost };
