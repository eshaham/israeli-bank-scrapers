import moment from 'moment';
import { type ScraperOptions } from '../interface';
import {
  getForeignTransactionAmount,
  mapForeignCurrency,
  mapForeignTransaction,
  parseForeignAmount,
} from './leumi-forex';

describe('mapForeignCurrency', () => {
  test('matches a real double-quote label observed on the live page', () => {
    // The live page renders a genuine double quote (as opposed to the apostrophe form
    // `דולר ארה''ב` this table was originally seeded with), which is why matching
    // strips quote characters before comparing.
    expect(mapForeignCurrency('דולר ארה"ב')).toBe('USD');
  });

  test('matches the apostrophe form of the same label', () => {
    expect(mapForeignCurrency("דולר ארה''ב")).toBe('USD');
  });

  test('matches the longer label instead of the shorter prefix it contains', () => {
    // `דולר קנדי` contains `דולר`, so the lookup must prefer the longest matching key.
    expect(mapForeignCurrency('דולר קנדי')).toBe('CAD');
  });

  test('matches euro under both spellings used across Leumi pages', () => {
    expect(mapForeignCurrency('אירו')).toBe('EUR');
    expect(mapForeignCurrency('יורו')).toBe('EUR');
  });

  test('trims surrounding whitespace before matching', () => {
    expect(mapForeignCurrency('  דולר  ')).toBe('USD');
  });

  test('returns undefined for an unrecognised label rather than defaulting to shekels', () => {
    expect(mapForeignCurrency('מטבע לא ידוע')).toBeUndefined();
  });

  test('returns undefined for an empty label', () => {
    expect(mapForeignCurrency('')).toBeUndefined();
  });
});

describe('parseForeignAmount', () => {
  test('parses a plain amount', () => {
    expect(parseForeignAmount('1990')).toBe(1990);
  });

  test('strips thousands separators', () => {
    expect(parseForeignAmount('29,990.50')).toBe(29990.5);
  });

  test('returns 0 for an empty cell', () => {
    expect(parseForeignAmount('')).toBe(0);
  });

  test('returns 0 for text with no digits', () => {
    expect(parseForeignAmount('N/A')).toBe(0);
  });
});

describe('getForeignTransactionAmount', () => {
  test('returns a positive amount when only the credit column is populated', () => {
    expect(getForeignTransactionAmount('', '29,990')).toBe(29990);
  });

  test('returns a negative amount when only the debit column is populated', () => {
    expect(getForeignTransactionAmount('28,000', '')).toBe(-28000);
  });

  test('prefers the credit column when both are somehow populated', () => {
    expect(getForeignTransactionAmount('100', '200')).toBe(200);
  });
});

describe('mapForeignTransaction', () => {
  // Real row shape observed on a live USD forex account: an incoming transfer.
  const creditRow = ['18/06/26', 'העברה במט"ח', 'REF123', '', '29,990', '31,980'];
  // Real row shape observed on the same account: an outgoing transfer.
  const debitRow = ['22/06/26', 'העברת כספים', 'REF456', '28,000', '', '1,990'];

  test('maps a credit row to a positive-amount transaction', () => {
    const transaction = mapForeignTransaction(creditRow, 'USD', undefined);

    expect(transaction.originalAmount).toBe(29990);
    expect(transaction.chargedAmount).toBe(29990);
    expect(transaction.originalCurrency).toBe('USD');
    expect(transaction.chargedCurrency).toBe('USD');
    expect(transaction.description).toBe('העברה במט"ח');
    expect(transaction.identifier).toBe('REF123');
    expect(Number.isNaN(transaction.originalAmount)).toBe(false);
  });

  test('maps a debit row to a negative-amount transaction', () => {
    const transaction = mapForeignTransaction(debitRow, 'USD', undefined);

    expect(transaction.originalAmount).toBe(-28000);
    expect(transaction.chargedAmount).toBe(-28000);
  });

  test('parses the DD/MM/YY date format used on the foreign currency page', () => {
    const transaction = mapForeignTransaction(creditRow, 'USD', undefined);

    // Compared against moment's own parsing (rather than a hardcoded ISO string) so the
    // assertion does not depend on the machine's local timezone.
    const expectedDate = moment('18/06/26', 'DD/MM/YY').milliseconds(0).toISOString();
    expect(transaction.date).toBe(expectedDate);
  });

  test('omits identifier when the reference column is empty', () => {
    const rowWithoutReference = ['18/06/26', 'עמלה', '', '', '10', '1,990'];
    const transaction = mapForeignTransaction(rowWithoutReference, 'USD', undefined);

    expect(transaction.identifier).toBeUndefined();
  });

  test('includes the raw transaction only when requested', () => {
    const withRaw = mapForeignTransaction(creditRow, 'USD', { includeRawTransaction: true } as ScraperOptions);
    const withoutRaw = mapForeignTransaction(creditRow, 'USD', { includeRawTransaction: false } as ScraperOptions);

    expect(withRaw.rawTransaction).toBeDefined();
    expect(withoutRaw.rawTransaction).toBeUndefined();
  });
});
