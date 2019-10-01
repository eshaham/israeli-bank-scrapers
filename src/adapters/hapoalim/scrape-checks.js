import path from 'path';
import { getActiveAccountsInfo } from './adapterHelpers/accounts';
import {
  getTransactionsUrl,
  fetchPoalimXSRFWithinPage,
  fetchGetPoalimXSRFWithinPage,
  convertTransaction,
} from './adapterHelpers/transactions';
import { getAPISiteUrl } from './adapterHelpers/api';
import { BASE_URL } from './definitions';
import validateStartDate from './adapterHelpers/scraping';

async function getAccountTransactions(page, accountInfo, startDate, apiSiteUrl) {
  const txnsUrl = getTransactionsUrl(page, {
    apiSiteUrl,
    accountToken: accountInfo.accountToken,
    filterToken: '012;009;1;008;',
    startDate,
  });

  const txnsResult = await fetchPoalimXSRFWithinPage(page, txnsUrl);

  const txns = [];
  if (txnsResult) {
    for (let i = 0; i < txnsResult.transactions.length; i += 1) {
      const rawTransaction = txnsResult.transactions[i];

      if (!rawTransaction.pfmDetails) {
        continue;
      }

      const transactionsDetailsUrl = `${BASE_URL}${rawTransaction.details}&accountId=${accountInfo.accountToken}&lang=he`;

      const transactionDetails = await fetchGetPoalimXSRFWithinPage(page, transactionsDetailsUrl);

      if (!transactionDetails.list || !transactionDetails.list.length) {
        continue;
      }

      const transaction = convertTransaction(rawTransaction);
      const { imageFrontLink } = transactionDetails.list[0];
      transaction.checkFrontUrl = `${BASE_URL}${imageFrontLink}`;
      txns.push(transaction);
    }
  }

  return txns;
}

async function downloadCheckImages(page, txns, imagesPath) {
  for (let i = 0; i < txns.length; i += 1) {
    const transaction = txns[i];
    const imageFileName = transaction.checkFrontUrl.match(/.*\/(.*?[.]png)/)[1].replace(' ', '');

    if (!imageFileName) {
      throw new Error('failed to extract a check image name from check front url');
    }

    await page.goto(transaction.checkFrontUrl);

    delete transaction.checkFrontUrl;
    transaction.checkFrontPath = path.resolve(imagesPath, imageFileName);

    const image = await page.$('img');

    await image.screenshot({
      path: transaction.checkFrontPath,
      omitBackground: true,
    });
  }
}

function scrapeChecksAdapter(options) {
  return {
    name: 'scrapeChecks(hapoalim)',
    validate: (context) => {
      const result = [];

      const [startDateValidationMessage] = validateStartDate(options.startDate);

      if (startDateValidationMessage) {
        result.push(startDateValidationMessage);
      }

      if (!options.imagesPath) {
        result.push('expected imagesPath to be provided by options');
      }

      if (!context.hasSessionData('puppeteer.page')) {
        result.push('expected puppeteer page to be provided by prior adapter');
      }

      return result;
    },
    action: async (context) => {
      const page = context.getSessionData('puppeteer.page');
      const { startDate, imagesPath } = options;

      const apiSiteUrl = await getAPISiteUrl(page);
      const accountsInfo = await getActiveAccountsInfo(page);
      const accounts = [];

      for (let i = 0; i < accountsInfo.length; i += 1) {
        const accountInfo = accountsInfo[i];
        const txns = await getAccountTransactions(page, accountInfo, startDate, apiSiteUrl);

        await downloadCheckImages(page, txns, imagesPath);

        accounts.push({
          accountNumber: accountInfo.accountNumber,
          txns,
        });
      }

      return {
        data: {
          hapoalim: {
            checks: {
              accounts,
            },
          },
        },
      };
    },
  };
}

export default scrapeChecksAdapter;
