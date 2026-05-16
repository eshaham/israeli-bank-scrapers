import moment from 'moment';
import { buildYahavCoverageDiagnostics } from './yahav';
import { TransactionStatuses, TransactionTypes, type TransactionsAccount } from '../transactions';

function makeAccount(txnDates: string[]): TransactionsAccount {
  return {
    accountNumber: '136-005446',
    txns: txnDates.map((date, i) => ({
      type: TransactionTypes.Normal,
      date: moment(date, 'YYYY-MM-DD').toISOString(),
      processedDate: moment(date, 'YYYY-MM-DD').toISOString(),
      originalAmount: 100 + i,
      originalCurrency: 'ILS',
      chargedAmount: 100 + i,
      description: `txn-${i}`,
      status: TransactionStatuses.Completed,
    })),
  };
}

describe('buildYahavCoverageDiagnostics', () => {
  test('marks suspicious coverage when min date is far after requested start', () => {
    const requestedStart = moment('2026-04-25', 'YYYY-MM-DD', true);
    const accounts: TransactionsAccount[] = [makeAccount(['2026-05-09', '2026-05-10', '2026-05-13'])];

    const result = buildYahavCoverageDiagnostics(accounts, requestedStart, 5);

    expect(result.requestedStartDate).toBe('2026-04-25');
    expect(result.minTxnDate).toBe('2026-05-09');
    expect(result.maxTxnDate).toBe('2026-05-13');
    expect(result.txnsCount).toBe(3);
    expect(result.coverageGapDays).toBeGreaterThanOrEqual(14);
    expect(result.suspiciousCoverage).toBeTruthy();
  });

  test('does not mark suspicious coverage when dates cover requested start', () => {
    const requestedStart = moment('2026-04-25', 'YYYY-MM-DD', true);
    const accounts: TransactionsAccount[] = [makeAccount(['2026-04-25', '2026-05-01', '2026-05-13'])];

    const result = buildYahavCoverageDiagnostics(accounts, requestedStart, 5);

    expect(result.minTxnDate).toBe('2026-04-25');
    expect(result.maxTxnDate).toBe('2026-05-13');
    expect(result.coverageGapDays).toBe(0);
    expect(result.suspiciousCoverage).toBeFalsy();
  });
});
