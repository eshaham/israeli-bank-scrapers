import moment from 'moment';
import { SCRAPERS } from '../definitions';
import { exportTransactions, extendAsyncTimeout, getTestsConfig, maybeTestCompanyAPI } from '../tests/tests-utils';
import { LoginResults } from './base-scraper-with-browser';
import VisaCalScraper, { fetchCalApi } from './visa-cal';

const COMPANY_ID = 'visaCal'; // TODO this property should be hard-coded in the provider
const testsConfig = getTestsConfig();

describe('VisaCal legacy scraper', () => {
  beforeAll(() => {
    extendAsyncTimeout(); // The default timeout is 5 seconds per async test, this function extends the timeout value
  });

  test('should expose login fields in scrapers constant', () => {
    expect(SCRAPERS.visaCal).toBeDefined();
    expect(SCRAPERS.visaCal.loginFields).toContain('username');
    expect(SCRAPERS.visaCal.loginFields).toContain('password');
  });

  maybeTestCompanyAPI(COMPANY_ID, config => config.companyAPI.invalidPassword)(
    'should fail on invalid user/password"',
    async () => {
      const options = {
        ...testsConfig.options,
        companyId: COMPANY_ID,
      };

      const scraper = new VisaCalScraper(options);

      const result = await scraper.scrape({ username: '971sddksmsl', password: '3f3ssdkSD3d' });

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

    const scraper = new VisaCalScraper(options);
    const result = await scraper.scrape(testsConfig.credentials.visaCal);
    expect(result).toBeDefined();
    const error = `${result.errorType || ''} ${result.errorMessage || ''}`.trim();
    expect(error).toBe('');
    expect(result.success).toBeTruthy();
    // uncomment to test multiple accounts
    // expect(result?.accounts?.length).toEqual(2)
    exportTransactions(COMPANY_ID, result.accounts || []);
  });
});

describe('fetchCalApi', () => {
  const URL = 'https://api.cal-online.co.il/Frames/api/Frames/GetFrameStatus';
  const mockPage = (result: [string, number]) => ({ evaluate: jest.fn().mockResolvedValue(result) }) as any;

  test('parses a JSON success response and passes request details into the page', async () => {
    const page = mockPage(['{"statusCode":1,"result":{"a":2}}', 200]);
    const result = await fetchCalApi(page, URL, { x: 1 }, { Authorization: 'CALAuthScheme t', 'X-Site-Id': 's' });
    expect(result).toEqual({ statusCode: 1, result: { a: 2 } });
    expect(page.evaluate).toHaveBeenCalledWith(
      expect.any(Function),
      URL,
      { x: 1 },
      expect.objectContaining({ 'X-Site-Id': 's' }),
    );
  });

  test('throws a clear error naming endpoint and status on an HTML block page', async () => {
    const page = mockPage(['<html><head>Request Rejected</head></html>', 200]);
    const promise = fetchCalApi(page, URL, {}, {});
    await expect(promise).rejects.toThrow(/non-JSON response/);
    await expect(promise).rejects.toThrow(URL);
    await expect(promise).rejects.toThrow(/status 200/);
    await expect(promise).rejects.not.toThrow(/Unexpected token/);
  });

  test('throws a clear error on a non-2xx status', async () => {
    const page = mockPage(['<html>Request Rejected</html>', 400]);
    await expect(fetchCalApi(page, URL, {}, {})).rejects.toThrow(`${URL} failed with status 400`);
  });

  describe('node fallback', () => {
    const originalFetch = global.fetch;
    const nodeFetch = jest.fn();
    const rejectingPage = (message: string) => ({ evaluate: jest.fn().mockRejectedValue(new Error(message)) }) as any;
    const nodeResponse = (body: string, status: number) => ({ text: () => Promise.resolve(body), status });

    beforeEach(() => {
      nodeFetch.mockReset();
      global.fetch = nodeFetch as any;
    });
    afterAll(() => {
      global.fetch = originalFetch;
    });

    test('does not call node fetch when the in-page request succeeds', async () => {
      await fetchCalApi(mockPage(['{"a":1}', 200]), URL, {}, {});
      expect(nodeFetch).not.toHaveBeenCalled();
    });

    test.each(['Failed to fetch', 'Execution context was destroyed, most likely because of a navigation'])(
      'falls back to node when the in-page request rejects with "%s"',
      async message => {
        nodeFetch.mockResolvedValue(nodeResponse('{"statusCode":1}', 200));
        const result = await fetchCalApi(rejectingPage(message), `${URL}?a=1`, { x: 1 }, { Authorization: 'a' });
        expect(result).toEqual({ statusCode: 1 });
        expect(nodeFetch).toHaveBeenCalledTimes(1);
        const [calledUrl, init] = nodeFetch.mock.calls[0];
        expect(calledUrl).toBe(`${URL}?a=1`);
        expect(init.method).toBe('POST');
        expect(init.body).toBe('{"x":1}');
        expect(init.headers).toEqual(
          expect.objectContaining({
            Origin: 'https://digital-web.cal-online.co.il',
            Referer: 'https://digital-web.cal-online.co.il',
            Authorization: 'a',
            Accept: 'application/json',
            'Content-Type': 'application/json',
          }),
        );
      },
    );

    test('does not fall back when the page got an HTTP response', async () => {
      await expect(fetchCalApi(mockPage(['<html>Rejected</html>', 400]), URL, {}, {})).rejects.toThrow(
        'failed with status 400',
      );
      expect(nodeFetch).not.toHaveBeenCalled();
    });

    test('names the endpoint and both failures when the fallback returns a bad response', async () => {
      nodeFetch.mockResolvedValue(nodeResponse('<html>Request Rejected</html>', 403));
      const promise = fetchCalApi(rejectingPage('Failed to fetch'), `${URL}?a=1`, {}, {});
      await expect(promise).rejects.toThrow(URL);
      await expect(promise).rejects.toThrow(/Failed to fetch/);
      await expect(promise).rejects.toThrow(/failed with status 403/);
    });

    test('names the endpoint and both failures when the fallback rejects', async () => {
      nodeFetch.mockRejectedValue(new Error('ECONNRESET'));
      const promise = fetchCalApi(rejectingPage('Failed to fetch'), URL, {}, {});
      await expect(promise).rejects.toThrow(URL);
      await expect(promise).rejects.toThrow(/Failed to fetch/);
      await expect(promise).rejects.toThrow(/ECONNRESET/);
    });
  });
});

describe('fetchCardData optional requests', () => {
  const FRAMES = 'https://api.cal-online.co.il/Frames/api/Frames/GetFrameStatus';
  const PENDING = 'https://api.cal-online.co.il/Transactions/api/approvals/getClearanceRequests';
  const card = { cardUniqueId: 'u1', last4Digits: '1234' };

  const originalFetch = global.fetch;
  beforeEach(() => {
    global.fetch = jest.fn().mockRejectedValue(new Error('node fallback unavailable')) as any;
  });
  afterAll(() => {
    global.fetch = originalFetch;
  });

  const TRANSACTIONS_URL =
    'https://api.cal-online.co.il/Transactions/api/transactionsDetails/getCardTransactionsDetails';

  const run = (failing: string) => {
    const evaluate = jest.fn().mockImplementation((_fn: unknown, url: string) => {
      if (url === failing) return Promise.reject(new TypeError('Failed to fetch'));
      let body: object;
      if (url === FRAMES) {
        body = {
          statusCode: 1,
          result: { calIssuedCards: { cardLevelFrames: [{ cardUniqueId: 'u1', nextTotalDebit: 50 }] } },
        };
      } else if (url === PENDING) {
        body = { statusCode: 1, result: { cardsList: [] } };
      } else {
        body = {
          statusCode: 1,
          result: { bankAccounts: [{ debitDates: [], immidiateDebits: { debitDays: [] } }] },
        };
      }
      return Promise.resolve([JSON.stringify(body), 200]);
    });
    const scraper: any = new VisaCalScraper({ companyId: 'visaCal' as any, startTime: new Date() } as any);
    scraper.page = { evaluate };
    return scraper.fetchCardData(card, moment(), new Date(), 0, 'CALAuthScheme t', 'site');
  };

  test('a pending transactions failure is soft and the account is still returned', async () => {
    const account = await run(PENDING);
    expect(account.txns).toEqual([]);
    expect(account.accountNumber).toBe('1234');
    expect(account.balance).toBe(-50);
  });

  test('a frames failure is soft and leaves balance and cardFrame undefined', async () => {
    const account = await run(FRAMES);
    expect(account.txns).toEqual([]);
    expect(account.balance).toBeUndefined();
    expect(account.balanceDate).toBeUndefined();
    expect(account.cardFrame).toBeUndefined();
  });

  test('a monthly transactions failure is fatal', async () => {
    const promise = run(TRANSACTIONS_URL);
    await expect(promise).rejects.toThrow(TRANSACTIONS_URL);
    await expect(promise).rejects.toThrow(/Failed to fetch/);
    await expect(promise).rejects.toThrow(/node fallback unavailable/);
  });
});
