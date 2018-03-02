import moment from 'moment';
import { SCRAPERS, createScraper } from '../src';

const credentials = {
  username: '',
  password: '',
};

const options = {
  companyId: 'leumi',
  startDate: moment.now(),
  combineInstallments: false,
  showBrowser: true,
  verbose: true,
};

(async () => {

  let result;
  try {
    const scraper = createScraper(options);
    scraper.onProgress((companyId, payload) => {
      const name = SCRAPERS[companyId] ? SCRAPERS[companyId].name : companyId;
      console.log(`${name}: ${payload.type}`);
    });
    result = await scraper.scrape(credentials);
  } catch (e) {
    console.error(e);
    throw e;
  }
  console.log(`success: ${result.success}`);
  if (result.success) {
    let numFiles = 0;
    for (let i = 0; i < result.accounts.length; i += 1) {
      const account = result.accounts[i];
      if (account.txns.length) {
        console.log(`exporting ${account.txns.length} transactions for account # ${account.accountNumber}`);
        numFiles += 1;
      } else {
        console.log(`no transactions for account # ${account.accountNumber}`);
      }
    }

    console.log(`${numFiles} csv files saved`);
  } else {
    console.log(`error type: ${result.errorType}`);
    console.log('error:', result.errorMessage);
  }
})();