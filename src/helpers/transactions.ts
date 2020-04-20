import moment, { Moment } from 'moment';
import _ from 'lodash';
import { CreditCardTransaction, Transaction, TransactionTypes } from '../types';

function isNormalTransaction(txn: Transaction) {
  return txn.type === TransactionTypes.Normal;
}

function isInstallmentTransaction(txn: any): txn is CreditCardTransaction {
  return txn && txn.type === TransactionTypes.Installments;
}

function isNonInitialInstallmentTransaction(txn: Transaction) {
  return isInstallmentTransaction(txn) && txn.installments && txn.installments.number > 1;
}

function isInitialInstallmentTransaction(txn: Transaction) {
  return isInstallmentTransaction(txn) && txn.installments && txn.installments.number === 1;
}

export function fixInstallments(txns: Transaction[]): Transaction[] {
  return txns.map((txn) => {
    const clonedTxn = { ...txn };
    if (isInstallmentTransaction(clonedTxn) && isNonInitialInstallmentTransaction(clonedTxn)) {
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
