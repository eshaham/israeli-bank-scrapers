Israeli Bank Scrapers - Get closer to your own data
========
<img src="./logo.png" width="100" height="100" alt="Logo" align="left" />

[![NPM](https://nodei.co/npm/israeli-bank-scrapers.png)](https://nodei.co/npm/israeli-bank-scrapers/)

[![npm version](https://badge.fury.io/js/israeli-bank-scrapers.svg)](https://badge.fury.io/js/israeli-bank-scrapers)
[![dependencies Status](https://david-dm.org/eshaham/israeli-bank-scrapers/status.svg)](https://david-dm.org/eshaham/israeli-bank-scrapers)
[![devDependencies Status](https://david-dm.org/eshaham/israeli-bank-scrapers/dev-status.svg)](https://david-dm.org/eshaham/israeli-bank-scrapers?type=dev)

# What's here?
What you can find here is scrapers for all major Israeli banks and credit card companies. That's the plan at least.
Currently only the following banks are supported:
- Bank Hapoalim (thanks [@sebikaplun](https://github.com/sebikaplun))
- Leumi Bank (thanks [@esakal](https://github.com/esakal))
- Discount Bank
- Otsar Hahayal Bank (thanks [@matanelgabsi](https://github.com/matanelgabsi))
- Visa Cal (thanks [@nirgin](https://github.com/nirgin))
- Leumi Card
- Isracard
- Amex (thanks [@erezd](https://github.com/erezd))

# Prerequisites
To use this you will need to have [Node.js](https://nodejs.org) >= 6 installed.

# Getting started
To use these scrapers you'll need to install the package from npm:
```sh
npm install israeli-bank-scrapers --save
```
Then you can simply import and use it in your node module:
```node
const { createScraper } = require('israeli-bank-scrapers');

const credentials = {...}; // different for each bank
const options = {...};
const scraper = createScraper(options);
const scrapeResult = await scraper.scrape(credentials);

if (scrapeResult.success) {
  scrapeResult.accounts.forEach((account) => {
    console.log(`found ${account.txns.length} transactions for account number ${account.accountNumber}`);
  });
}
else {
  console.error(`scraping failed for the following reason: ${scrapeResult.errorType}`);
}
```
The definition of the `options` object is as follows:
```node
{
  companyId: string, // mandatory; one of 'hapoalim', 'leumi', 'discount', 'otsarHahayal', 'visaCal', 'leumiCard', 'isracard', 'amex'
  startDate: Date, // the date to fetch transactions from (can't be before the minimum allowed time difference for the scraper)
  combineInstallments: boolean, // if set to true, all installment transactions will be combine into the first one
  showBrowser: boolean, // shows the browser while scraping, good for debugging (default false)
  verbose: boolean, // include more debug info about in the output
  browser : Browser // optional option from init puppeteer browser instance outside the libary scope. you can get browser diretly from puppeteer via `puppeteer.launch()` command. 
}
```
The structure of the result object is as follows:
```node
{
  success: boolean,
  accounts: [{
    accountNumber: string,
    txns: [{
      type: string, // can be either 'normal' or 'installments'
      identifier: int, // only if exists
      date: string, // ISO date string
      processedDate: string, // ISO date string
      originalAmount: double,
      originalCurrency: string,
      chargedAmount: double,
      description: string,
      memo: string, // can be null or empty
      installments: {
        number: int, // the current installment number
        total: int, // the total number of installments
      },
      status: string //can either be 'completed' or 'pending'
    }],
  }],
  errorType: "invalidPassword"|"changePassword"|"timeout"|"generic", // only on success=false
  errorMessage: string, // only on success=false
}
```
You can also use the `SCRAPERS` list to get scraper metadata:
```node
const { SCRAPERS } = require('israeli-bank-scrapers');
```
The return value is a list of scraper metadata:
```node
{
  <companyId>: {
    name: string, // the name of the scraper
    loginFields: [ // a list of login field required by this scraper
      '<some field>' // the name of the field
    ]
  }
}
```

# Specific definitions per scraper

## Bank Hapoalim scraper
This scraper expects the following credentials object:
```node
const credentials = {
  userCode: <user identification code>,
  password: <user password>
};
```
This scraper supports fetching transaction from up to one year.

## Bank Leumi scraper
This scraper expects the following credentials object:
```node
const credentials = {
  username: <user name>,
  password: <user password>
};
```
This scraper supports fetching transaction from up to one year.

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

### Known Limitations
- Missing memo field

## Bank Otsar Hahayal scraper
This scraper expects the following credentials object:
```node
const credentials = {
  username: <user name>,
  password: <user password>
};
```
This scraper supports fetching transaction from up to one year.

## Visa Cal scraper
This scraper expects the following credentials object:
```node
const credentials = {
  username: <user name>,
  password: <user password>
};
```
This scraper supports fetching transaction from up to one year.

## Leumi-Card scraper
This scraper expects the following credentials object:
```node
const credentials = {
  username: <user name>,
  password: <user password>
};
```
This scraper supports fetching transaction from up to one year.

## Isracard scraper
This scraper expects the following credentials object:
```node
const credentials = {
  id: <user identification number>,
  card6Digits: <6 last digits of card>
  password: <user password>
};
```
This scraper supports fetching transaction from up to one year.

## Amex scraper
This scraper expects the following credentials object:
```node
const credentials = {
  id: <user identification number>,
  card6Digits: <6 last digits of card>
  password: <user password>
};
```
This scraper supports fetching transaction from up to one year.

# Known projects
These are the projects known to be using this module:
- [Israeli YNAB updater](https://github.com/eshaham/israeli-ynab-updater) - A command line tool for exporting banks data to CSVs, formatted specifically for [YNAB](https://www.youneedabudget.com)
- [Israel Finance Telegram Bot](https://github.com/GuyLewin/israel-finance-telegram-bot) - A simple telegram bot that sends notifications about new transactions and interacts with them

Built something interesting you want to share here? [Let me know](https://goo.gl/forms/5Fb9JAjvzMIpmzqo2).

# License
The MIT License
