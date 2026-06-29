import { type Page } from 'puppeteer';
import { CompanyTypes, SCRAPERS } from '../definitions';
import { AssetType } from '../portfolio';
import { extendAsyncTimeout, getTestsConfig, maybeTestCompanyAPI } from '../tests/tests-utils';
import { LoginResults } from './base-scraper-with-browser';
import ExcellenceScraper, { detectOtpChallenge, mapAssetType, mapBalancesToPortfolioAccount } from './excellence';
import { type ScraperOptions } from './interface';

const COMPANY_ID = 'excellence';
const testsConfig = getTestsConfig();

// ---------------------------------------------------------------------------
// Minimal mock balances response (matches the §7.4 live-capture shape)
// ---------------------------------------------------------------------------
const MOCK_BALANCES_RESPONSE = {
  View: {
    Account: {
      OnlineValue: 150000.5,
      OnlineCash: 5000.25,
      CurrencyCode: 'ILS',
      BalanceCacheDate: '2026-06-24T10:00:00Z',
      AccountPosition: {
        Balance: [
          {
            EquityNumber: 1234,
            OnlineNV: 100,
            LastRate: 50.5,
            OnlineVL: 5050,
            OnlineNisVL: 5050,
            AveragePrice: 48.0,
            AveragePriceProfitLoss: 250,
            AveragePriceProfitLossPercentage: 5.21,
            CurrencyCode: 'ILS',
          },
          {
            EquityNumber: 5678,
            OnlineNV: 10,
            BaseRate: 120.0, // no LastRate — should fall back to BaseRate
            OnlineVL: 1200,
            OnlineNisVL: 4200,
            AveragePrice: 115.0,
            AveragePriceProfitLoss: 50,
            AveragePriceProfitLossPercentage: 4.35,
            CurrencyCode: 'USD',
          },
        ],
      },
    },
    Meta: {
      Security: [
        {
          '-Key': 1234,
          HebName: 'מניית בדיקה',
          EngName: 'Test Stock',
          Symbol: 'TST',
          HebSymbol: 'בדיקה',
          ItemType: '1', // stock
          IsEtf: false,
        },
        {
          '-Key': 5678,
          HebName: null,
          EngName: 'US Bond Fund',
          Symbol: null,
          EngSymbol: 'UBND',
          ItemType: '2', // bond
          IsEtf: false,
        },
      ],
    },
  },
};

// ---------------------------------------------------------------------------
// Registration / SCRAPERS metadata
// ---------------------------------------------------------------------------
describe('Excellence scraper', () => {
  beforeAll(() => {
    extendAsyncTimeout();
  });

  test('should expose login fields in scrapers constant', () => {
    expect(SCRAPERS[CompanyTypes.excellence]).toBeDefined();
    expect(SCRAPERS[CompanyTypes.excellence].name).toBe('Excellence');
    expect(SCRAPERS[CompanyTypes.excellence].loginFields).toContain('username');
    expect(SCRAPERS[CompanyTypes.excellence].loginFields).toContain('password');
  });

  // ---------------------------------------------------------------------------
  // mapBalancesToPortfolioAccount unit tests
  // ---------------------------------------------------------------------------
  describe('mapBalancesToPortfolioAccount', () => {
    test('maps account-level totals correctly', () => {
      const result = mapBalancesToPortfolioAccount('00-000000', MOCK_BALANCES_RESPONSE);

      expect(result.accountNumber).toBe('00-000000');
      expect(result.totalValue).toBe(150000.5);
      expect(result.cash).toBe(5000.25);
      expect(result.baseCurrency).toBe('ILS');
    });

    test('maps positions correctly using Meta join on EquityNumber / -Key', () => {
      const result = mapBalancesToPortfolioAccount('00-000000', MOCK_BALANCES_RESPONSE);

      expect(result.positions).toHaveLength(2);

      const first = result.positions[0];
      expect(first.securityId).toBe('1234');
      expect(first.name).toBe('מניית בדיקה'); // HebName takes priority
      expect(first.symbol).toBe('TST');
      expect(first.quantity).toBe(100);
      expect(first.marketPrice).toBe(50.5); // from LastRate
      expect(first.marketValue).toBe(5050);
      expect(first.currency).toBe('ILS');
      expect(first.averageCost).toBe(48.0);
      expect(first.unrealizedPnl).toBe(250);
      expect(first.unrealizedPnlPct).toBe(5.21);
      expect(first.asOf).toBe('2026-06-24T10:00:00Z');
      expect(first.assetType).toBe(AssetType.Stock);
    });

    test('falls back to BaseRate when LastRate is absent', () => {
      const result = mapBalancesToPortfolioAccount('00-000000', MOCK_BALANCES_RESPONSE);
      const second = result.positions[1];

      expect(second.securityId).toBe('5678');
      expect(second.marketPrice).toBe(120.0); // from BaseRate
      expect(second.currency).toBe('USD');
      expect(second.assetType).toBe(AssetType.Bond);
    });

    test('falls back to EngName when HebName is absent/null', () => {
      const result = mapBalancesToPortfolioAccount('00-000000', MOCK_BALANCES_RESPONSE);
      const second = result.positions[1];

      expect(second.name).toBe('US Bond Fund');
      expect(second.symbol).toBe('UBND'); // EngSymbol fallback
    });

    test('omits rawPosition by default (includeRawTransaction not set)', () => {
      const result = mapBalancesToPortfolioAccount('00-000000', MOCK_BALANCES_RESPONSE);
      expect(result.positions[0].rawPosition).toBeUndefined();
    });

    test('includes rawPosition when includeRawTransaction is true', () => {
      const result = mapBalancesToPortfolioAccount('00-000000', MOCK_BALANCES_RESPONSE, {
        includeRawTransaction: true,
      });
      expect(result.positions[0].rawPosition).toBeDefined();
      expect(result.positions[0].rawPosition).not.toBeNull();
    });

    test('handles single Balance object (non-array) gracefully', () => {
      const singleBalance = {
        ...MOCK_BALANCES_RESPONSE,
        View: {
          ...MOCK_BALANCES_RESPONSE.View,
          Account: {
            ...MOCK_BALANCES_RESPONSE.View.Account,
            AccountPosition: {
              Balance: MOCK_BALANCES_RESPONSE.View.Account.AccountPosition.Balance[0],
            },
          },
          Meta: {
            Security: MOCK_BALANCES_RESPONSE.View.Meta.Security[0],
          },
        },
      };

      const result = mapBalancesToPortfolioAccount('00-000000', singleBalance);
      expect(result.positions).toHaveLength(1);
      expect(result.positions[0].securityId).toBe('1234');
    });

    test('handles empty/missing balances gracefully', () => {
      const empty = { View: { Account: { CurrencyCode: 'ILS' }, Meta: { Security: [] } } };
      const result = mapBalancesToPortfolioAccount('00-000000', empty);
      expect(result.positions).toHaveLength(0);
      expect(result.accountNumber).toBe('00-000000');
    });

    test('falls back to securityId as name when Meta is missing for that key', () => {
      const noMeta = {
        ...MOCK_BALANCES_RESPONSE,
        View: {
          ...MOCK_BALANCES_RESPONSE.View,
          Meta: { Security: [] }, // no meta at all
        },
      };
      const result = mapBalancesToPortfolioAccount('00-000000', noMeta);
      expect(result.positions[0].name).toBe('1234');
    });
  });

  // ---------------------------------------------------------------------------
  // mapAssetType unit tests
  // ---------------------------------------------------------------------------
  describe('mapAssetType', () => {
    test('returns Etf when IsEtf is true', () => {
      expect(mapAssetType({ '-Key': '1', IsEtf: true })).toBe(AssetType.Etf);
      expect(mapAssetType({ '-Key': '1', IsEtf: 1 })).toBe(AssetType.Etf);
      expect(mapAssetType({ '-Key': '1', IsEtf: '1' })).toBe(AssetType.Etf);
    });

    test('returns Bond for ItemType "2" or "bond"', () => {
      expect(mapAssetType({ '-Key': '1', ItemType: '2' })).toBe(AssetType.Bond);
      expect(mapAssetType({ '-Key': '1', ItemType: 'bond' })).toBe(AssetType.Bond);
    });

    test('returns Stock for ItemType "1" or "stock"', () => {
      expect(mapAssetType({ '-Key': '1', ItemType: '1' })).toBe(AssetType.Stock);
      expect(mapAssetType({ '-Key': '1', ItemType: 'stock' })).toBe(AssetType.Stock);
    });

    // Values confirmed against the live 2026-06-24 balances response.
    test('returns Stock for the live "Equity" ItemType label', () => {
      expect(mapAssetType({ '-Key': '1', ItemType: 'Equity', StockType: 'Equity', IsEtf: false })).toBe(
        AssetType.Stock,
      );
    });

    test('returns Fund for the live "Fund" ItemType label', () => {
      expect(mapAssetType({ '-Key': '1', ItemType: 'Fund', StockType: null, IsEtf: false })).toBe(AssetType.Fund);
    });

    test('returns Etf when StockType is "ETF" even if ItemType is Equity/Fund', () => {
      expect(mapAssetType({ '-Key': '1', ItemType: 'Equity', StockType: 'ETF', IsEtf: null })).toBe(AssetType.Etf);
      expect(mapAssetType({ '-Key': '1', ItemType: 'Fund', StockType: null, IsEtf: true })).toBe(AssetType.Etf);
    });

    test('returns Other for unknown ItemType', () => {
      expect(mapAssetType({ '-Key': '1', ItemType: '99' })).toBe(AssetType.Other);
    });
  });

  // ---------------------------------------------------------------------------
  // detectOtpChallenge unit tests
  // ---------------------------------------------------------------------------
  describe('detectOtpChallenge', () => {
    test('returns false when page is undefined', async () => {
      await expect(detectOtpChallenge(undefined)).resolves.toBe(false);
    });

    test('returns true when an OTP input is found', async () => {
      const mockPage: Pick<Page, '$'> = {
        $: jest.fn().mockImplementation((selector: string) => {
          if (selector === 'input[type="tel"]') return Promise.resolve({});
          return Promise.resolve(null);
        }),
      };
      await expect(detectOtpChallenge(mockPage as unknown as Page)).resolves.toBe(true);
    });

    test('returns false when no OTP elements are found', async () => {
      const mockPage: Pick<Page, '$'> = {
        $: jest.fn().mockResolvedValue(null),
      };
      await expect(detectOtpChallenge(mockPage as unknown as Page)).resolves.toBe(false);
    });

    test('returns false when page.$ throws', async () => {
      const mockPage: Pick<Page, '$'> = {
        $: jest.fn().mockRejectedValue(new Error('context destroyed')),
      };
      await expect(detectOtpChallenge(mockPage as unknown as Page)).resolves.toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // getLoginOptions — possibleResults sanity check (no browser required)
  // ---------------------------------------------------------------------------
  describe('getLoginOptions possibleResults', () => {
    function buildScraper() {
      return new ExcellenceScraper({
        companyId: CompanyTypes.excellence,
        startDate: new Date(),
      } as unknown as ScraperOptions);
    }

    test('Success result matches /app URL pattern', () => {
      const loginOptions = buildScraper().getLoginOptions({ username: 'u', password: 'p' });
      const successConditions = loginOptions.possibleResults[LoginResults.Success];
      expect(Array.isArray(successConditions)).toBe(true);

      const pattern = successConditions![0] as RegExp;
      expect(pattern).toBeInstanceOf(RegExp);
      expect(pattern.test('https://extradepro.xnes.co.il/app')).toBe(true);
      expect(pattern.test('https://extradepro.xnes.co.il/login')).toBe(false);
    });

    test('TwoFactorRetrieverMissing has a function detector', () => {
      const loginOptions = buildScraper().getLoginOptions({ username: 'u', password: 'p' });
      const tfConditions = loginOptions.possibleResults[LoginResults.TwoFactorRetrieverMissing];
      expect(Array.isArray(tfConditions)).toBe(true);
      expect(typeof tfConditions![0]).toBe('function');
    });
  });

  // ---------------------------------------------------------------------------
  // Real-API gated test (requires testsConfig.credentials.excellence)
  // ---------------------------------------------------------------------------
  maybeTestCompanyAPI(COMPANY_ID)('should scrape portfolio accounts', async () => {
    const options = {
      ...testsConfig.options,
      companyId: COMPANY_ID,
    };

    const scraper = new ExcellenceScraper(options);
    const result = await scraper.scrape(testsConfig.credentials.excellence);

    expect(result).toBeDefined();
    const error = `${result.errorType ?? ''} ${result.errorMessage ?? ''}`.trim();
    expect(error).toBe('');
    expect(result.success).toBe(true);
    expect(Array.isArray(result.portfolioAccounts)).toBe(true);
  });
});
