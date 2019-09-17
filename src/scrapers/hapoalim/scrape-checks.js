import fs from 'fs';
import path from 'path';
import createGeneralError from '../../helpers/errors';
import getAccounts from './helpers/get-accounts';
import {
  getTransactionsUrl,
  fetchPoalimXSRFWithinPage,
  fetchGetPoalimXSRFWithinPage,
  convertTransaction,
} from './helpers/transactions';
import { getAPISiteUrl } from './helpers/utils';
import { BASE_URL } from './definitions';

export default async function scrapeChecks(context) {
  try {
    const { page, userOptions, imagesPath } = context;

    if (!page || !userOptions || !imagesPath) {
      throw new Error('missing required options');
    }
    const apiSiteUrl = await getAPISiteUrl(page);
    const allAccountsInfo = await getAccounts(page);
    const activeAccountsInfo = allAccountsInfo.filter(item => !item.isClosed);
    const accounts = [];

    for (let i = 0; i < activeAccountsInfo.length; i += 1) {
      const accountInfo = activeAccountsInfo[i];

      const txnsUrl = getTransactionsUrl(page, {
        apiSiteUrl,
        accountToken: accountInfo.accountToken,
        filterToken: '012;009;1;008;',
        startDate: userOptions.startDate,
      });

      const txnsResult = await fetchPoalimXSRFWithinPage(page, txnsUrl);

      const txns = [];
      if (txnsResult) {
        // remove nested for
        for (let t = 0; t < txnsResult.transactions.length; t++) {
          const rawTransaction = txnsResult.transactions[t];

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

      // todo es persist original url
      for (let t = 0; t < txns.length; t++) {
        const transaction = txns[t];
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

      // todo es recover original url

      accounts.push({
        accountNumber: accountInfo.accountNumber,
        txns,
      });
    }

    return {
      success: true,
      accounts,
    };
  } catch (error) {
    return createGeneralError();
  }
}
