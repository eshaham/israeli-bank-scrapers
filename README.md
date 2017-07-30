Israeli Bank Scrapers - Get closer to your own data
========
[![NPM](https://nodei.co/npm/israeli-bank-scrapers.png)](https://nodei.co/npm/israeli-bank-scrapers/)

[![npm version](https://badge.fury.io/js/israeli-bank-scrapers.svg)](https://badge.fury.io/js/israeli-bank-scrapers)
[![dependencies Status](https://david-dm.org/eshaham/israeli-bank-scrapers/status.svg)](https://david-dm.org/eshaham/israeli-bank-scrapers)
[![devDependencies Status](https://david-dm.org/eshaham/israeli-bank-scrapers/dev-status.svg)](https://david-dm.org/eshaham/israeli-bank-scrapers?type=dev)

# What's here?
What you can find here is scrapers for all major Israeli banks and credit card companies. That's the plan at least.
Currently only Discount Banks is supported.

# Prerequisites
You will need to have `PhatomJS`

# Getting started
To use these scrapers you'll need to install the package from npm:
```sh
npm install israeli-bank-scrapers --save
```
Then you can simply import and use it in your node module:
```node
const scrapers = require('israeli-bank-scrapers');

const credentials = {...}; // different for each bank
const scrapeResult = await scrapers.discountScraper(credentials);

if (scrapeResult.success) {
  console.log(`account number: ${scrapeResult.accountNumber}`);
  console.log(`# transactions found: ${scrapeResult.txns.length}`);
}
else {
  console.error(`scraping failed for the following reason: ${scrapeResult.errorType}`);
}
```
The structure of the result object is as follows:
```node
{
  "success": true|false
  "errorType": 'invalidPassword'|'changePassword' // only on success=false
  "accountNumber": string,
  "txns": [{
    ... // currently what discount returns, will need to standardize soon
  }],
}
```
Note: only `discountScraper`is available.

# Credentials per scraper
## Discount scraper
This scraper expects the following credentials object:
```node
const credentials = {
  id: <user identification number>,
  password: <user password>,
  num: <user identificaiton code>
};
```

# License
The MIT License
