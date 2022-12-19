const path = require('path');

const startDate = new Date();
startDate.setMonth(startDate.getMonth() - 1);

module.exports = {
  options: { // options object that is passed to the scrapers. see more in readme.md file
    startDate,
    combineInstallments: false,
    showBrowser: true,
    verbose: false,
    args: [],
    storeFailureScreenShotPath: false // path.resolve(__dirname, 'snapshots/failure.jpg')
  },
  credentials: { // commented companies will be skipped automatically, uncomment those you wish to test
    // hapoalim: { userCode: '', password: '' },
    // leumi: { username: '', password: '' },
    // hapoalimBeOnline: { userCode: '', password: '' },
    // discount: { id: '', password: '', num: '' },
    // otsarHahayal: { username: '', password: '' },
    // max: { username: '', password: '' },
    // visaCal: { username: '', password: '' },
    // isracard: { id: '', password: '', card6Digits: '' },
    // amex: { id: '', card6Digits: '', password: ''},
    // mizrahi: { username: '', password: ''},
    // union: {username:'',password:''}
    // beinleumi: { username: '', password: ''},
    // yahav: {username: '', nationalID: '', password: ''}
    // beyahadBishvilha: { id: '', password: ''},
  },
  companyAPI: { // enable companyAPI to execute tests against the real companies api
    enabled: true,
    excelFilesDist: '', // optional - provide exists directory path to save scraper results (csv format)
    invalidPassword: false, // enable to execute tests that execute with invalid credentials
  },
};
