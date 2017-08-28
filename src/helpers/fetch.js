let injected = false;

async function verifyJQuery(page) {
  if (!injected) {
    await page.includeJs('https://ajax.googleapis.com/ajax/libs/jquery/1.8.2/jquery.min.js');
    injected = true;
  }
}

async function fetch(page, url, method = 'GET', data) {
  await verifyJQuery(page);
  return page.evaluate((url, method, data) => {
    const result = $.ajax({
      async: false,
      url,
      method,
      data,
      dataType: 'json',
    });
    return JSON.parse(result.responseText);
  }, url, method, data);
}

async function fetchPost(page, url, data) {
  return fetch(page, url, 'POST', data);
}

export { fetch as fetchGet, fetchPost };
