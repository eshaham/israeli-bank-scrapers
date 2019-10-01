import { getActiveAccountsInfo } from './adapterHelpers/accounts';
import {
  getTransactionsUrl,
  fetchPoalimXSRFWithinPage,
  convertTransaction,
} from './adapterHelpers/transactions';
import { getAPISiteUrl } from './adapterHelpers/utils';


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

function scrapeTransactionsAdapter(options) {
  return {
    name: 'scrapeTransactions(hapoalim)',
    validate: (context) => {
      const result = [];

      if (!options.startDate) {
        result.push('expected startDate to be provided by options');
      }

      if (!context.hasSessionData('puppeteer.page')) {
        result.push('expected puppeteer page to be provided by prior adapter');
      }

      return result;
    },
    action: async (context) => {
      const page = context.getSessionData('puppeteer.page');
      const { startDate } = options;

      const apiSiteUrl = await getAPISiteUrl(page);
      const accountsInfo = await getActiveAccountsInfo(page);
      const accounts = [];

      for (let i = 0; i < accountsInfo.length; i += 1) {
        const accountInfo = accountsInfo[i];
        const txns = await getAccountTransactions(page, accountInfo, startDate, apiSiteUrl);

        accounts.push({
          accountNumber: accountInfo.accountNumber,
          txns,
        });
      }

      return {
        data: {
          hapoalim: {
            transactions: {
              accounts,
            },
          },
        },
      };
    },
  };
}

export default scrapeTransactionsAdapter;
