Israeli Bank Scrapers - Get closer to your own data
========
[![NPM](https://nodei.co/npm/israeli-bank-scrapers.png)](https://nodei.co/npm/israeli-bank-scrapers/)

[![npm version](https://badge.fury.io/js/israeli-bank-scrapers.svg)](https://badge.fury.io/js/israeli-bank-scrapers)
[![dependencies Status](https://david-dm.org/eshaham/israeli-bank-scrapers/status.svg)](https://david-dm.org/eshaham/israeli-bank-scrapers)
[![devDependencies Status](https://david-dm.org/eshaham/israeli-bank-scrapers/dev-status.svg)](https://david-dm.org/eshaham/israeli-bank-scrapers?type=dev)

# What's here?
What you can find here is scrapers for all major Israeli banks and credit card companies. That's the plan at least.
Currently only Discount Bank and Leumi Card are supported.

# Prerequisites
To use this you will need to have [Node.js](https://nodejs.org) >= 6 installed.

# Getting started
To use these scrapers you'll need to install the package from npm:
```sh
npm install israeli-bank-scrapers --save
```
Then you can simply import and use it in your node module:
```node
const scrapers = require('israeli-bank-scrapers');

const credentials = {...}; // different for each bank
const options = {
  eventsCallback: (msg) => {
    console.log(msg);
  }
};
const scrapeResult = await scrapers.discountScraper(credentials, options);

if (scrapeResult.success) {
  console.log(`account number: ${scrapeResult.accountNumber}`);
  console.log(`# transactions found: ${scrapeResult.txns.length}`);
}
else {
  console.error(`scraping failed for the following reason: ${scrapeResult.errorType}`);
}
```
You can currently send the following options:
```node
{
  startDate: Date, // the date to fetch transactions from (can't be before the minimum allowed time difference for the scraper)
  eventsCallback: function, // can be used to receive any progress messages from the scraper
  verbose: include more debug info about in the output
}
```
The structure of the result object is as follows:
```node
{
  success: boolean,
  accountNumber: string,
  txns: [{
    identifier: int, // only if exists
    date: Date,
    processedDate: Date,
    amount: double,
    description: string
  }],
  errorType: "invalidPassword"|"changePassword"|"timeout"|"generic", // only on success=false
  errorMessage: string, // only on success=false
}
```

# Specific definitions per scraper
## Discount scraper
This scraper expects the following credentials object:
```node
const credentials = {
  id: <user identification number>,
  password: <user password>,
  num: <user identificaiton code>
};
```
This scraper supports fetching transaction from up to one year (minus 1 day).

## Leumi-Card scraper
This scraper expects the following credentials object:
```node
const credentials = {
  username: <user email>,
  password: <user password>
};
```
This scraper supports fetching transaction from up to one year.

# License
The MIT License
