import moment from 'moment-timezone';
import { CompanyTypes } from '../definitions';
import { TransactionStatuses, TransactionTypes } from '../transactions';
import { convertParsedDataToTransactions } from './visa-cal';

// No scraper construction, login, credential configuration or real network calls.
jest.mock('puppeteer', () => ({
  __esModule: true,
  default: {
    launch: () => {
      throw new Error('Browser access is forbidden in mapper tests');
    },
  },
}));
jest.mock('../helpers/fetch', () => ({
  fetchPost: () => {
    throw new Error('Network access is forbidden in mapper tests');
  },
}));

type SourceRecord = Record<string, unknown>;

function completed(overrides: SourceRecord = {}): SourceRecord {
  return {
    trnTypeCode: '41',
    trnType: 'Synthetic source label',
    numOfPayments: 0,
    curPaymentNum: 0,
    trnPurchaseDate: '2026-10-03T12:00:00.000Z',
    debCrdDate: '2026-10-15T12:00:00.000Z',
    trnIntId: 'synthetic-001',
    trnAmt: 12.5,
    amtBeforeConvAndIndex: 46.25,
    trnCurrencySymbol: 'USD',
    debCrdCurrencySymbol: 'ILS',
    merchantName: 'Synthetic merchant',
    transTypeCommentDetails: ['Synthetic memo'],
    branchCodeDesc: 'Synthetic category',
    ...overrides,
  };
}

function pending(overrides: SourceRecord = {}): SourceRecord {
  const record = completed({ numberOfPayments: 0, ...overrides });
  delete record.debCrdDate;
  delete record.numOfPayments;
  delete record.curPaymentNum;
  return record;
}

function convert(regular: SourceRecord[], immediate: SourceRecord[] = [], awaiting: SourceRecord[] = [], raw = false) {
  // Cast only the synthetic API boundary so unknown/missing/numeric codes can be
  // exercised without broadening the production response types.
  const data = [
    {
      result: {
        bankAccounts: [
          {
            debitDates: [{ transactions: regular }],
            immidiateDebits: { debitDays: [{ transactions: immediate }] },
          },
        ],
      },
    },
  ];
  const pendingData = { result: { cardsList: [{ authDetalisList: awaiting }] } };
  return convertParsedDataToTransactions(
    data as unknown as Parameters<typeof convertParsedDataToTransactions>[0],
    pendingData as unknown as Parameters<typeof convertParsedDataToTransactions>[1],
    { companyId: CompanyTypes.visaCal, startDate: new Date('2026-10-01T00:00:00.000Z'), includeRawTransaction: raw },
  );
}

describe('CAL transaction mapper (offline synthetic data)', () => {
  // Match BaseScraper.initialize without constructing a scraper or browser.
  beforeAll(() => moment.tz.setDefault('Asia/Jerusalem'));
  afterAll(() => moment.tz.setDefault());

  test('maps the observed string debit code with zero counters to normal, retaining every other field', () => {
    const source = completed();
    const before = JSON.stringify(source);
    const [transaction] = convert([], [source]);
    expect(transaction).toStrictEqual({
      type: TransactionTypes.Normal,
      status: TransactionStatuses.Completed,
      identifier: 'synthetic-001',
      date: '2026-10-03T12:00:00.000Z',
      processedDate: '2026-10-15T12:00:00.000Z',
      originalAmount: -12.5,
      originalCurrency: 'USD',
      chargedAmount: -46.25,
      chargedCurrency: 'ILS',
      description: 'Synthetic merchant',
      memo: 'Synthetic memo',
      category: 'Synthetic category',
    });
    expect(JSON.stringify(source)).toBe(before);
  });

  test.each([
    ['5', TransactionTypes.Normal],
    ['9', TransactionTypes.Normal],
    ['41', TransactionTypes.Normal],
    ['8', TransactionTypes.Installments],
    ['76', TransactionTypes.Installments],
    ['42', TransactionTypes.Installments],
    ['6', TransactionTypes.Installments],
    ['999', TransactionTypes.Installments],
    [undefined, TransactionTypes.Installments],
    [41, TransactionTypes.Installments],
    [5, TransactionTypes.Installments],
  ])('preserves strict string-code behavior for %p in completed and pending records', (code, expected) => {
    const record = completed({ trnTypeCode: code });
    const awaiting = pending({ trnTypeCode: code });
    if (code === undefined) {
      delete record.trnTypeCode;
      delete awaiting.trnTypeCode;
    }
    const result = convert([record], [], [awaiting]);
    expect(result.map(t => t.type)).toStrictEqual([expected, expected]);
    expect(result.map(t => t.status)).toStrictEqual([TransactionStatuses.Pending, TransactionStatuses.Completed]);
    expect(result.every(t => t.installments === undefined)).toBe(true);
  });

  test('preserves valid installments, including the existing adjusted dates and pending current number', () => {
    const result = convert(
      [completed({ trnTypeCode: '8', numOfPayments: 4, curPaymentNum: 2 })],
      [],
      [pending({ trnTypeCode: '8', numberOfPayments: 4 })],
    );
    expect(result.map(t => t.type)).toStrictEqual([TransactionTypes.Installments, TransactionTypes.Installments]);
    expect(result.map(t => t.installments)).toStrictEqual([
      { number: 1, total: 4 },
      { number: 2, total: 4 },
    ]);
    expect(result.map(t => t.date)).toStrictEqual(['2026-10-03T12:00:00.000Z', '2026-11-03T13:00:00.000Z']);
    expect(result.map(t => t.processedDate)).toStrictEqual(['2026-10-03T12:00:00.000Z', '2026-10-15T12:00:00.000Z']);
  });

  test('retains contradictory installment metadata on code 41 instead of making it appear consistent', () => {
    const result = convert(
      [completed({ numOfPayments: 4, curPaymentNum: 2 })],
      [],
      [pending({ numberOfPayments: 4 })],
      true,
    );
    const unchangedMapping = convert(
      [completed({ trnTypeCode: '8', numOfPayments: 4, curPaymentNum: 2 })],
      [],
      [pending({ trnTypeCode: '8', numberOfPayments: 4 })],
      true,
    );
    expect(result.map(t => t.type)).toStrictEqual([TransactionTypes.Normal, TransactionTypes.Normal]);
    expect(result.map(t => t.installments)).toStrictEqual([
      { number: 1, total: 4 },
      { number: 2, total: 4 },
    ]);
    result.forEach((transaction, index) => {
      const { type: _type, rawTransaction, ...fields } = transaction;
      const { type: _previousType, rawTransaction: previousRaw, ...previousFields } = unchangedMapping[index];
      expect(fields).toStrictEqual(previousFields);
      expect(rawTransaction).toStrictEqual({ ...(previousRaw as SourceRecord), trnTypeCode: '41' });
    });
  });

  test('preserves pending fields, duplicate records, source order and raw metadata across both debit branches', () => {
    const first = completed({ trnIntId: 'synthetic-first', isImmediateHHKInd: false });
    const immediate = completed({ trnIntId: 'synthetic-immediate', isImmediateHHKInd: true });
    const awaiting = pending();
    const result = convert([first, first], [immediate, immediate], [awaiting], true);
    expect(result).toHaveLength(5);
    expect(result.map(t => t.identifier)).toStrictEqual([
      undefined,
      'synthetic-first',
      'synthetic-first',
      'synthetic-immediate',
      'synthetic-immediate',
    ]);
    expect(result.every(t => t.type === TransactionTypes.Normal)).toBe(true);
    expect(result[1]).toStrictEqual(result[2]);
    expect(result[3]).toStrictEqual(result[4]);
    expect(result[0]).toStrictEqual({
      type: TransactionTypes.Normal,
      status: TransactionStatuses.Pending,
      identifier: undefined,
      date: '2026-10-03T12:00:00.000Z',
      processedDate: '2026-10-03T12:00:00.000Z',
      originalAmount: -12.5,
      originalCurrency: 'USD',
      chargedAmount: -12.5,
      chargedCurrency: undefined,
      description: 'Synthetic merchant',
      memo: 'Synthetic memo',
      category: 'Synthetic category',
      rawTransaction: awaiting,
    });
    expect(result[1].rawTransaction).toStrictEqual(first);
    expect(result[3].rawTransaction).toStrictEqual(immediate);
  });

  test('leaves refund signs and unresolved code 42 behavior unchanged', () => {
    // Historical code 42 support used an older API; current semantics are outside
    // this correction, as are code 76 and the general unknown-code fallback.
    const result = convert([
      completed({ trnTypeCode: '6' }),
      completed({ trnTypeCode: '42' }),
      completed({ trnAmt: -12.5, amtBeforeConvAndIndex: -46.25 }),
    ]);
    expect(result.map(t => [t.type, t.originalAmount, t.chargedAmount])).toStrictEqual([
      [TransactionTypes.Installments, 12.5, -46.25],
      [TransactionTypes.Installments, -12.5, -46.25],
      [TransactionTypes.Normal, 12.5, 46.25],
    ]);
  });
});
