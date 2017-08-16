let injected = false;

async function verifyJQuery(page) {
  if (!injected) {
    await page.includeJs('https://ajax.googleapis.com/ajax/libs/jquery/1.8.2/jquery.min.js');
    injected = true;
  }
}

async function fetchGet(page, url) {
  await verifyJQuery(page);
  return page.evaluate((url) => {
    const result = $.ajax({
      async: false,
      url,
    });
    return JSON.parse(result.responseText);
  }, url);
}

export default fetchGet;
