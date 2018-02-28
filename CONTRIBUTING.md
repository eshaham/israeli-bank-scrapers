Contributing to Israeli Bank Scrapers
========
Hey people, first of all, thanks for taking the time to help improving this project :beers:

This project needs the help of other developers, since it's impossible getting access to all relevant banks and credit cards.

# How can I contribute?
Any kind of help is welcome, even if you just discover an issue and don't have the time to invest in helping to fix it.

## Filing issues
While there's no specific template for creating a new issue, please take the time to create a clear description so that it is easy to understand the problem.

## Submitting PRs
Again, no template, but please try to create something of the form:

```markdown
Changes:

* Created a new scraper for bank X
* Refactor blah blah
* etc...
```

## Creating a new scraper
It is best to look at an existing example.
Most scrapers inherit from `BaseScraper`, notice that you need to implement the following:

### Overriding getLoginOptions()
Unless you plan to override the entire `login()` function, You can override this function to login regularly in a login form.

```node
function getPossibleLoginResults() {
  const urls = {};
  // in case of multiple possible login results, add them to the arrays as items
  urls[LOGIN_RESULT.SUCCESS] = ['<SUCCESS_URL>'];
  urls[LOGIN_RESULT.INVALID_PASSWORD] = ['<INVALID_PASSWORD_URL>'];
  urls[LOGIN_RESULT.CHANGE_PASSWORD] = ['<CHANGE_PASSWORD_URL>'];
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
      date: Date,
      processedDate: Date,
      originalAmount: double,
      originalCurrency: string,
      chargedAmount: double,
      description: string,
      installments: {
        number: int, // the current installment number
        total: int, // the total number of installments
      }
    }],  
  }],
  errorType: "invalidPassword"|"changePassword"|"timeout"|"generic", // only on success=false
  errorMessage: string, // only on success=false
}
```
