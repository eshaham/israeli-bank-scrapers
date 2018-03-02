import path from 'path';
import {SCRAPERS, createScraper} from '../src';
import { exportAccountData } from './utils';

export async function scrape(options, credentials){
  try {
    const scraper = createScraper(options);

    scraper.onProgress((companyId, payload) => {
      const name = SCRAPERS[companyId] ? SCRAPERS[companyId].name : companyId;
      console.log(`${name}: ${payload.type}`);
    });

    const result = await scraper.scrape(credentials);

    console.log(`success: ${result.success}`);

    if (result.success) {
      let numFiles = 0;
      for (let i = 0; i < result.accounts.length; i += 1) {
        const account = result.accounts[i];
        if (account.txns.length) {
          console.log(`exporting ${account.txns.length} transactions for account # ${account.accountNumber}`);
          exportAccountData(options.companyId, account, path.resolve(path.join(__dirname, '../data')));
          numFiles += 1;
        } else {
          console.log(`no transactions for account # ${account.accountNumber}`);
        }
      }

      console.log(`${numFiles} csv files saved under '.tmp/data'`);
    } else {
      console.log(`error type: ${result.errorType}`);
      console.log('error:', result.errorMessage);
    }
  } catch (e) {
    console.error(e);
    throw e;
  }
}