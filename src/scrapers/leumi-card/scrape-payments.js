import createGeneralError from '../../helpers/errors';
import { mapCardsByMonths, extractPayments } from './helpers/accounts';

async function scrapePayments(page, options) {
  try {
    const cardRowsMapping = await mapCardsByMonths(page, options, extractPayments);

    const accounts = Object.entries(cardRowsMapping).map(([accountName, payments]) => {
      return {
        accountNumber: accountName,
        payments,
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

export default scrapePayments;
