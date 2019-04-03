import moment from 'moment';
import createGeneralError from '../../helpers/errors';
import { mapCurrentPageCards, extractPayments, getTransactionsUrl } from './helpers/accounts';
import { navigateTo } from '../../helpers/navigation';

async function scrapeSummary(page) {
  try {
    const nextMonthUrl = getTransactionsUrl();
    await navigateTo(page, nextMonthUrl);
    const cardRowsMapping = await mapCurrentPageCards(page, extractPayments);

    const accounts = Object.entries(cardRowsMapping).map(([accountName, rows]) => {
      const balance = rows.filter(row => moment(row.date).isAfter(moment().startOf('day')))
        .reduce((acc, row) => acc + row.amount, 0);

      return {
        accountNumber: accountName,
        summary: {
          balance,
          pendingBalance: balance,
        },
      };
    });

    return {
      success: true,
      accounts,
    };
  } catch (error) {
    return createGeneralError();
  }
}

export default scrapeSummary;
