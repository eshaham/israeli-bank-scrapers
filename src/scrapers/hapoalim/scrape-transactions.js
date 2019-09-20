import createGeneralError from '../../helpers/errors';
import { getActiveAccountsInfo } from './helpers/accounts';
import {
  getTransactionsUrl,
  fetchPoalimXSRFWithinPage,
  convertTransaction,
} from './helpers/transactions';
import { getAPISiteUrl } from './helpers/utils';


async function getAccountTransactions(page, accountInfo, startDate, apiSiteUrl) {
  const txnsUrl = getTransactionsUrl(page, {
    apiSiteUrl,
    accountToken: accountInfo.accountToken,
    startDate,
  });

  const txnsResult = await fetchPoalimXSRFWithinPage(page, txnsUrl);

  let txns = [];
  if (txnsResult) {
    txns = txnsResult.transactions.map((transaction => convertTransaction(transaction)));
  }

  return txns;
}

/**
 * scrape transactions of bank hapoalim
 * @param options todo
 * @param options.page todo
 * @param options.startDate todo
 * @returns {Promise<{success: boolean, accounts: Array}|{success: boolean, errorType: string, errorMessage: *}>}
 */
export default async function scrapeTransactions(options) {
  try {
    const { page, startDate } = options;

    if (!page || !startDate) {
      return createGeneralError('missing required options');
    }

    const apiSiteUrl = await getAPISiteUrl(page);
    const accountsInfo = await getActiveAccountsInfo(page);
    const accounts = [];

    for (let i = 0; i < accountsInfo.length; i += 1) {
      const accountInfo = accountsInfo[i];
      const transactions = await getAccountTransactions(page, accountInfo, startDate, apiSiteUrl);

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
