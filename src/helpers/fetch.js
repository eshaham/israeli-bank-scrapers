async function fetchGet(page, url) {
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

async function fetchPost(page, url, data) {
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

export { fetchGet, fetchPost };
