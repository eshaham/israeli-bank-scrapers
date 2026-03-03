import { chromium } from 'playwright-extra';

import { buildContextOptions } from '../../Common/Browser';
import { clickButton, elementPresentOnPage, pageEvalAll } from '../../Common/ElementsInteractions';
import { getCurrentUrl } from '../../Common/Navigation';
import { sleep } from '../../Common/Waiting';
import { SHEKEL_CURRENCY } from '../../Constants';
import { ScraperErrorTypes } from '../../Scrapers/Base/Errors';
import { type ScraperOptions } from '../../Scrapers/Base/Interface';
import BeinleumiGroupBaseScraper from '../../Scrapers/BaseBeinleumiGroup/BaseBeinleumiGroup';
import { beinleumiConfig } from '../../Scrapers/BaseBeinleumiGroup/BeinleumiLoginConfig';
import { TransactionStatuses, TransactionTypes } from '../../Transactions';
import { createMockPage, createMockScraperOptions } from '../MockPage';

jest.mock('playwright-extra', () => ({ chromium: { launch: jest.fn(), use: jest.fn() } }));
jest.mock('puppeteer-extra-plugin-stealth', () => jest.fn());
jest.mock('../../Common/ElementsInteractions', () => ({
  clickButton: jest.fn().mockResolvedValue(undefined),
  fillInput: jest.fn().mockResolvedValue(undefined),
  waitUntilElementFound: jest.fn().mockResolvedValue(undefined),
  elementPresentOnPage: jest.fn().mockResolvedValue(false),
  pageEvalAll: jest.fn().mockResolvedValue([]),
  pageEval: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../Common/Navigation', () => ({
  waitForNavigation: jest.fn().mockResolvedValue(undefined),
  getCurrentUrl: jest.fn().mockResolvedValue('https://test.fibi.co.il/Resources/PortalNG/shell'),
}));
jest.mock('../../Common/Browser', () => ({
  buildContextOptions: jest.fn().mockReturnValue({}),
}));
jest.mock('../../Common/Transactions', () => ({
  getRawTransaction: jest.fn((data: unknown) => data),
}));
jest.mock('../../Common/Waiting', () => ({
  sleep: jest.fn().mockResolvedValue(undefined),
  TimeoutError: class TimeoutError extends Error {},
  SECOND: 1000,
}));
jest.mock('../../Common/Debug', () => ({
  getDebug: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));
// OTP handling is tested separately in otp-detection.e2e-mocked.test.ts.
// Return null here so login/fetchData tests are not affected by OTP detection.
jest.mock('../../Common/OtpHandler', () => ({ handleOtpStep: jest.fn().mockResolvedValue(null) }));

class TestBeinleumiScraper extends BeinleumiGroupBaseScraper {
  BASE_URL = 'https://test.fibi.co.il';

  TRANSACTIONS_URL = 'https://test.fibi.co.il/transactions';

  constructor(options: ScraperOptions) {
    super(options, beinleumiConfig('https://www.fibi.co.il'));
  }
}

const mockContext = {
  newPage: jest.fn(),
  close: jest.fn().mockResolvedValue(undefined),
};
const mockBrowser = {
  newContext: jest.fn().mockResolvedValue(mockContext),
  close: jest.fn().mockResolvedValue(undefined),
};

const CREDS = { username: 'testuser', password: 'testpass' };

function createPageWithAccountFeatures(
  overrides: Record<string, jest.Mock> = {},
): ReturnType<typeof createMockPage> {
  return createMockPage({
    $eval: jest.fn().mockImplementation((selector: string) => {
      if (selector === 'div.fibi_account span.acc_num') return '12/345678';
      if (selector === '.main_balance') return '₪5,000.00';
      if (selector === '.NO_DATA') return 'לא נמצאו נתונים בנושא המבוקש';
      return undefined;
    }),
    $$eval: jest.fn().mockResolvedValue([]),
    evaluate: jest.fn().mockResolvedValue([]),
    frames: jest.fn().mockReturnValue([]),
    ...overrides,
  });
}

const COMPLETED_COLUMN_TYPES = [
  { colClass: 'date first', index: 0 },
  { colClass: 'reference wrap_normal', index: 1 },
  { colClass: 'details', index: 2 },
  { colClass: 'debit', index: 3 },
  { colClass: 'credit', index: 4 },
];

const PENDING_COLUMN_TYPES = [
  { colClass: 'first date', index: 0 },
  { colClass: 'details wrap_normal', index: 1 },
  { colClass: 'details', index: 2 },
  { colClass: 'debit', index: 3 },
  { colClass: 'credit', index: 4 },
];

function mockTransactionTable(rows: { innerTds: string[] }[]): void {
  (pageEvalAll as jest.Mock)
    .mockResolvedValueOnce([]) // pending column types
    .mockResolvedValueOnce([]) // pending rows
    .mockResolvedValueOnce(COMPLETED_COLUMN_TYPES)
    .mockResolvedValueOnce(rows);
}

beforeEach(() => {
  jest.clearAllMocks();
  (chromium.launch as jest.Mock).mockResolvedValue(mockBrowser);
  mockContext.newPage.mockResolvedValue(createPageWithAccountFeatures());
  (getCurrentUrl as jest.Mock).mockResolvedValue(
    'https://test.fibi.co.il/Resources/PortalNG/shell',
  );
  (elementPresentOnPage as jest.Mock).mockResolvedValue(false);
});

describe('login', () => {
  it('succeeds with valid credentials', async () => {
    const scraper = new TestBeinleumiScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);
    expect(result.success).toBe(true);
    expect(buildContextOptions).toHaveBeenCalled();
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it('returns InvalidPassword for marketing URL', async () => {
    (getCurrentUrl as jest.Mock).mockResolvedValue(
      'https://test.fibi.co.il/FibiMenu/Marketing/Private/Home',
    );
    const scraper = new TestBeinleumiScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.InvalidPassword);
  });
});

describe('fetchData', () => {
  it('fetches transactions for single account (no dropdown)', async () => {
    mockTransactionTable([{ innerTds: ['15/06/2024', 'סופר שופ', '12345', '₪150.00', ''] }]);

    const scraper = new TestBeinleumiScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(true);
    expect(result.accounts).toHaveLength(1);
    expect(result.accounts![0].accountNumber).toBe('12_345678');
  });

  it('converts transaction amounts correctly (credit - debit)', async () => {
    mockTransactionTable([{ innerTds: ['15/06/2024', 'Payment', '100', '₪200.00', '₪50.00'] }]);

    const scraper = new TestBeinleumiScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    const t = result.accounts![0].txns[0];
    expect(t.originalAmount).toBe(50 - 200);
    expect(t.originalCurrency).toBe(SHEKEL_CURRENCY);
    expect(t.type).toBe(TransactionTypes.Normal);
  });

  it('handles no transactions in date range', async () => {
    (elementPresentOnPage as jest.Mock).mockImplementation((_page: unknown, selector: string) => {
      return selector === '.NO_DATA';
    });

    const scraper = new TestBeinleumiScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(true);
    expect(result.accounts![0].txns).toHaveLength(0);
  });

  it('skips rows with empty date', async () => {
    mockTransactionTable([
      { innerTds: ['15/06/2024', 'Valid', '100', '₪100.00', ''] },
      { innerTds: ['', 'Invalid', '', '', ''] },
    ]);

    const scraper = new TestBeinleumiScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.accounts![0].txns).toHaveLength(1);
  });

  it('includes rawTransaction when option set', async () => {
    mockTransactionTable([{ innerTds: ['15/06/2024', 'Test', '100', '₪100.00', ''] }]);

    const scraper = new TestBeinleumiScraper(
      createMockScraperOptions({ includeRawTransaction: true }),
    );
    const result = await scraper.scrape(CREDS);

    expect(result.accounts![0].txns[0].rawTransaction).toBeDefined();
  });

  it('parses reference number as integer', async () => {
    mockTransactionTable([{ innerTds: ['15/06/2024', 'Test', '12345', '₪100.00', ''] }]);

    const scraper = new TestBeinleumiScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.accounts![0].txns[0].identifier).toBe(12345);
  });

  it('sets identifier to undefined when reference is empty', async () => {
    mockTransactionTable([{ innerTds: ['15/06/2024', 'Test', '', '₪100.00', ''] }]);

    const scraper = new TestBeinleumiScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.accounts![0].txns[0].identifier).toBeUndefined();
  });

  it('extracts pending transactions with pending column layout', async () => {
    (pageEvalAll as jest.Mock)
      .mockResolvedValueOnce(PENDING_COLUMN_TYPES) // pending column types
      .mockResolvedValueOnce([
        { innerTds: ['20/06/2024', 'Pending Purchase', '999', '₪75.00', ''] },
      ]) // pending rows
      .mockResolvedValueOnce(COMPLETED_COLUMN_TYPES) // completed column types
      .mockResolvedValueOnce([]); // completed rows (empty)

    const scraper = new TestBeinleumiScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.accounts![0].txns).toHaveLength(1);
    expect(result.accounts![0].txns[0].status).toBe(TransactionStatuses.Pending);
    expect(result.accounts![0].txns[0].description).toBe('Pending Purchase');
    expect(result.accounts![0].txns[0].originalAmount).toBe(-75);
  });

  it('combines pending and completed transactions', async () => {
    (pageEvalAll as jest.Mock)
      .mockResolvedValueOnce(PENDING_COLUMN_TYPES)
      .mockResolvedValueOnce([{ innerTds: ['20/06/2024', 'Pending', '', '₪50.00', ''] }])
      .mockResolvedValueOnce(COMPLETED_COLUMN_TYPES)
      .mockResolvedValueOnce([{ innerTds: ['15/06/2024', 'Completed', '100', '₪100.00', ''] }]);

    const scraper = new TestBeinleumiScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.accounts![0].txns).toHaveLength(2);
    const pending = result.accounts![0].txns.find(t => t.status === TransactionStatuses.Pending);
    const completed = result.accounts![0].txns.find(
      t => t.status === TransactionStatuses.Completed,
    );
    expect(pending).toBeDefined();
    expect(completed).toBeDefined();
  });

  it('paginates completed transactions when next page exists', async () => {
    // First call: pending (empty)
    (pageEvalAll as jest.Mock)
      .mockResolvedValueOnce([]) // pending column types
      .mockResolvedValueOnce([]) // pending rows
      // First page of completed
      .mockResolvedValueOnce(COMPLETED_COLUMN_TYPES)
      .mockResolvedValueOnce([{ innerTds: ['15/06/2024', 'Page1', '100', '₪100.00', ''] }]);

    // beinleumiConfig.preAction calls elementPresentOnPage(page, 'a.login-trigger') once.
    // It must be accounted for so subsequent Once values land on the right calls.
    (elementPresentOnPage as jest.Mock)
      .mockResolvedValueOnce(false) // preAction: no login-trigger in mock env
      .mockResolvedValueOnce(false) // NO_DATA check
      .mockResolvedValueOnce(true); // hasNextPage = true (after first page)

    // Second page of completed
    (pageEvalAll as jest.Mock)
      .mockResolvedValueOnce(COMPLETED_COLUMN_TYPES)
      .mockResolvedValueOnce([{ innerTds: ['16/06/2024', 'Page2', '200', '₪200.00', ''] }]);

    // After second page: no next page
    (elementPresentOnPage as jest.Mock).mockResolvedValueOnce(false); // hasNextPage = false

    const scraper = new TestBeinleumiScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.accounts![0].txns).toHaveLength(2);
    expect(result.accounts![0].txns[0].description).toBe('Page1');
    expect(result.accounts![0].txns[1].description).toBe('Page2');
    expect(clickButton).toHaveBeenCalledWith(expect.anything(), 'a#Npage.paging');
  });

  it('retries iframe detection with sleep', async () => {
    mockTransactionTable([{ innerTds: ['15/06/2024', 'Test', '100', '₪100.00', ''] }]);

    const scraper = new TestBeinleumiScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    // getTransactionsFrame calls sleep(2000) up to 3 times when no iframe found
    expect(result.success).toBe(true);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it('extracts balance from page', async () => {
    mockTransactionTable([{ innerTds: ['15/06/2024', 'Test', '100', '₪100.00', ''] }]);

    const scraper = new TestBeinleumiScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.accounts![0].balance).toBe(5000);
  });

  it('handles commas in currency amounts', async () => {
    mockTransactionTable([{ innerTds: ['15/06/2024', 'Big Purchase', '100', '₪1,500.50', ''] }]);

    const scraper = new TestBeinleumiScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.accounts![0].txns[0].originalAmount).toBe(-1500.5);
  });
});
