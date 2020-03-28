import { getActiveAccountsInfo } from '../adapter-helpers/accounts';
import {
  getTransactionsUrl,
  fetchPoalimXSRFWithinPage,
  convertTransaction,
} from '../adapter-helpers/transactions';
import { getAPISiteUrl } from '../adapter-helpers/api';
import { validateInThePastYear } from '../../helpers/dates';
import { Transaction } from '../../types';


async function getAccountTransactions(page, accountInfo, startDate, apiSiteUrl) {
  const txnsUrl = getTransactionsUrl(page, {
    apiSiteUrl,
    accountToken: accountInfo.accountToken,
    startDate,
  });

  const txnsResult = await fetchPoalimXSRFWithinPage(page, txnsUrl);

  let txns: Transaction[] = [];
  if (txnsResult) {
    txns = txnsResult.transactions.map(((transaction) => convertTransaction(transaction)));
  }

  return txns;
}

export function scrapeTransactionsAdapter(options) {
  return {
    name: 'scrapeTransactions(hapoalim)',
    validate: (context) => {
      const result: string[] = [];

      const [startDateValidationMessage] = validateInThePastYear(options.startDate);

      if (startDateValidationMessage) {
        result.push(startDateValidationMessage);
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
      const accounts: { accountNumber: string; txns: Transaction[]}[]= [];

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
