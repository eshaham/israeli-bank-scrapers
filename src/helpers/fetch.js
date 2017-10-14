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

export default fetchGet;
