const startDate = new Date();
startDate.setMonth(startDate.getMonth() - 1);

export default {
  options: { // options object that is passed to the scrapers. see more in readme.md file
    startDate,
    combineInstallments: false,
    showBrowser: true,
    verbose: false,
  },
  credentials: { // commented companies will be skipped automatically, uncomment those you wish to test
    // hapoalim: { userCode: '', password: '' },
    // leumi: { username: '', password: '' },
    // discount: { id: '', password: '', num: '' },
    // otsarHahayal: { username: '', password: '' },
    // leumiCard: { username: '', password: '' },
    // visaCal: { username: '', password: '' },
    // isracard: { id: '', password: '', card6Digits: '' },
  },
  companyAPI: { // enable companyAPI to execute tests against the real companies api
    enabled: true,
    invalidPassword: false, // enable to execute tests that execute with invalid credentials
  },
};
