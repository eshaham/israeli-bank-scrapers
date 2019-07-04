Contributing to Israeli Bank Scrapers
========
Hey people, first of all, thanks for taking the time to help improving this project :beers:

This project needs the help of other developers, since it's impossible getting access to all relevant banks and credit cards.

# How can I contribute?
Any kind of help is welcome, even if you just discover an issue and don't have the time to invest in helping to fix it.

## Filing issues
While there's no specific template for creating a new issue, please take the time to create a clear description so that it is easy to understand the problem.

## Using the playground 
> With the integrated playground support, you can easily extend the scrapers and also enjoy the IDE debug feature if needed.

Once you prepare the playground environment you will be able to set scraping options, debug using the IDE and get the scraped transactions as generated csv files.
 
### Setup playground options & credentials
run `npm run setup` and use the interactive menu to setup both playground options and relevant scrapers credentials.

### Run a scraper
run `npm start` to execute the playground scraper.

### Debug your changes using the IDE
To run the playground scripts within your IDE debugger, make sure you configure debug node with the following parameters:
 - *Node Parameters:* `-r babel-register`
 - *Javascript file :* `playground/scrape.js`

Feel free to add breakpoints in the `src` folder, it should work smoothly. 

## Submitting PRs
Again, no template, but please try to create something of the form:

```markdown
Changes:

* Created a new scraper for bank X
* Refactor blah blah
* etc...
```

##  Publish `israeli-bank-scrapers-core` to NPM.
1. Make sure everything is committed. 
2. Run `./utils/prepare-israeli-bank-scrapers-core.js`. The script will change the name inside `package.json` to `prepare-israeli-bank-scrapers-core` and will change puppeteer dependency to `puppeteer-core`.
3. *MANDATORY* step - bebuild library to update 'lib' files. 
4. Run `npm publish`. This will publish `prepare-israeli-bank-scrapers-core` package.
5. Run `git reset --hard` to reset the changes to `package.json`.

## Creating a new scraper
It is best to look at an existing example.
Most scrapers inherit from `BaseScraper`, notice that you need to implement the following:

### Overriding getLoginOptions()
Unless you plan to override the entire `login()` function, You can override this function to login regularly in a login form.

```node
function getPossibleLoginResults() {
  const urls = {};
  // in case of multiple possible login results, add them to the arrays as items
  urls[LOGIN_RESULT.SUCCESS] = ['<SUCCESS_URL>' | <SUCCESS_REGEXP>];
  urls[LOGIN_RESULT.INVALID_PASSWORD] = ['<INVALID_PASSWORD_URL>' | <INVALID_PASSWORD_REGEXP>];
  urls[LOGIN_RESULT.CHANGE_PASSWORD] = ['<CHANGE_PASSWORD_URL>' | <CHANGE_PASSWORD_REGEXP>];
  return urls;
}

function getLoginOptions(credentials) {
  return {
    loginUrl: <LOGIN_URL>,
    fields: [
      { selector: '<USER_NAME_FIELD>', value: credentials.username },
      { selector: `<PASSWORD_FIELD>`, value: credentials.password },
    ],
    submitButtonSelector: '<SUBMIT_BUTTON>',
    possibleResults: getPossibleLoginResults(),
  };
}
```

### Overriding fetchData()
You can override this async function however way you want, as long as your return results in the following form:

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
