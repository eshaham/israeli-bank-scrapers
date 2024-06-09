import _ from 'lodash';
// eslint-disable-next-line import/named
import moment, { Moment } from 'moment';
import {
  Transaction, TransactionTypes,
} from '../transactions';

function isNormalTransaction(txn: any): boolean {
  return txn && txn.type === TransactionTypes.Normal;
}

function isInstallmentTransaction(txn: any): boolean {
  return txn && txn.type === TransactionTypes.Installments;
}

function isNonInitialInstallmentTransaction(txn: Transaction): boolean {
  return isInstallmentTransaction(txn) && !!txn.installments && txn.installments.number > 1;
}

function isInitialInstallmentTransaction(txn: Transaction): boolean {
  return isInstallmentTransaction(txn) && !!txn.installments && txn.installments.number === 1;
}

export function fixInstallments(txns: Transaction[]): Transaction[] {
  return txns.map((txn: Transaction) => {
    const clonedTxn = { ...txn };

    if (isInstallmentTransaction(clonedTxn) && isNonInitialInstallmentTransaction(clonedTxn) &&
      clonedTxn.installments) {
      const dateMoment = moment(clonedTxn.date);
      const actualDateMoment = dateMoment.add(clonedTxn.installments.number - 1, 'month');
      clonedTxn.date = actualDateMoment.toISOString();
    }
    return clonedTxn;
  });
}

export function sortTransactionsByDate(txns: Transaction[]) {
  return _.sortBy(txns, ['date']);
}

export function filterOldTransactions(txns: Transaction[],
  startMoment: Moment, combineInstallments: boolean) {
  return txns.filter((txn) => {
    const combineNeededAndInitialOrNormal =
      combineInstallments && (isNormalTransaction(txn) || isInitialInstallmentTransaction(txn));
    return (!combineInstallments && startMoment.isSameOrBefore(txn.date)) ||
           (combineNeededAndInitialOrNormal && startMoment.isSameOrBefore(txn.date));
  });
}
