import moment from 'moment';
import {
  convertApprovedTransaction,
  convertVoucher,
  getCardBalance,
  getCardBalanceDate,
  getCardFrame,
  getVoucherInstallments,
  type ScrapedApprovedTransaction,
  type ScrapedCard,
  type ScrapedVoucher,
} from './base-isracard-group';
import { type ScraperOptions } from './interface';

describe('getCardBalance', () => {
  test('negates limitUsed (a positive "amount used" becomes a negative balance)', () => {
    const card = { limitData: { limitUsed: '9564.99', creditLimitAmount: '15500' } } as ScrapedCard;

    expect(getCardBalance(card)).toBe(-9564.99);
  });

  test('returns undefined when the card has no limit data', () => {
    expect(getCardBalance({} as ScrapedCard)).toBeUndefined();
  });

  test('returns undefined when limitUsed is not a number', () => {
    const card = { limitData: { limitUsed: 'n/a', creditLimitAmount: '15500' } } as ScrapedCard;

    expect(getCardBalance(card)).toBeUndefined();
  });
});

describe('getCardFrame', () => {
  test('reads the credit limit as a number', () => {
    const card = { limitData: { limitUsed: '9564.99', creditLimitAmount: '15500' } } as ScrapedCard;

    expect(getCardFrame(card)).toBe(15500);
  });

  test('returns undefined when the card has no limit data', () => {
    expect(getCardFrame({} as ScrapedCard)).toBeUndefined();
  });

  test('returns undefined when creditLimitAmount is not a number', () => {
    const card = { limitData: { limitUsed: '9564.99', creditLimitAmount: 'n/a' } } as ScrapedCard;

    expect(getCardFrame(card)).toBeUndefined();
  });
});

describe('getCardBalanceDate', () => {
  test('parses the next billing date', () => {
    const card = { cardChargeNext: { billingDate: '10/08/2026' } } as ScrapedCard;

    expect(getCardBalanceDate(card)).toBe(moment('10/08/2026', 'DD/MM/YYYY').toISOString());
  });

  test('returns undefined when there is no next billing date', () => {
    expect(getCardBalanceDate({} as ScrapedCard)).toBeUndefined();
  });
});

describe('convertApprovedTransaction', () => {
  const txn: ScrapedApprovedTransaction = {
    purchaseDate: '10/08/2026',
    israelTransactionTime: '14:30',
    businessName: '  שופרסל  ',
    originalAmount: 120,
    currencyIso: 'ILS',
    ilsBillingAmount: 120,
    extraDetails: 'פרטים',
    seqConfirmationNumber: 'REF123',
    branchCodeDescription: '  מזון  ',
  };

  test('negates the amount (approvals report a positive charge, not a signed one)', () => {
    const transaction = convertApprovedTransaction(txn);

    expect(transaction.originalAmount).toBe(-120);
    expect(transaction.chargedAmount).toBe(-120);
  });

  test('combines the purchase date and time into one ISO date, used for both date and processedDate', () => {
    const transaction = convertApprovedTransaction(txn);

    const expected = moment('10/08/2026 14:30', 'DD/MM/YYYY HH:mm').toISOString();
    expect(transaction.date).toBe(expected);
    expect(transaction.processedDate).toBe(expected);
  });

  test('trims the business name and category, and is always pending', () => {
    const transaction = convertApprovedTransaction(txn);

    expect(transaction.description).toBe('שופרסל');
    expect(transaction.category).toBe('מזון');
    expect(transaction.status).toBe('pending');
  });

  test('omits category when branchCodeDescription is missing', () => {
    const transaction = convertApprovedTransaction({ ...txn, branchCodeDescription: null });

    expect(transaction.category).toBeUndefined();
  });

  test('includes the raw transaction only when requested', () => {
    const withRaw = convertApprovedTransaction(txn, { includeRawTransaction: true } as ScraperOptions);
    const withoutRaw = convertApprovedTransaction(txn, { includeRawTransaction: false } as ScraperOptions);

    expect(withRaw.rawTransaction).toBeDefined();
    expect(withoutRaw.rawTransaction).toBeUndefined();
  });
});

describe('getVoucherInstallments', () => {
  test('returns the current/total pair when both are set', () => {
    const voucher = { currentInstallmentNum: 2, numberOfInstallment: 4 } as ScrapedVoucher;

    expect(getVoucherInstallments(voucher)).toEqual({ number: 2, total: 4 });
  });

  test('returns undefined when numberOfInstallment is missing', () => {
    const voucher = { currentInstallmentNum: 2, numberOfInstallment: null } as ScrapedVoucher;

    expect(getVoucherInstallments(voucher)).toBeUndefined();
  });

  test('returns undefined when currentInstallmentNum is missing', () => {
    const voucher = { currentInstallmentNum: null, numberOfInstallment: 4 } as ScrapedVoucher;

    expect(getVoucherInstallments(voucher)).toBeUndefined();
  });
});

describe('convertVoucher', () => {
  const voucher: ScrapedVoucher = {
    purchaseDate: '10/08/2026',
    purchaseTime: '09:15:00',
    businessName: '  Amazon  ',
    originalAmount: 300,
    originalCurrencyIso: 'USD',
    billingAmount: 1100,
    moreInfo: '  memo  ',
    seqVoucherNumber: 'V123',
    currentInstallmentNum: null,
    numberOfInstallment: null,
    transactionDescription: '  קניות  ',
  };
  const processedDateIso = moment('15/09/2026', 'DD/MM/YYYY').toISOString();

  test('negates the amount, and is always completed', () => {
    const transaction = convertVoucher(voucher, processedDateIso);

    expect(transaction.originalAmount).toBe(-300);
    expect(transaction.chargedAmount).toBe(-1100);
    expect(transaction.status).toBe('completed');
  });

  test('uses the given processedDate as-is, independent of the purchase date', () => {
    const transaction = convertVoucher(voucher, processedDateIso);

    expect(transaction.date).toBe(moment('10/08/2026 09:15:00', 'DD/MM/YYYY HH:mm:ss').toISOString());
    expect(transaction.processedDate).toBe(processedDateIso);
  });

  test('defaults the purchase time to midnight when missing', () => {
    const transaction = convertVoucher({ ...voucher, purchaseTime: null }, processedDateIso);

    expect(transaction.date).toBe(moment('10/08/2026 00:00:00', 'DD/MM/YYYY HH:mm:ss').toISOString());
  });

  test('trims the business name, memo, and category', () => {
    const transaction = convertVoucher(voucher, processedDateIso);

    expect(transaction.description).toBe('Amazon');
    expect(transaction.memo).toBe('memo');
    expect(transaction.category).toBe('קניות');
  });

  test('is an installment transaction only when both installment fields are set', () => {
    const single = convertVoucher(voucher, processedDateIso);
    const installment = convertVoucher(
      { ...voucher, currentInstallmentNum: 2, numberOfInstallment: 4 },
      processedDateIso,
    );

    expect(single.type).toBe('normal');
    expect(single.installments).toBeUndefined();
    expect(installment.type).toBe('installments');
    expect(installment.installments).toEqual({ number: 2, total: 4 });
  });

  test('includes the raw transaction only when requested', () => {
    const withRaw = convertVoucher(voucher, processedDateIso, { includeRawTransaction: true } as ScraperOptions);
    const withoutRaw = convertVoucher(voucher, processedDateIso, { includeRawTransaction: false } as ScraperOptions);

    expect(withRaw.rawTransaction).toBeDefined();
    expect(withoutRaw.rawTransaction).toBeUndefined();
  });
});
