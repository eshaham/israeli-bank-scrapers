import { CompanyTypes, SCRAPERS } from '../definitions';
import { TransactionStatuses } from '../transactions';
import { ScraperErrorTypes } from './errors';
import createScraper from './factory';
import PepperScraper from './pepper';

function makeFakeJwt(expSecondsFromNow: number): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expSecondsFromNow })).toString(
    'base64url',
  );
  return `${header}.${payload}.signature`;
}

function jsonResponse(body: unknown, status = 200, setCookie?: string): Response {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (setCookie) {
    headers.set('set-cookie', setCookie);
  }
  return new Response(JSON.stringify(body), { status, headers });
}

describe('Pepper scraper', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('should expose login fields in scrapers constant and factory', () => {
    expect(SCRAPERS.pepper).toBeDefined();
    expect(SCRAPERS.pepper.loginFields).toEqual(['phoneNumber', 'password', 'otpCodeRetriever', 'otpLongTermToken']);
    const instance = createScraper({ companyId: CompanyTypes.pepper, startDate: new Date() });
    expect(instance).toBeInstanceOf(PepperScraper);
  });

  test('login() enrolls device via 3-step Transmit SMS OTP flow and returns persistent state', async () => {
    const freshToken = makeFakeJwt(1800);
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse(
          {
            data: {
              challenge: 'chal-1',
              control_flow: [{ type: 'authentication', methods: [{ type: 'password', assertion_id: 'pwd-1' }] }],
            },
            headers: [
              { type: 'session_id', session_id: 'sid-1' },
              { type: 'device_id', device_id: 'did-1' },
            ],
          },
          200,
          'ts_hwid=cookie-1; Path=/',
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            control_flow: [
              {
                methods: [{ channels: [{ type: 'sms', assertion_id: 'sms-1' }] }],
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: { token: freshToken },
        }),
      );

    const otpCodeRetriever = jest.fn().mockResolvedValue('123456');
    const scraper = new PepperScraper({ companyId: CompanyTypes.pepper, startDate: new Date() });
    const loginResult = await scraper.login({
      phoneNumber: '053-2227944',
      password: '654321',
      otpCodeRetriever,
    });

    expect(loginResult.success).toBe(true);
    expect(loginResult.persistentOtpToken).toBeDefined();
    expect(otpCodeRetriever).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledTimes(3);

    const [bindUrl, bindInit] = fetchSpy.mock.calls[0];
    expect(bindUrl).toContain('https://sa.pepper.co.il/api/v2/auth/bind?');
    expect((bindInit?.headers as Record<string, string>)['Content-Signature']).toMatch(
      /^data:[^;]+;key-id:[0-9a-f]{64};scheme:4$/,
    );

    const [pwdUrl, pwdInit] = fetchSpy.mock.calls[1];
    expect(pwdUrl).toContain('https://sa.pepper.co.il/api/v2/auth/assert?');
    expect((pwdInit?.headers as Record<string, string>).Cookie).toContain('ts_hwid=cookie-1');
  });

  test('login() renews an expired token in saved state via 2-step resume without SMS OTP', async () => {
    const expiredToken = makeFakeJwt(-600);
    const renewedToken = makeFakeJwt(1800);

    // First enroll to produce a valid encoded state with an EC keypair, then replace its token with expiredToken
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            challenge: 'chal-1',
            control_flow: [{ type: 'authentication', methods: [{ type: 'password', assertion_id: 'pwd-1' }] }],
          },
          headers: [
            { type: 'session_id', session_id: 'sid-1' },
            { type: 'device_id', device_id: 'did-1' },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            control_flow: [{ methods: [{ channels: [{ type: 'sms', assertion_id: 'sms-1' }] }] }],
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: { token: expiredToken } }));

    const scraper = new PepperScraper({ companyId: CompanyTypes.pepper, startDate: new Date() });
    const enrolled = await scraper.login({
      phoneNumber: '0532227944',
      password: '654321',
      otpCodeRetriever: () => Promise.resolve('111222'),
    });
    expect(enrolled.success).toBe(true);

    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockReset()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            challenge: 'chal-2',
            control_flow: [{ type: 'authentication', methods: [{ type: 'password', assertion_id: 'pwd-2' }] }],
          },
          headers: [{ type: 'session_id', session_id: 'sid-2' }],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: { token: renewedToken } }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            userDataV2: {
              getUserDataV2: {
                customerAndAccounts: [
                  {
                    customerId: '998-23025982',
                    accounts: [
                      {
                        accountId: '998-330-23025962',
                        accountNumber: '23025962',
                        accountCategory: 'Ils',
                      },
                    ],
                  },
                ],
              },
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: { accounts: { balance: { currentBalance: 664.43 } } },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            accounts: {
              oshTransactionsNew: {
                totalCount: 1,
                transactions: [
                  {
                    transactionId: '00185505320261022',
                    transactionAmount: -567,
                    bookingDate: '2026-10-22T00:00:00Z',
                    effectiveDate: '2026-10-22T00:00:00Z',
                    currency: 'ILS',
                    description: 'ביטוח לאומי-י',
                    title: 'ביטוח לאומי-גביה מלא',
                    subTitle: 'הרשאה לחיוב חשבון',
                  },
                ],
                pendingTransactions: [],
              },
            },
          },
        }),
      );

    const secondScraper = new PepperScraper({
      companyId: CompanyTypes.pepper,
      startDate: new Date('2026-10-01T00:00:00Z'),
    });
    const resumeLogin = await secondScraper.login({
      phoneNumber: '0532227944',
      password: '654321',
      otpLongTermToken: enrolled.persistentOtpToken!,
    });

    expect(resumeLogin.success).toBe(true);
    expect(fetchSpy.mock.calls[0][0]).toContain('https://sa.pepper.co.il/api/v2/auth/login?');
    expect(fetchSpy.mock.calls[1][0]).toContain('https://sa.pepper.co.il/api/v2/auth/assert?');

    const dataResult = await secondScraper.fetchData();
    expect(dataResult.success).toBe(true);
    expect(dataResult.accounts).toEqual([
      {
        accountNumber: '23025962',
        balance: 664.43,
        txns: [
          expect.objectContaining({
            identifier: '00185505320261022',
            chargedAmount: -567,
            originalAmount: -567,
            description: 'ביטוח לאומי-גביה מלא',
            memo: 'הרשאה לחיוב חשבון',
            status: TransactionStatuses.Completed,
          }),
        ],
      },
    ]);
  });

  test('login() returns InvalidPassword when password assertion fails', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            challenge: 'chal-1',
            control_flow: [{ type: 'authentication', methods: [{ type: 'password', assertion_id: 'pwd-1' }] }],
          },
          headers: [
            { type: 'session_id', session_id: 'sid-1' },
            { type: 'device_id', device_id: 'did-1' },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          error_code: 4001,
          error_message: 'Invalid credentials',
          data: {},
        }),
      );

    const scraper = new PepperScraper({ companyId: CompanyTypes.pepper, startDate: new Date() });
    const result = await scraper.login({
      phoneNumber: '0532227944',
      password: '000000',
      otpCodeRetriever: () => Promise.resolve('123456'),
    });

    expect(result).toEqual({
      success: false,
      errorType: ScraperErrorTypes.InvalidPassword,
      errorMessage: 'Invalid credentials',
    });
  });
});
