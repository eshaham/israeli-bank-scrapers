import { TransactionStatuses, TransactionTypes, type Transaction } from '../../transactions';
import { formatChequeDetails, getChequeLookupUrl, type ChequeDepositListResponse } from './leumi-cheques';

function createTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    type: TransactionTypes.Normal,
    status: TransactionStatuses.Completed,
    date: '2026-10-19T21:00:00.000Z',
    processedDate: '2026-10-19T21:00:00.000Z',
    description: 'הפקדת שיק',
    identifier: 4400,
    memo: '',
    originalCurrency: 'ILS',
    originalAmount: 485,
    chargedAmount: 485,
    ...overrides,
  };
}

// Shape of the checksdepositlist response observed on the live site (numbers changed).
function createDeposit(chequeNumber: number, depositReference = 4400) {
  return {
    depositDetails: {
      chequeDetails: {
        magneticCode: {
          chequeBank: 12,
          chequeBranch: 681,
          chequeActionMode: 0,
          chequeAccount: 123456,
          chequeNumber,
        },
        amount: 485,
      },
      depositSource: 1,
      depositChannel: 7,
      depositDate: '20261020',
      clearedDate: '20261020',
      depositReference,
      isReturned: false,
    },
    returned: {},
    images: {},
  };
}

function getFilter(url: string | null) {
  return JSON.parse(new URL(url || '').searchParams.get('depositTransactionFilter') || '{}');
}

describe('getChequeLookupUrl', () => {
  test('looks up a single cheque and a multi-cheque deposit', () => {
    expect(getChequeLookupUrl(createTransaction({ description: 'הפקדת שיק' }))).toContain('/checksdepositdlist');
    expect(getChequeLookupUrl(createTransaction({ description: 'הפקדת שיקים' }))).toContain('/checksdepositdlist');
  });

  test('looks up a cleared deposit, which only carries a code', () => {
    // Observed: a cheque deposit shown as `הפקדת שיק` on the site comes back as `הפקדת 738`.
    expect(getChequeLookupUrl(createTransaction({ description: 'הפקדת 738' }))).toContain('/checksdepositdlist');
  });

  test('looks up a returned cheque by its absolute amount', () => {
    const url = getChequeLookupUrl(
      createTransaction({ description: 'החזרת שיק', chargedAmount: -881, identifier: 706 }),
    );

    expect(url).toContain('/checkdepositedreturned');
    expect(getFilter(url).amount).toEqual({ fromAmount: 881, toAmount: 881 });
    expect(getFilter(url).depositReference).toBe(706);
  });

  test('ignores other transactions, debit deposits and credit returns', () => {
    expect(getChequeLookupUrl(createTransaction({ description: 'העברה דיגיטל' }))).toBeNull();
    expect(getChequeLookupUrl(createTransaction({ chargedAmount: -485 }))).toBeNull();
    expect(getChequeLookupUrl(createTransaction({ description: 'החזרת שיק' }))).toBeNull();
  });

  test("skips today's pending deposits, which have no details yet", () => {
    const pending = createTransaction({ description: 'הפקדת שיקים', status: TransactionStatuses.Pending });
    expect(getChequeLookupUrl(pending)).toBeNull();
  });

  test('filters by amount and reference, with a day of slack around the date', () => {
    const filter = getFilter(getChequeLookupUrl(createTransaction()));

    expect(filter.amount).toEqual({ fromAmount: 485, toAmount: 485 });
    expect(filter.depositReference).toBe(4400);
    expect(Number(filter.depositDate.fromDate)).toBeLessThan(Number(filter.depositDate.toDate));
  });

  test('omits the reference when the transaction has none', () => {
    expect(
      getFilter(getChequeLookupUrl(createTransaction({ identifier: undefined }))).depositReference,
    ).toBeUndefined();
  });
});

describe('formatChequeDetails', () => {
  test('formats the cheque number and the payer account', () => {
    const response: ChequeDepositListResponse = { totalDeposits: 1, depositItems: [createDeposit(55776)] };

    expect(formatChequeDetails(response, 4400)).toBe('שיק 55776 מחשבון 12-681-123456');
  });

  test('lists every cheque of a multi-cheque deposit', () => {
    const response: ChequeDepositListResponse = { depositItems: [createDeposit(1), createDeposit(2)] };

    expect(formatChequeDetails(response, 4400)).toBe('שיק 1 מחשבון 12-681-123456, שיק 2 מחשבון 12-681-123456');
  });

  test('drops deposits with another reference', () => {
    const response: ChequeDepositListResponse = { depositItems: [createDeposit(1), createDeposit(2, 9999)] };

    expect(formatChequeDetails(response, 4400)).toBe('שיק 1 מחשבון 12-681-123456');
  });

  test('returns an empty string for an empty or missing response', () => {
    expect(formatChequeDetails(null)).toBe('');
    expect(formatChequeDetails({ depositItems: [{ depositDetails: {} }] })).toBe('');
  });

  test('adds the return reason of a returned cheque', () => {
    // Shape of the checkdepositedreturned response observed on the live site (numbers changed).
    const deposit = {
      ...createDeposit(80000706, 706),
      returned: {
        returnDate: '20251210',
        returnReasons: [{ returnCode: 2, returnDescription: 'א.כ.מ- אין כיסוי מספיק' }],
      },
    };

    expect(formatChequeDetails({ depositItems: [deposit] }, 706)).toBe(
      'שיק 80000706 מחשבון 12-681-123456 חזר: א.כ.מ- אין כיסוי מספיק',
    );
  });
});
