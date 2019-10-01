const startDate = new Date();
startDate.setMonth(startDate.getMonth() - 1);

export default {
  schemaVersion: 1, // used to validate the configuration schema. don't manually change it.
  options: { // options object that is passed to the scrapers. see more in readme.md file
    startDate,
    combineInstallments: false,
    showBrowser: true,
    verbose: false,
    onProgress: (name, status) => {
      console.log(`[${name}] ${status}`);
    },
  },
  credentials: { // commented companies will be skipped automatically, uncomment those you wish to test
    // hapoalim: { userCode: '', password: '' },
    // leumi: { username: '', password: '' },
    // discount: { id: '', password: '', num: '' },
    // otsarHahayal: { username: '', password: '' },
    // leumiCard: { username: '', password: '' },
    // visaCal: { username: '', password: '' },
    // isracard: { id: '', password: '', card6Digits: '' },
    // amex: { id: '', card6Digits: '', password: ''},
  },
  companyAPI: {
    dist: '', // optional - provide valid path to save scraper results
    legacy: false,  // enable companyAPI to execute tests against the real companies api
    transactions: false, // execute tests of transactions scraping
    invalidPassword: false, // execute tests that check invalid passwords handling
    checks: false, // execute tests of checks scraping
  },
};
