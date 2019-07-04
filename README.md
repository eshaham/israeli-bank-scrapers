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
  browser : Browser, // optional option from init puppeteer browser instance outside the libary scope. you can get browser diretly from puppeteer via `puppeteer.launch()` command.
  executablePath: string // optional. provide a patch to local chromium to be used by puppeteer. Relevant when using `israeli-bank-scrapers-core` library 
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

# Israeli-bank-scrapers-core
Israeli bank scrapers library is published in two variations:
 1. [israeli-bank-scrapers]() - the default variation, great for common usage as node depdency in server application or cli.
 2. [israeli-bank-scrapers-core]() - extremely useful for applications that bundle node_modules like Electron applications. 
 
*Why?* Because both variations are using `puppeteer` to scrape many companies. `puppeteer` requires specific chromium version installed locally. 
 
 The default variation [israeli-bank-scrapers]() is using [puppeteer]() which handles the installation of local chroumium on its' own. Very handy flow since it abstract the chromium installation but as a side effect it increases node_modules by several hounded megabytes. 
 The default one is depends on `puppeteer` internally which is using his own version of chroumium. Usually you will want to use the default version.
 
 The core variation [israeli-bank-scrapers-core]() is using [puppeteer-core]() which is has the same library as [puppeteer]() except that it doesn't download chromium, it is up to you to download the specific version of chromium. It is useful in Electron applications since it doesn't bloat the size of the application and you can provide a much friendlier experience and download it later when needed. 
 
 To install [israeli-bank-scrapers-core]():
```sh
npm install israeli-bank-scrapers-core --save
```

It exposes the same API as the default variation, with extra method that is needed and explained in next section.

## Getting chromium version used by puppeteer-core
When using the [israeli-bank-scrapers-core]() library you must:
1. query for the specific chromium revision required by this library.
2. make sure that you have local version of that revision.
3. provide an absolute path to [israeli-bank-scrapers-core]().

Please read the following to learn more about the process: 
1. To get the chromium revision number use the following code:
```
import { getPuppeteerConfig } from 'israeli-bank-scrapers-core';

const chromiumVersion = getPuppeteerConfig().chromiumRevision;
```

2. Once you have the chromium revision needed, you can either download it manually or use other liraries like [download-chromium](https://www.npmjs.com/package/download-chromium) to fetch that version. The mentioned library is very handy as it caches the download and provide useful helpers like download progress information.
 
 3. provide the path to chromium to the library using the option key `executablePath`. 

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
