import moment from 'moment';
import { INSTALLMENTS_TXN_TYPE } from '../constants';

function isNonInitialInstallmentTransaction(txn) {
  return txn.type === INSTALLMENTS_TXN_TYPE && txn.installments && txn.installments.number > 1;
}

export function fixInstallments(txns) {
  return txns.map((txn) => {
    const clonedTxn = Object.assign({}, txn);
    if (isNonInitialInstallmentTransaction(clonedTxn)) {
      const dateMoment = moment(clonedTxn.date);
      const actualDateMoment = dateMoment.add(clonedTxn.installments.number - 1, 'month');
      clonedTxn.date = actualDateMoment.toDate();
    }
    return clonedTxn;
  });
}

export function sortTransactionsByDate(txns) {
  const cloned = Array.from(txns);
  cloned.sort((txn1, txn2) => {
    if (txn1.date.getTime() === txn2.date.getTime()) {
      return 0;
    }
    return txn1.date < txn2.date ? -1 : 1;
  });

  return cloned;
}

export function filterOldTransactions(txns, startMoment, combineInstallments) {
  return txns.filter((txn) => {
    return startMoment.isSameOrBefore(txn.date) &&
      (!combineInstallments || !isNonInitialInstallmentTransaction(txn));
  });
}
