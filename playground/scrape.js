import json2csv from 'json2csv';
import moment from 'moment';

import { CONFIG_FOLDER } from './definitions';
import { writeFile, readJsonFile } from './helpers/files';
import { decryptCredentials } from './helpers/credentials';
import { SCRAPERS, createScraper } from '../src';
import { readSettingsFile } from './helpers/settings';

async function exportAccountData(scraperId, account, saveLocation) {
  const data = account.txns.map((txn) => {
    return Object.assign(txn, {
      date: moment(txn.date).format('DD/MM/YYYY'),
      processedDate: moment(txn.processedDate).format('DD/MM/YYYY'),
    });
  });
  const filename = account.accountNumber.replace('/', '_');

  const csv = json2csv.parse(data, { withBOM: true });
  await writeFile(`${saveLocation}/${SCRAPERS[scraperId].name} (${filename})-data.csv`, csv);
  await writeFile(`${saveLocation}/${SCRAPERS[scraperId].name} (${filename}).json`, JSON.stringify(account, null, 4));
}

(async function scrape() {
  const settings = await readSettingsFile();
  const {
    scraperId,
    combineInstallments,
    startDate,
    saveLocation,
  } = settings;

  if (scraperId) {
    const encryptedCredentials = await readJsonFile(`${CONFIG_FOLDER}/${scraperId}.json`);
    if (encryptedCredentials) {
      const credentials = decryptCredentials(encryptedCredentials);
      const options = {
        companyId: scraperId,
        startDate,
        combineInstallments,
        showBrowser: true,
        verbose: false,
      };
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
            await exportAccountData(scraperId, account, saveLocation);
            numFiles += 1;
          } else {
            console.log(`no transactions for account # ${account.accountNumber}`);
          }
        }

        console.log(`${numFiles} account saved under ${saveLocation}`);
      } else {
        console.log(`error type: ${result.errorType}`);
        console.log('error:', result.errorMessage);
      }
    } else {
      console.log(`Partial scraping options provided, you need to do one of the following:
  1. run "npm run setup" and add credentials for '${scraperId}'
  2. run "npm run setup" and change the selected scraper id defined in options
      `);
    }
  } else {
    console.log('Missing scraping options, run "npm run setup" to create scraping credentials & options');
  }
}());
