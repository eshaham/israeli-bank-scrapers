import path from 'path';
import createGeneralError from '../../helpers/errors';
import { getActiveAccountsInfo } from './helpers/accounts';
import {
  getTransactionsUrl,
  fetchPoalimXSRFWithinPage,
  fetchGetPoalimXSRFWithinPage,
  convertTransaction,
} from './helpers/transactions';
import { getAPISiteUrl } from './helpers/utils';
import { BASE_URL } from './definitions';

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
    const imageFileName = transaction.checkFrontUrl.match(/.*\/(.*?[.]png)/)[1];

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

export default async function scrapeChecks(options) {
  try {
    const { page, startDate, imagesPath } = options;

    if (!page || !startDate || !imagesPath) {
      return createGeneralError('missing required options');
    }
    const apiSiteUrl = await getAPISiteUrl(page);
    const accountsInfo = await getActiveAccountsInfo(page);
    const accounts = [];

    for (let i = 0; i < accountsInfo.length; i += 1) {
      const accountInfo = accountsInfo[i];
      const transactions = await getAccountTransactions(page, accountInfo, startDate, apiSiteUrl);

      await downloadCheckImages(page, transactions, imagesPath);

      accounts.push({
        accountNumber: accountInfo.accountNumber,
        transactions,
      });
    }

    return {
      success: true,
      accounts,
    };
  } catch (error) {
    return createGeneralError(error.message);
  }
}
