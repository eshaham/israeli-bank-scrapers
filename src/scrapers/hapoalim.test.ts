import moment, { type Moment } from 'moment';
import HapoalimScraper, { fetchTransactionsInRange } from './hapoalim';
import { maybeTestCompanyAPI, extendAsyncTimeout, getTestsConfig, exportTransactions } from '../tests/tests-utils';
import { SCRAPERS } from '../definitions';
import { LoginResults } from './base-scraper-with-browser';

const COMPANY_ID = 'hapoalim'; // TODO this property should be hard-coded in the provider
const testsConfig = getTestsConfig();

describe('Hapoalim legacy scraper', () => {
  beforeAll(() => {
    extendAsyncTimeout(); // The default timeout is 5 seconds per async test, this function extends the timeout value
  });

  test('should expose login fields in scrapers constant', () => {
    expect(SCRAPERS.hapoalim).toBeDefined();
    expect(SCRAPERS.hapoalim.loginFields).toContain('userCode');
    expect(SCRAPERS.hapoalim.loginFields).toContain('password');
  });

  maybeTestCompanyAPI(COMPANY_ID, config => config.companyAPI.invalidPassword)(
    'should fail on invalid user/password"',
    async () => {
      const options = {
        ...testsConfig.options,
        companyId: COMPANY_ID,
      };

      const scraper = new HapoalimScraper(options);

      const result = await scraper.scrape({ userCode: 'e10s12', password: '3f3ss3d' });

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

    const scraper = new HapoalimScraper(options);
    const result = await scraper.scrape(testsConfig.credentials.hapoalim);
    expect(result).toBeDefined();
    const error = `${result.errorType || ''} ${result.errorMessage || ''}`.trim();
    expect(error).toBe('');
    expect(result.success).toBeTruthy();

    exportTransactions(COMPANY_ID, result.accounts || []);
  });
});

describe('Hapoalim transactions paging', () => {
  const PAGE_SIZE = 150;
  const DAY = 'YYYYMMDD';
  // One transaction per day, like a busy current account. The fake server returns the newest PAGE_SIZE
  // rows of the requested range, newest first, and reports its page size, as the real API does.
  const allDays = Array.from({ length: 365 }, (_, i) => moment('2025-10-05').add(i, 'days'));
  const fakeServer = jest.fn((start: Moment, end: Moment) => {
    const inRange = allDays.filter(d => d.isBetween(start, end, 'day', '[]')).reverse();
    return Promise.resolve({
      numItemsPerPage: String(PAGE_SIZE),
      transactions: inRange.slice(0, PAGE_SIZE).map(d => ({
        eventDate: d.format(DAY),
        eventAmount: 1,
        eventActivityTypeCode: 2,
        currentBalance: 0,
        pfmDetails: '',
      })),
    });
  });

  beforeEach(() => fakeServer.mockClear());

  test('returns every transaction when the range exceeds one page', async () => {
    const txns = await fetchTransactionsInRange(fakeServer, allDays[0], allDays[allDays.length - 1]);
    expect(txns).toHaveLength(allDays.length);
    expect(new Set(txns.map(t => t.eventDate)).size).toBe(allDays.length);
  });

  test('keeps newest-first order across split windows', async () => {
    const txns = await fetchTransactionsInRange(fakeServer, allDays[0], allDays[allDays.length - 1]);
    const dates = txns.map(t => t.eventDate as string);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  test('makes a single request when the range fits in one page', async () => {
    const txns = await fetchTransactionsInRange(fakeServer, allDays[0], allDays[99]);
    expect(txns).toHaveLength(100);
    expect(fakeServer).toHaveBeenCalledTimes(1);
  });

  test('stops splitting at a single day', async () => {
    const busyDay = jest.fn(() =>
      Promise.resolve({
        numItemsPerPage: '2',
        transactions: [
          { eventAmount: 1, eventActivityTypeCode: 2, currentBalance: 0, pfmDetails: '' },
          { eventAmount: 2, eventActivityTypeCode: 2, currentBalance: 0, pfmDetails: '' },
        ],
      }),
    );
    const day = moment('2026-01-01');
    const txns = await fetchTransactionsInRange(busyDay, day, day.clone());
    expect(txns).toHaveLength(2);
    expect(busyDay).toHaveBeenCalledTimes(1);
  });

  test('treats a missing page size as a complete response', async () => {
    const noPageSize = jest.fn(() => Promise.resolve({ transactions: [] }));
    await fetchTransactionsInRange(noPageSize, allDays[0], allDays[allDays.length - 1]);
    expect(noPageSize).toHaveBeenCalledTimes(1);
  });
});
