Contributing to Israeli Bank Scrapers
========
Hey people, first of all, thanks for taking the time to help improving this project :beers:

This project needs the help of other developers, since it's impossible getting access to all relevant banks and credit cards.

# How can I contribute?
Any kind of help is welcome, even if you just discover an issue and don't have the time to invest in helping to fix it.

## Filing issues
While there's no specific template for creating a new issue, please take the time to create a clear description so that it is easy to understand the problem.

## Testing the scrapers
In order to run tests you need first to create test configuration file `./tests/tests-config.js` from template `./test/tests-config.tpl.js`. This file will be used by `jest` testing framework. 

> IMPORTANT: Under `tests` library exists `.gitignore` file that ignore the test configuration file thus this file will not be commited to github. Still when you create new PRs make sure that you didn't explicitly added it to the PR.

This library supports both testing against credit card companies / banks api and also against mock data. Until we will have a good coverage of scrapers test with mock data, the default configuration is set to execute real companies api tests.

### Changing tests options
Modify property `options` in the test configuration file. This object is passed as-is to the scraper.

### Testing specific companies
Enable any company you wish to test by providing its credetials in the test configuration file under `credentials` property. 

### Running tests from CLI
> Before running any tests, make sure you created the test configuration file with relevant credentials, 

To run all tests of companies that you provided credentials to:
```
npm test
```

To run specific `describe` (a.k.a suite), use the `testNamePattern` arg with the name of the suite. The following will run the all tests under `Leumi legacy scraper` suite.
```
npm test -- --testNamePattern="Leumi legacy scraper"
```

To run specific `test`, use the `testNamePattern` arg with suite name following the test name. The following will run test `should expose login fields in scrapers constant` that is part of `Leumi legacy scraper` suite.
```
npm test -- --testNamePattern="Leumi legacy scraper should expose login fields in scrapers constant"
``` 

### Running tests using IDE
Many IDEs support running jest tests directly from the UI. In webstorm for example a small play icon automatically appears next to each describe/test. 

**IMPORTANT Note** babel is configured to ignore tests by default. You must add an environment variable `BABEL_ENV=test` to the IDE test configuration to allow the tests to work. 

### save unit test scraper results into file
To save unit test scraper results provide a valid path in test configurations property `excelFilesDist`, for example:

```
{
   companyAPI: { 
      enabled: true, 
      excelFilesDist: '/Users/xyz/Downloads/Transactions',
      
    },
  
}
```

### F.A.Q regarding the tests

#### How can I run tests with CI/CD services?
You can use environment variables instead of a local file to provide the tests configuration.

1. Copy to clipboard the exported object from file `.tests-config.tpl.js` (copy the json object without `export default` from line 4 until the end of the file). 
    - **Make sure you copy the template file and not the local file with your credentials.**
2. Paste the exported object into a javascrip to json converter. If you don't have any use [this converter](https://www.convertonline.io/convert/js-to-json) or [that converter](https://bl.ocks.org/domoritz/259b881c162c5618c7b8c22682521769). 
3. **NOTE that** you will see a syntax error of the json file as the object doesn't provide value to property `options.startDate`. To fix it assign a value to that property (ie value `2019-08-01`).
4. Copy the json content and adjust it with relevant information.
5. Assign it to environment variable named `TESTS_CONFIG`. 

If you wish to try it from cli (mac os), you should either create a one liner json configuration or use cat to provide multiline value:

```
TESTS_CONFIG=`cat <<EOF
{
	... replace with actual json configuration ...
}
EOF
` npm run test
```


#### Trying to run the tests using the CLI fail saying the test configuration file is missing
Make sure that you created test configuration file `./tests/.tests-config.js` from template `./test/tests-config.tpl.js`.

#### Trying to run the tests using the IDE fail saying the test configuration file is missing
1. Make sure that you created test configuration file `./tests/.tests-config.js` from template `./test/tests-config.tpl.js`.
2. Make sure that you added environment variable `BABEL_ENV=test` to the IDE test configuration.

#### Tests of desired company are skipped without any errors
Make sure that you uncommented the company credentials in the test configuration file.

#### Tests that are done against the credit cards companies / banks api are skipped without any errors
1. Make sure that you uncommented the company credentials in the test configuration file.
2. Enable credit card companies / banks api tests in configuration file `companyAPI.enabled: true`

#### Where is the playground CLI scripts that were here few versions ago?
The playground scripts were ok at the time and allowed us to develop and test scrapers. Since then we added new types of scrapers with different public api and we needed a better solution that will catch up with those changes.

In addition, the playground was offering an encryption of the passwords which lead to false sense of security since the private key was held in the source codes. Anyone could easily find the private key and decrypt those passwords. The new approach better reflect the standard way by providing a template file and ignoring the user specific configuration file . The developer "sees" the file and review its' PRs which should provide better understanding of what is going on. 

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
2. Run `npm run prepare:core`. The script will change the name inside `package.json` to `prepare-israeli-bank-scrapers-core`, change puppeteer dependency to `puppeteer-core`, reinstall dependencies and rebuild the library. 
3. Run `npm publish`. This will publish `prepare-israeli-bank-scrapers-core` package.
4. Run `npm run reset` to reset the changes.

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
  errorType: "INVALID_PASSWORD"|"CHANGE_PASSWORD"|"TIMEOUT"|"UNKNOWN_ERROR"|"GENERIC", // only on success=false
    errorMessage: string, // only on success=false
}
```
