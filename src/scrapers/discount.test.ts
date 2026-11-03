import moment from 'moment';
import DiscountScraper from './discount';
import { maybeTestCompanyAPI, extendAsyncTimeout, getTestsConfig, exportTransactions } from '../tests/tests-utils';
import { SCRAPERS } from '../definitions';
import { LoginResults } from './base-scraper-with-browser';

const COMPANY_ID = 'discount'; // TODO this property should be hard-coded in the provider
const testsConfig = getTestsConfig();

describe('Discount legacy scraper', () => {
  beforeAll(() => {
    extendAsyncTimeout(); // The default timeout is 5 seconds per async test, this function extends the timeout value
  });

  test('should expose login fields in scrapers constant', () => {
    expect(SCRAPERS.discount).toBeDefined();
    expect(SCRAPERS.discount.loginFields).toContain('id');
    expect(SCRAPERS.discount.loginFields).toContain('password');
    expect(SCRAPERS.discount.loginFields).toContain('num');
  });

  maybeTestCompanyAPI(COMPANY_ID, config => config.companyAPI.invalidPassword)(
    'should fail on invalid user/password"',
    async () => {
      const options = {
        ...testsConfig.options,
        companyId: COMPANY_ID,
      };

      const scraper = new DiscountScraper(options);

      const result = await scraper.scrape({ id: 'e10s12', password: '3f3ss3d', num: '1234' });

      expect(result).toBeDefined();
      expect(result.success).toBeFalsy();
      expect(result.errorType).toBe(LoginResults.InvalidPassword);
    },
  );

  maybeTestCompanyAPI(COMPANY_ID)('should scrape transactions"', async () => {
    const options = {
      ...testsConfig.options,
      startDate: new Date(),
      companyId: COMPANY_ID,
    };

    const scraper = new DiscountScraper(options);
    const result = await scraper.scrape(testsConfig.credentials.discount);
    expect(result).toBeDefined();
    const error = `${result.errorType || ''} ${result.errorMessage || ''}`.trim();
    expect(error).toBe('');
    expect(result.success).toBeTruthy();

    exportTransactions(COMPANY_ID, result.accounts || []);
  });
});

describe('Discount supplemental read-only data', () => {
  test('parses linked currency accounts, deposits, and securities without changing transaction accounts', async () => {
    const responses: Record<string, unknown> = {
      userAccountsData: {
        UserAccountsData: {
          DefaultAccountNumber: '100',
          UserAccounts: [{ NewAccountInfo: { AccountID: '100' } }],
        },
      },
      transactions: {
        CurrentAccountLastTransactions: {
          OperationEntry: [],
          CurrentAccountInfo: { AccountBalance: 42 },
        },
      },
      foreignCurrency: {
        CALinkedAccountsDetails: {
          MainAccountBlock: {
            MainAccountEntry: [
              {
                NewAccountInfo: { AccountID: '100' },
                LinkedAccountsBlock: {
                  LinkedAccountEntry: [
                    {
                      AccountInfo: { AccountID: '200', BranchID: '001', AccountType: 'FX' },
                      CurrencyCode: 'USD',
                      AccountBalance: '12.5',
                      AccountBalanceByRate: '46.25',
                    },
                  ],
                },
              },
            ],
          },
        },
      },
      deposits: {
        DepositsDetails: {
          DepositDetailsBlock: {
            DepositAccountEntry: [
              {
                TermNewAccountNumber: '300',
                DepositID: 'D1',
                ProductFamily: 'money-market',
                DepositName: 'Money market fund',
                CurrencyCode: 'ILS',
                CurrentValue: '1000',
                BusinessDate: '20261019',
              },
            ],
          },
        },
      },
      cards: {
        CardsPastOrFutureDebitTotal: {
          CardsBlock: { CardsEntry: [{ CardNumber: '4111111111111111', CardTypeCode: '1', CardValidityDate: '1229' }] },
        },
      },
      cardCurrent: {
        CardCurrentDebitTransactions: {
          CardDebitsTransactionsBlock: {
            CardDebitsTransactionEntry: [
              {
                PurchaseDate: moment().format('YYYYMMDD'),
                PurchaseCurrencyCode: 'USD',
                PurchaseAmount: '5',
                MerchantName: 'Test purchase',
              },
            ],
          },
        },
      },
      securities: {
        CurrentSecuritiesPortfolio: {
          BusinessDate: '20261019',
          SecuritiesEntry: [
            {
              SecurityNumber: 'FUND-1',
              PaperNameEngTitan: 'Money market fund',
              PaperSubTypeTZ: 'SEC_SUB_TYPE_ARUTZIM_TRST_FUND',
              CurrencyCode: 'ILS',
              CurrentUnits: '5',
              TmuraInCurrency: '50',
            },
          ],
        },
      },
    };

    const scraper = new DiscountScraper({
      ...testsConfig.options,
      startDate: new Date(),
      companyId: COMPANY_ID,
    }) as any;
    scraper.page = {
      evaluate: (_callback: unknown, url: string) => {
        const path = new URL(url).pathname;
        const key = path.endsWith('/userAccountsData')
          ? 'userAccountsData'
          : path.includes('/lastTransactions/')
            ? 'transactions'
            : path.includes('/foreign/CALinkedAccountsDetails')
              ? 'foreignCurrency'
              : path.includes('/deposits/depositsDetails/')
                ? 'deposits'
                : path.includes('/creditCards/cardCurrentDebitTransactions/')
                  ? 'cardCurrent'
                  : path.includes('/creditCards/cardsPastOrFutureDebitTotal/')
                    ? 'cards'
                    : path.includes('/securities/portfolioInfo/')
                      ? 'securities'
                      : null;
        const response = key ? responses[key] : null;
        return [response === null ? null : JSON.stringify(response), response === null ? 404 : 200];
      },
    };

    const result = await scraper.fetchData();

    expect(result.success).toBe(true);
    expect(result.accounts).toHaveLength(1);
    expect(result.accounts[0]).toMatchObject({ accountNumber: '100', balance: 42 });
    expect(result.supplementalData.accounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'foreignCurrency', currency: 'USD', balance: 12.5 }),
        expect.objectContaining({ type: 'savings', currency: 'ILS', balance: 1000 }),
        expect.objectContaining({
          type: 'card',
          txns: [expect.objectContaining({ chargedAmount: -5, chargedCurrency: 'USD' })],
        }),
        expect.objectContaining({
          type: 'securities',
          holdings: [expect.objectContaining({ symbol: 'Money market fund', quantity: 5, marketValue: 50 })],
        }),
      ]),
    );
    expect(result.supplementalData.sections).toMatchObject({
      foreignCurrency: { status: 'complete', recordCount: 1 },
      deposits: { status: 'complete', recordCount: 1 },
      securities: { status: 'complete', recordCount: 1 },
      cards: { status: 'complete', recordCount: 2 },
    });
  });
});

test('keeps current-account data available when supplemental endpoints fail', async () => {
  const scraper = new DiscountScraper({
    ...testsConfig.options,
    companyId: COMPANY_ID,
  }) as any;
  scraper.page = {
    evaluate: (_callback: unknown, url: string) => {
      const path = new URL(url).pathname;
      if (path.endsWith('/userAccountsData')) {
        return [
          JSON.stringify({ UserAccountsData: { UserAccounts: [{ NewAccountInfo: { AccountID: '100' } }] } }),
          200,
        ];
      }
      if (path.includes('/lastTransactions/')) {
        return [
          JSON.stringify({
            CurrentAccountLastTransactions: {
              OperationEntry: [],
              CurrentAccountInfo: { AccountBalance: 42 },
            },
          }),
          200,
        ];
      }
      return [null, 404];
    },
  };

  const result = await scraper.fetchData();

  expect(result.success).toBe(true);
  expect(result.accounts).toHaveLength(1);
  expect(result.supplementalData.sections).toMatchObject({
    foreignCurrency: { status: 'unavailable' },
    deposits: { status: 'unavailable' },
    securities: { status: 'unavailable' },
    cards: { status: 'unavailable' },
  });
});

test('marks card history partial when a failed monthly response contains parseable JSON', async () => {
  const scraper = new DiscountScraper({
    ...testsConfig.options,
    startDate: moment().subtract(2, 'months').toDate(),
    companyId: COMPANY_ID,
  }) as any;
  scraper.page = {
    evaluate: (_callback: unknown, url: string) => {
      const path = new URL(url).pathname;
      if (path.endsWith('/userAccountsData')) {
        return [
          JSON.stringify({ UserAccountsData: { UserAccounts: [{ NewAccountInfo: { AccountID: '100' } }] } }),
          200,
        ];
      }
      if (path.includes('/lastTransactions/')) {
        return [
          JSON.stringify({
            CurrentAccountLastTransactions: { OperationEntry: [], CurrentAccountInfo: { AccountBalance: 42 } },
          }),
          200,
        ];
      }
      if (path.includes('/creditCards/cardsPastOrFutureDebitTotal/')) {
        return [
          JSON.stringify({
            CardsBlock: {
              CardsEntry: [{ CardNumber: '4111111111111111', CardTypeCode: '1', CardValidityDate: '1229' }],
            },
          }),
          200,
        ];
      }
      if (path.includes('/cardCurrentDebitTransactions/')) {
        return [
          JSON.stringify({
            CardCurrentDebitTransactions: { CardDebitsTransactionsBlock: { CardDebitsTransactionEntry: [] } },
          }),
          200,
        ];
      }
      if (path.includes('/cardPastDebitTransactions/')) {
        return [
          JSON.stringify({
            CardPastDebitTransactions: { CardDebitsTransactionsBlock: { CardDebitsTransactionEntry: [] } },
          }),
          500,
        ];
      }
      return [null, 404];
    },
  };

  const result = await scraper.fetchData();

  expect(result.success).toBe(true);
  expect(result.supplementalData.sections.cards.status).toBe('partial');
});
