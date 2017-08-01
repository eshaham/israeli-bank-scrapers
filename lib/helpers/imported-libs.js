const JQUERY_URL = 'https://ajax.googleapis.com/ajax/libs/jquery/1.8.2/jquery.min.js';

async function includeJQuery(page) {
  await page.includeJs(JQUERY_URL);
}

export default includeJQuery;
