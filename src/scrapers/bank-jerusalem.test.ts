import moment from 'moment';
import { SCRAPERS } from '../definitions';
import { exportTransactions, extendAsyncTimeout, getTestsConfig, maybeTestCompanyAPI } from '../tests/tests-utils';
import BankJerusalemScraper, {
  convertDepositCards,
  convertTransactions,
  newestBalance,
  parseAccountNumber,
  parseAmount,
  parseDate,
} from './bank-jerusalem';
import { LoginResults } from './base-scraper-with-browser';

const COMPANY_ID = 'bankJerusalem'; // TODO this property should be hard-coded in the provider
const testsConfig = getTestsConfig();

describe('Bank of Jerusalem parsing', () => {
  test('parses amounts as the bank prints them', () => {
    expect(parseAmount('1,234.56')).toBe(1234.56);
    expect(parseAmount('₪ -1,234.56')).toBe(-1234.56);
    expect(parseAmount('1,234.56-')).toBe(-1234.56);
    expect(parseAmount('(500.00)')).toBe(-500);
    expect(parseAmount('0.00-')).toBe(0);
    expect(parseAmount('')).toBeNull();
  });

  test('parses dates as the bank prints them', () => {
    expect(parseDate('13/10/2026')?.format('YYYY-MM-DD')).toBe('2026-10-13');
    expect(parseDate('13.10.26')?.format('YYYY-MM-DD')).toBe('2026-10-13');
    expect(parseDate('תאריך')).toBeNull();
  });

  test('converts the account page table by its headings, from the start date on', () => {
    const table = {
      headers: ['תאריך', 'תאריך ערך', 'תיאור', 'אסמכתא', 'סכום', 'יתרה'],
      rows: [
        ['01/09/2026', '01/09/2026', 'משכורת', '99001', '10,000.00', '12,000.00'],
        ['05/10/2026', '06/10/2026', 'העברה', '12-345', '-250.50', '11,749.50'],
        ['20/08/2026', '20/08/2026', 'ישן', '1', '-1.00', '2,000.00'],
        ['סה"כ', '', '', '', '9,749.50', ''],
      ],
    };

    const txns = convertTransactions(table, moment('2026-09-01'));

    expect(txns).toHaveLength(2);
    expect(txns[0]).toMatchObject({
      identifier: 99001,
      description: 'משכורת',
      originalAmount: 10000,
      chargedAmount: 10000,
      originalCurrency: 'ILS',
    });
    expect(moment(txns[0].date).format('YYYY-MM-DD')).toBe('2026-09-01');
    expect(txns[1]).toMatchObject({ identifier: 12345, description: 'העברה', chargedAmount: -250.5 });
    expect(moment(txns[1].date).format('YYYY-MM-DD')).toBe('2026-10-05');
  });

  test('returns no transactions when the table has no date or amount heading', () => {
    expect(convertTransactions({ headers: ['א', 'ב'], rows: [['01/09/2026', '1.00']] }, moment('2026-01-01'))).toEqual(
      [],
    );
  });

  test('takes the balance after the newest transaction, the last row on its day', () => {
    const table = {
      headers: ['תאריך', 'תיאור', 'סכום', 'יתרה'],
      rows: [
        ['30/09/2026', 'א', '-10.00', '1,000.00'],
        ['05/10/2026', 'ב', '-20.00', '980.00'],
        ['05/10/2026', 'ג', '-30.00', '950.00'],
        ['01/10/2026', 'ד', '5.00', '1,005.00'],
      ],
    };

    expect(newestBalance(table)).toBe(950);
    expect(newestBalance({ headers: ['תאריך', 'סכום'], rows: [['05/10/2026', '1.00']] })).toBeNull();
  });

  test('reads the account number from the line under the page title', () => {
    expect(parseAccountNumber('חשבון 012-345678901 | ₪ | עובר ושב')).toBe('012-345678901');
    expect(parseAccountNumber('עובר ושב')).toBeNull();
  });

  test('converts each deposit card into a savings account', () => {
    const accounts = convertDepositCards('012-345678901', [
      {
        name: 'שמש בריבוע (12345)',
        number: "פקדון מס' 1234567",
        fields: [
          ['סכום מקורי', '10,000.00 ₪'],
          ['יתרה משוערכת (ליום 13.10.2026)', '10,123.45 ₪'],
          ['תאריך סיום', '01.09.2027'],
        ],
      },
      { name: 'פיקדון', number: "פקדון מס' 7654321", fields: [['סכום מקורי', '5,000.00 ₪']] },
    ]);

    expect(accounts).toEqual([
      { accountNumber: '012-345678901-1234567', savingsAccount: true, balance: 10123.45, currency: 'ILS', txns: [] },
      { accountNumber: '012-345678901-7654321', savingsAccount: true, balance: 5000, currency: 'ILS', txns: [] },
    ]);
  });
});

describe('Bank of Jerusalem scraper', () => {
  beforeAll(() => {
    extendAsyncTimeout(); // The default timeout is 5 seconds per async test, this function extends the timeout value
  });

  test('should expose login fields in scrapers constant', () => {
    expect(SCRAPERS.bankJerusalem).toBeDefined();
    expect(SCRAPERS.bankJerusalem.loginFields).toContain('username');
    expect(SCRAPERS.bankJerusalem.loginFields).toContain('password');
  });

  maybeTestCompanyAPI(COMPANY_ID, config => config.companyAPI.invalidPassword)(
    'should fail on invalid user/password"',
    async () => {
      const options = {
        ...testsConfig.options,
        companyId: COMPANY_ID,
      };

      const scraper = new BankJerusalemScraper(options);

      const result = await scraper.scrape({ username: 'e10s12', password: '3f3ss3d' });

      expect(result).toBeDefined();
      expect(result.success).toBeFalsy();
      expect(result.errorType).toBe(LoginResults.InvalidPassword);
    },
  );

  maybeTestCompanyAPI(COMPANY_ID)('should scrape transactions"', async () => {
    const options = {
      ...testsConfig.options,
      companyId: COMPANY_ID,
    };

    const scraper = new BankJerusalemScraper(options);
    const result = await scraper.scrape(testsConfig.credentials.bankJerusalem);
    expect(result).toBeDefined();
    const error = `${result.errorType || ''} ${result.errorMessage || ''}`.trim();
    expect(error).toBe('');
    expect(result.success).toBeTruthy();

    exportTransactions(COMPANY_ID, result.accounts || []);
  });
});
