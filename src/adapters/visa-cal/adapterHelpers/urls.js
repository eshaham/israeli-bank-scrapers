import moment from 'moment';
import buildUrl from 'build-url';
import { BASE_URL } from '../definitions';

export function getBankDebitsUrl(accountId, startDate) {
  const toDate = moment().add(2, 'months');
  const fromDate = startDate;

  return buildUrl(BASE_URL, {
    path: `CalBankDebits/${accountId}`,
    queryParams: {
      DebitLevel: 'A',
      DebitType: '2',
      FromMonth: (fromDate.month() + 1).toString().padStart(2, '0'),
      FromYear: fromDate.year().toString(),
      ToMonth: (toDate.month() + 1).toString().padStart(2, '0'),
      ToYear: toDate.year().toString(),
    },
  });
}

export function getTransactionsUrl(cardId, debitDate) {
  return buildUrl(BASE_URL, {
    path: `CalTransactions/${cardId}`,
    queryParams: {
      ToDate: debitDate,
      FromDate: debitDate,
    },
  });
}
