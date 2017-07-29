# What's here?
What you can find here is scrapers for all major Israeli banks and credit card companies. That's the plan at least.
Currently only Discount Banks is supported

# Getting started
To use these scrapers you'll need to install the package from npm:
```sh
npm install israeli-bank-scrapers --save
```
Then you can simply import and use it in your node module:
```node
const scrapers = require('israeli-bank-scrapers');

const credentials = {...}; // different for each bank
const accountData = await scrapers.discountScraper(credentials);

console.log(`account number: ${accountData.accountNumber}`);
console.log(`# transactions found: ${accountData.txns.length}`);
```
For now, you can only use `discountScraper`.

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
