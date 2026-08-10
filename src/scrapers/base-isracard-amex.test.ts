import { parseCardListBalances } from './base-isracard-amex';

describe('parseCardListBalances', () => {
  test('parses card balance, balance date, and credit frame from the card-list page', () => {
    const balances = parseCardListBalances(`
      עבור כרטיס שמסתיים ב7392
      ניצלת עד כה 9,564.99 מתוך מסגרת האשראי 15,500 נכון לתאריך 10/08/2026
    `);

    expect(balances.get('7392')).toEqual({
      balance: -9564.99,
      balanceDate: '2026-08-10T00:00:00',
      cardFrame: 15500,
    });
  });

  test('skips card sections without a complete balance', () => {
    const balances = parseCardListBalances('עבור כרטיס שמסתיים ב7392');

    expect(balances.size).toBe(0);
  });

  test('derives an Isracard card balance from its credit frame and remaining credit', () => {
    const balances = parseCardListBalances(`
      מסטרקארד
      7392
      ₪9,564.99 לחיוב ב-10.08
      מסגרת: ₪15,500
      נותר לניצול: ₪5,935.01
    `);

    expect(balances.get('7392')).toEqual({
      balance: -9564.99,
      cardFrame: 15500,
    });
  });
});
