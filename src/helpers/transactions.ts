import _ from 'lodash';
import moment, { type Moment } from 'moment';
import { TransactionTypes, type Transaction } from '../transactions';

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

    if (
      isInstallmentTransaction(clonedTxn) &&
      isNonInitialInstallmentTransaction(clonedTxn) &&
      clonedTxn.installments
    ) {
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

export function filterOldTransactions(txns: Transaction[], startMoment: Moment, combineInstallments: boolean) {
  return txns.filter(txn => {
    const combineNeededAndInitialOrNormal =
      combineInstallments && (isNormalTransaction(txn) || isInitialInstallmentTransaction(txn));
    return (
      (!combineInstallments && startMoment.isSameOrBefore(txn.date)) ||
      (combineNeededAndInitialOrNormal && startMoment.isSameOrBefore(txn.date))
    );
  });
}

/**
 * Recursively remove null, undefined, empty string, and empty array values from objects and arrays.
 */
function removeEmptyValues<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(item => removeEmptyValues(item)) as unknown as T;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => {
        if (v === null || v === undefined || v === '') return false;
        if (Array.isArray(v) && v.length === 0) return false;
        return true;
      })
      .map(([k, v]) => [k, removeEmptyValues(v)]);

    return Object.fromEntries(entries) as unknown as T;
  }

  return value;
}

/**
 * Add/extend raw transaction data with new raw data.
 * - Cleans the data to remove null/undefined/empty-string keys.
 * - When called with one argument: returns cleaned data (common case for setting new raw transaction).
 * - When called with two arguments and transaction has rawTransaction: extends existing raw transaction.
 */
export function getRawTransaction(data: unknown, transaction?: { rawTransaction?: unknown }): unknown {
  const current = transaction?.rawTransaction;
  const cleaned = removeEmptyValues(data);

  if (!current) {
    return cleaned;
  }

  if (Array.isArray(current)) {
    return [...current, cleaned];
  }

  return [current, cleaned];
}
