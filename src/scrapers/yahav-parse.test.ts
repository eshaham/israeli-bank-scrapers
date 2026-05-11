import { parseYahavTransactionRowCells, YAHAV_DATE_CELL_RE } from './yahav-parse';
import { TransactionStatuses } from '../transactions';

describe('parseYahavTransactionRowCells', () => {
  test('maps classic order: date, ref, desc, debit, credit', () => {
    const row = parseYahavTransactionRowCells(['01/03/2026', '123456', 'משכורת', '0.00', '5,000.00']);
    expect(row).toEqual({
      date: '01/03/2026',
      reference: '123456',
      description: 'משכורת',
      debit: '0.00',
      credit: '5,000.00',
      memo: '',
      status: TransactionStatuses.Completed,
    });
  });

  test('with trailing balance column picks debit/credit before balance', () => {
    const row = parseYahavTransactionRowCells([
      '11/05/2026',
      '999888',
      'כרטיסי אשראי',
      '1,234.56',
      '0.00',
      '12,345.67',
    ]);
    expect(row?.date).toBe('11/05/2026');
    expect(row?.reference).toBe('999888');
    expect(row?.debit).toBe('1,234.56');
    expect(row?.credit).toBe('0.00');
  });

  test('description before reference still resolves reference by digits', () => {
    const row = parseYahavTransactionRowCells(['05/05/2026', 'תיאור ארוך', '888777', '100.00', '0.00']);
    expect(row?.reference).toBe('888777');
    expect(row?.description).toBe('תיאור ארוך');
  });

  test('returns null when no date cell', () => {
    expect(parseYahavTransactionRowCells(['foo', '0.00', '1.00', 'x'])).toBeNull();
  });

  test('returns null when fewer than two amount columns', () => {
    expect(parseYahavTransactionRowCells(['01/01/2026', 'ref', 'only one 10.00'])).toBeNull();
  });
});

describe('YAHAV_DATE_CELL_RE', () => {
  test('accepts single-digit day/month', () => {
    expect(YAHAV_DATE_CELL_RE.test('1/3/2026')).toBe(true);
    expect(YAHAV_DATE_CELL_RE.test('01/03/2026')).toBe(true);
  });
});
