# Israeli Bank Scrapers - Get closer to your own data!

<img src="./logo.png" width="100" height="100" alt="Logo" align="left" />

[![NPM](https://nodei.co/npm/israeli-bank-scrapers.png)](https://nodei.co/npm/israeli-bank-scrapers/)

[![npm version](https://badge.fury.io/js/israeli-bank-scrapers.svg)](https://badge.fury.io/js/israeli-bank-scrapers)
[![Discord](https://img.shields.io/discord/924617301209260103?logo=discord)](https://discord.gg/2UvGM7aX4p)

## About this repository (hardened fork)

This repository is a **hardened fork** of [eshaham/israeli-bank-scrapers](https://github.com/eshaham/israeli-bank-scrapers) (upstream). It is maintained separately and adds security- and privacy-oriented hardening; it does **not** replace the upstream unscoped [`israeli-bank-scrapers`](https://www.npmjs.com/package/israeli-bank-scrapers) package.

**Install this fork from npm** ([package page](https://www.npmjs.com/package/@hirez10/israeli-bank-scrapers)):

```sh
npm install @hirez10/israeli-bank-scrapers
```

### Fork status — what’s different here

At a high level, this fork includes:

- Safer logging and error handling (fewer sensitive details in logs by default)
- Stricter defaults for debug/runtime controls and sensitive options
- A tighter published package surface and build output, plus dependency hygiene and pre-publish audit review where applicable

This is **not** a claim that the code is “fully secure” or that all issues are eliminated. Treat financial integrations with care. For security-related notes and maintenance guidance, see **[SECURITY.md](./SECURITY.md)**.

### Upstream sync

This fork tracks **[eshaham/israeli-bank-scrapers](https://github.com/eshaham/israeli-bank-scrapers)**. Last merged upstream release: **[v6.7.4](https://github.com/eshaham/israeli-bank-scrapers/releases/tag/v6.7.4)** ([`847f5f74e3923c3993b802c7a25fe12b30c1d18c`](https://github.com/eshaham/israeli-bank-scrapers/commit/847f5f74e3923c3993b802c7a25fe12b30c1d18c)). The same tag and commit are recorded under `upstreamSync` in [`package.json`](./package.json) for automation and release notes.

**Sync status:** Upstream [latest release](https://github.com/eshaham/israeli-bank-scrapers/releases/latest) is **v6.7.4** — this fork is aligned. When upstream publishes a newer version, maintainers should merge `upstream/master` and run `npm run sync:upstream:metadata` (see [Upstream sync](./CONTRIBUTING.md#upstream-sync-maintainers)).

### npm dependencies

This fork keeps **patch/minor** dependency updates current via `npm update`; `package-lock.json` is committed and CI uses `npm ci`. Major upgrades (for example Jest 30, TypeScript 6, ESLint 10) are done in separate migrations. See [CHANGELOG.md](./CHANGELOG.md) for the latest refresh.

### Fork releases (npm vs GitHub)

This fork’s [GitHub releases](https://github.com/HirezRa/israeli-bank-scrapers/releases) use tags **`hirez-v1.x.x`** (current publish line: [**`hirez-v1.0.20`**](https://github.com/HirezRa/israeli-bank-scrapers/releases/tag/hirez-v1.0.20)). The numeric part is the same **semver** published to npm as [@hirez10/israeli-bank-scrapers](https://www.npmjs.com/package/@hirez10/israeli-bank-scrapers). If npm lags behind GitHub, the Release workflow likely failed on **npm publish** (for example `E404` on a scoped package: missing or underpowered `NPM_TOKEN`, or org publish rights on `@hirez10`). See [npm publish recovery](./CONTRIBUTING.md#npm-publish-recovery-github-ahead-of-npm).

> Important!
>
> The scrapers are set to use timezone `Asia/Jerusalem` to avoid conflicts in case you're running the scrapers outside Israel.

# What's here?

What you can find here is scrapers for all major Israeli banks and credit card companies. That's the plan at least.
Currently only the following banks are supported:

- Bank Hapoalim (thanks [@sebikaplun](https://github.com/sebikaplun))
- Leumi Bank (thanks [@esakal](https://github.com/esakal))
- Discount Bank
- Mercantile Bank (thanks [@ezzatq](https://github.com/ezzatq) and [@kfirarad](https://github.com/kfirarad)))
- Mizrahi Bank (thanks [@baruchiro](https://github.com/baruchiro))
- Otsar Hahayal Bank (thanks [@matanelgabsi](https://github.com/matanelgabsi))
- Visa Cal (thanks [@erikash](https://github.com/erikash), [@esakal](https://github.com/esakal) and [@nirgin](https://github.com/nirgin))
- Max (Formerly Leumi Card)
- Isracard
- Amex (thanks [@erezd](https://github.com/erezd))
- Union Bank (Thanks to Intuit FDP OpenSource Team [@dratler](https://github.com/dratler),[@kalinoy](https://github.com/kalinoy),[@shanigad](https://github.com/shanigad),[@dudiventura](https://github.com/dudiventura) and [@NoamGoren](https://github.com/NoamGoren))
- Beinleumi (Thanks to [@dudiventura](https://github.com/dudiventura) from the Intuit FDP OpenSource Team)
- Massad
- Yahav (Thanks to [@gczobel](https://github.com/gczobel))
- Beyhad Bishvilha - [ביחד בשבילך](https://www.hist.org.il/) (thanks [@esakal](https://github.com/esakal))
- OneZero (Experimental) (thanks [@orzarchi](https://github.com/orzarchi))
- Behatsdaa - [בהצדעה](behatsdaa.org.il) (thanks [@daniel-hauser](https://github.com/daniel-hauser))

# Security & privacy

This project handles **real financial credentials and data**. See **[SECURITY.md](./SECURITY.md)** for security-related notes, operational defaults, and maintenance guidance. That document covers:

- production / CI defaults (`NODE_ENV`, `CI`, `ALLOW_SENSITIVE_DEBUG`);
- that **`BaseScraper` enforces the same defaults for `createScraper()` and for direct `new SomeScraper(opts)`**;
- safe logging, URL sanitization (`sanitizeUrlForLogs`), and error handling;
- how `includeRawTransaction`, failure screenshots, and `verbose` / `showBrowser` are restricted in restricted runtimes;
- testing without leaking secrets.

When pasting code samples or opening issues/PRs, **never** include real passwords, OTPs, tokens, or unredacted bank responses.

# Prerequisites

To use this you will need to have [Node.js](https://nodejs.org) >= 22.13.0 installed.

# Getting started

To use these scrapers from **this fork**, install the published scoped package from npm:

```sh
npm install @hirez10/israeli-bank-scrapers --save
```

Package on npm: [https://www.npmjs.com/package/@hirez10/israeli-bank-scrapers](https://www.npmjs.com/package/@hirez10/israeli-bank-scrapers). The upstream project continues to publish [`israeli-bank-scrapers`](https://www.npmjs.com/package/israeli-bank-scrapers) separately; the two package names refer to different release lines.

Then you can import and use it in your Node module (use the fork’s package name in imports):

```node
import { CompanyTypes, createScraper } from '@hirez10/israeli-bank-scrapers';

(async function () {
  try {
    // read documentation below for available options
    const options = {
      companyId: CompanyTypes.leumi,
      startDate: new Date('2020-05-01'),
      combineInstallments: false,
      showBrowser: false,
    };

    // read documentation below for information about credentials
    // Use mock credentials only — never real banking passwords in source control or logs.
    const credentials = {
      username: 'demo_user',
      password: 'demo_password',
    };

    const scraper = createScraper(options);
    const scrapeResult = await scraper.scrape(credentials);

    if (scrapeResult.success) {
      scrapeResult.accounts.forEach(account => {
        console.log(`found ${account.txns.length} transactions for account number ${account.accountNumber}`);
      });
    } else {
      throw new Error(scrapeResult.errorType);
    }
  } catch (e) {
    console.error(`scraping failed for the following reason: ${e.message}`);
  }
})();
```

**Imports in examples below:** Many snippets still use the upstream module name `israeli-bank-scrapers` in `import` lines, matching the original README. When using **this fork**, replace that with `@hirez10/israeli-bank-scrapers` in every import.

Check the options declaration [here](./src/scrapers/interface.ts#L29) for available options.

Regarding credentials, you should provide the relevant credentials for the chosen company. See [this file](./src/definitions.ts) with list of credentials per company.

The structure of the result object is as follows:

```node
{
  success: boolean,
  accounts: [{
    accountNumber: string,
    balance?: number, // Account balance. Not implemented for all accounts.
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
      installments: { // only if exists
        number: int, // the current installment number
        total: int, // the total number of installments
      },
      status: string //can either be 'completed' or 'pending'
    }],
  }],
  errorType: "INVALID_PASSWORD"|"CHANGE_PASSWORD"|"ACCOUNT_BLOCKED"|"UNKNOWN_ERROR"|"TIMEOUT"|"GENERIC", // only on success=false
  errorMessage: string, // only on success=false
}
```

You can also use the `SCRAPERS` list to get scraper metadata:

```node
import { SCRAPERS } from 'israeli-bank-scrapers';
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

## Advanced options

### ExternalBrowserOptions

This option allows you to provide an externally created browser instance. You can get a browser directly from puppeteer via `puppeteer.launch()`.  
Note that for backwards compatibility, the browser will be closed by the library after the scraper finishes unless `skipCloseBrowser` is set to true.

Example:

```typescript
import puppeteer from 'puppeteer';
import { CompanyTypes, createScraper } from 'israeli-bank-scrapers';

const browser = await puppeteer.launch();
const options = {
  companyId: CompanyTypes.leumi,
  startDate: new Date('2020-05-01'),
  browser,
  skipCloseBrowser: true, // Or false [default] if you want it to auto-close
};
const scraper = createScraper(options);
const scrapeResult = await scraper.scrape({ username: 'vr29485', password: 'sometingsomething' });
await browser.close(); // Or not if `skipCloseBrowser` is false
```

### ExternalBrowserContextOptions

This option allows you to provide a [browser context](https://pptr.dev/api/puppeteer.browsercontext). This is useful if you don't want to share cookies with other scrapers (i.e. multiple parallel runs of the same scraper with different users) without creating a new browser for each scraper.

Example:

```typescript
import puppeteer from 'puppeteer';
import { CompanyTypes, createScraper } from 'israeli-bank-scrapers';

const browser = await puppeteer.launch();
const browserContext = await browser.createBrowserContext();
const options = {
  companyId: CompanyTypes.leumi,
  startDate: new Date('2020-05-01'),
  browserContext,
};
const scraper = createScraper(options);
const scrapeResult = await scraper.scrape({ username: 'vr29485', password: 'sometingsomething' });
await browser.close();
```

### OptIn Features

Some scrapers support opt-in features that can be enabled by passing the `optInFeatures` option when creating the scraper.
Opt in features are usually used for breaking changes that are not enabled by default to avoid breaking existing users.

See the [OptInFeatures](https://github.com/eshaham/israeli-bank-scrapers/blob/master/src/scrapers/interface.ts#:~:text=export-,type%20OptInFeatures) interface for available features.

## Two-Factor Authentication Scrapers

Some companies require two-factor authentication, and as such the scraper cannot be fully automated. When using the relevant scrapers, you have two options:

1. Provide an async callback that knows how to retrieve real time secrets like OTP codes.
2. When supported by the scraper - provide a "long term token". These are usually available if the financial provider only requires Two-Factor authentication periodically, and not on every login. You can retrieve your long term token from the relevant credit/banking app using reverse engineering and a MITM proxy, or use helper functions that are provided by some Two-Factor Auth scrapers (e.g. OneZero).

```node
import { CompanyTypes, createScraper } from 'israeli-bank-scrapers';
import { prompt } from 'enquirer';

// Option 1 - Provide a callback

const result = await scraper.login({
  email: relevantAccount.credentials.email,
  password: relevantAccount.credentials.password,
  phoneNumber,
  otpCodeRetriever: async () => {
    let otpCode;
    while (!otpCode) {
      otpCode = await questions('OTP Code?');
    }

    return otpCode[0];
  },
});

// Option 2 - Retrieve a long term otp token (OneZero)
await scraper.triggerTwoFactorAuth(phoneNumber);

// OTP is sent, retrieve it somehow
const otpCode = '...';

const result = scraper.getLongTermTwoFactorToken(otpCode);
/*
result = {
  success: true;
  longTermTwoFactorAuthToken: 'eyJraWQiOiJiNzU3OGM5Yy0wM2YyLTRkMzktYjBm...';
}
 */
```

# Getting deployed version of latest changes in master

Upstream deploys [`israeli-bank-scrapers`](https://www.npmjs.com/package/israeli-bank-scrapers) to npm when changes land on its main branch, on its own release cadence.

**This fork** publishes separately as [@hirez10/israeli-bank-scrapers](https://www.npmjs.com/package/@hirez10/israeli-bank-scrapers). Current semver in [`package.json`](./package.json) should match the latest **GitHub** release tag (**[`hirez-v1.0.20`](https://github.com/HirezRa/israeli-bank-scrapers/releases/tag/hirez-v1.0.20)**; see [all releases](https://github.com/HirezRa/israeli-bank-scrapers/releases) and [CHANGELOG](./CHANGELOG.md)). **npm** may lag GitHub if `npm publish` failed in CI — confirm the [package page](https://www.npmjs.com/package/@hirez10/israeli-bank-scrapers) version.

# `Israeli-bank-scrapers-core` library

> TL;DR this is the same library as the default library. The only difference is that it is using `puppeteer-core` instead of `puppeteer` which is useful if you are using frameworks like Electron to pack your application.
>
> In most cases you will probably want to use the default library (read [Getting Started](#getting-started) section).

Israeli bank scrapers library is published twice:

1.  [israeli-bank-scrapers](https://www.npmjs.com/package/israeli-bank-scrapers) - the default variation, great for common usage as node dependency in server application or cli.
2.  [israeli-bank-scrapers-core](https://www.npmjs.com/package/israeli-bank-scrapers-core) - extremely useful for applications that bundle `node_modules` like Electron applications.

## Differences between default and core variations

The default variation [israeli-bank-scrapers](https://www.npmjs.com/package/israeli-bank-scrapers) is using [puppeteer](https://www.npmjs.com/package/puppeteer) which handles the installation of local chroumium on its' own. This behavior is very handy since it takes care on all the hard work figuring which chromium to download and manage the actual download process. As a side effect it increases node_modules by several hundred megabytes.

The core variation [israeli-bank-scrapers-core](https://www.npmjs.com/package/israeli-bank-scrapers-core) is using [puppeteer-core](https://www.npmjs.com/package/puppeteer-core) which is exactly the same library as `puppeteer` except that it doesn't download chromium when installed by npm. It is up to you to make sure the specific version of chromium is installed locally and provide a path to that version. It is useful in Electron applications since it doesn't bloat the size of the application and you can provide a much friendlier experience like loading the application and download it later when needed.

To install `israeli-bank-scrapers-core`:

```sh
npm install israeli-bank-scrapers-core --save
```

## Getting chromium version used by puppeteer-core

When using the `israeli-bank-scrapers-core` it is up to you to make sure the relevant chromium version exists. You must:

1. query for the specific chromium revision required by the `puppeteer-core` library being used.
2. make sure that you have local version of that revision.
3. provide an absolute path to `israeli-bank-scrapers-core` scrapers.

Please read the following to learn more about the process:

1. To get the required chromium revision use the following code:

```
import { getPuppeteerConfig } from 'israeli-bank-scrapers-core';

const chromiumVersion = getPuppeteerConfig().chromiumRevision;
```

2. Once you have the chromium revision, you can either download it manually or use other liraries like [download-chromium](https://www.npmjs.com/package/download-chromium) to fetch that version. The mentioned library is very handy as it caches the download and provide useful helpers like download progress information.

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

## Mercantile scraper

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

## Mizrahi scraper

This scraper expects the following credentials object:

```node
const credentials = {
  username: <user identification number>,
  password: <user password>
};
```

This scraper supports fetching transaction from up to one year.

## Beinleumi & Massad

These scrapers are essentially identical and expect the following credentials object:

```node
const credentials = {
  username: <user name>,
  password: <user password>
};
```

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

## Max scraper (Formerly Leumi-Card)

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
  username: <user identification number>,
  card6Digits: <6 last digits of card>
  password: <user password>
};
```

This scraper supports fetching transaction from up to one year.

## Yahav

This scraper expects the following credentials object:

```node
const credentials = {
  username: <user name>,
  password: <user password>,
  nationalID: <user national ID>
};
```

This scraper uses a **rolling default window** of about **four months plus one day** (`moment().subtract(4, 'months').add(1, 'day')` unless overridden), combined with `options.startDate` as documented in code. Override the default span with env **`YAHAV_STATEMENT_MONTHS_BACK`** (integer `1`–`24`, applied in `fetchData`). It does **not** guarantee six months of history unless the bank UI allows it and `startDate` is set accordingly.

**This fork:** Statement date filtering used to target the “from” date via `div.date-options-cell:nth-child(7)`. After Yahav UI changes (May 2026), that index no longer matched. The scraper now finds the first `date-picker` in the statement area, waits for DOM presence (not strict `visible` on the compound selector), scrolls into view, then clicks—see [CHANGELOG.md](./CHANGELOG.md). For Yahav-specific behaviour, logs, and `YAHAV_DEBUG_DOM`, see [docs/YAHAV_SCRAPER.md](./docs/YAHAV_SCRAPER.md).

For **real-account** validation, use the tracked helper [utils/yahav-may-salary-smoke.cjs](./utils/yahav-may-salary-smoke.cjs) (loads `.env.local` on your machine) or another local harness. Never commit `.env.local`, passwords, or export files with real transactions.

## Beyhad Bishvilha

This scraper expects the following credentials object::

```node
const credentials = {
  id: <user identification number>,
  password: <user password>
};
```

# Known projects

These are the projects known to be using this module:

- [Israeli YNAB updater](https://github.com/eshaham/israeli-ynab-updater) - A command line tool for exporting banks data to CSVs, formatted specifically for [YNAB](https://www.youneedabudget.com)
- [Caspion](https://github.com/brafdlog/caspion) - An app for automatically sending transactions from Israeli banks and credit cards to budget tracking apps
- [Finance Notifier](https://github.com/LiranBri/finance-notifier) - A simple script with the ability to send custom financial alerts to multiple contacts and platforms
- [Moneyman](https://github.com/daniel-hauser/moneyman) - Automatically save transactions from all major Israeli banks and credit card companies, using GitHub actions (or a self hosted docker image)
- [Firefly iii Importer](https://github.com/itairaz1/israeli-bank-firefly-importer) - A tool to import your banks data into [Firefly iii](https://www.firefly-iii.org/), a free and open source financial manager.
- [Actual Budget Importer](https://github.com/tomerh2001/israeli-banks-actual-budget-importer) - A tool to import your banks data into [Actual Budget](https://actualbudget.com/), a free and open source financial manager.
- [Clarify](https://github.com/tomyweiss/clarify-expences) - A full-stack personal finance app for tracking income and expenses.
- [Asher MCP](https://github.com/shlomiuziel/asher-mcp) - Scrape & access your financial data with LLM using the Model Context Protocol.

Built something interesting you want to share here? [Let me know](https://goo.gl/forms/5Fb9JAjvzMIpmzqo2).

# License

The MIT License
