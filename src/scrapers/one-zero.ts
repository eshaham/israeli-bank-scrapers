import moment from 'moment/moment';
import { BaseTwoFactorAuthScraper, ScraperLoginResult } from './base-two-factor-auth-scraper';
import {
  ScraperGetLongTermTwoFactorTokenResult,
  ScraperScrapingResult, ScraperTwoFactorAuthTriggerResult,
} from './interface';
import { getDebug } from '../helpers/debug';
import { fetchGraphql, fetchPost } from '../helpers/fetch';
import { createGenericError, ScraperErrorTypes } from './errors';
import { GET_CUSTOMER, GET_MOVEMENTS } from './one-zero-queries';
import {
  Transaction as ScrapingTransaction,
  TransactionsAccount,
  TransactionStatuses,
  TransactionTypes,
} from '../transactions';

const debug = getDebug('one-zero');

type Account = {
  accountId: string;
};

type Portfolio = {
  accounts: Array<Account>;
  portfolioId: string;
  portfolioNum: string;
};

type Customer = {
  customerId: string;
  portfolios?: Array<Portfolio> | null;
};

export type Category = {
  categoryId: number;
  dataSource: string;
  subCategoryId?: number | null;
};

export type Recurrence = {
  dataSource: string;
  isRecurrent: boolean;
};

type TransactionEnrichment = {
  categories?: Category[] | null;
  recurrences?: Recurrence[] | null;
};

type Transaction = {
  enrichment?: TransactionEnrichment | null;
  // TODO: Get installments information here
  // transactionDetails: TransactionDetails;
};

type Movement = {
  accountId: string;
  bankCurrencyAmount: string;
  bookingDate: string;
  conversionRate: string;
  creditDebit: string;
  description: string;
  isReversed: boolean;
  movementAmount: string;
  movementCurrency: string;
  movementId: string;
  movementReversedId?: string|null;
  movementTimestamp: string;
  movementType: string;
  portfolioId: string;
  runningBalance: string;
  transaction?: Transaction | null;
  valueDate: string;
};

type QueryPagination = { hasMore: boolean, cursor: string };

const IDENTITY_SERVER_URL = 'https://identity.tfd-bank.com/v1/';

const GRAPHQL_API_URL = 'https://mobile.tfd-bank.com/mobile-graph/graphql';

type Credentials = {
  email: string;
  password: string;
} & ({
  otpCodeRetriever: () => Promise<string>;
  phoneNumber: string;
} | {
  otpLongTermToken: string;
});

export default class OneZeroScraper extends BaseTwoFactorAuthScraper<Credentials> {
  private otpContext?: string;

  private accessToken?: string;


  async triggerTwoFactorAuth(phoneNumber: string): Promise<ScraperTwoFactorAuthTriggerResult> {
    if (!phoneNumber.startsWith('+')) {
      return createGenericError('A full international phone number starting with + and a three digit country code is required');
    }

    debug('Fetching device token');
    const deviceTokenResponse = await fetchPost(`${IDENTITY_SERVER_URL}/devices/token`, {
      extClientId: 'mobile',
      os: 'Android',
    });

    const { resultData: { deviceToken } } = deviceTokenResponse;

    debug(`Sending OTP to phone number ${phoneNumber}`);

    const otpPrepareResponse = await fetchPost(`${IDENTITY_SERVER_URL}/otp/prepare`, {
      factorValue: phoneNumber,
      deviceToken,
      otpChannel: 'SMS_OTP',
    });

    const { resultData: { otpContext } } = otpPrepareResponse;

    this.otpContext = otpContext;

    return {
      success: true,
    };
  }

  public async getLongTermTwoFactorToken(otpCode: string): Promise<ScraperGetLongTermTwoFactorTokenResult> {
    if (!this.otpContext) {
      return createGenericError('triggerOtp was not called before calling getPermenantOtpToken()');
    }

    debug('Requesting OTP token');
    const otpVerifyResponse = await fetchPost(`${IDENTITY_SERVER_URL}/otp/verify`, {
      otpContext: this.otpContext,
      otpCode,
    });

    const { resultData: { otpToken } } = otpVerifyResponse;
    return otpToken;
  }

  private async resolveOtpToken(credentials: Credentials): Promise<ScraperGetLongTermTwoFactorTokenResult> {
    if ('otpLongTermToken' in credentials) {
      if (!credentials.otpLongTermToken) {
        return createGenericError('Invalid otpLongTermToken');
      }
      return { success: true, longTermTwoFactorAuthToken: credentials.otpLongTermToken };
    }

    if (!credentials.otpCodeRetriever) {
      return {
        success: false,
        errorType: ScraperErrorTypes.TwoFactorRetrieverMissing,
        errorMessage: 'otpCodeRetriever is required when otpPermanentToken is not provided',
      };
    }

    if (!credentials.phoneNumber) {
      return createGenericError('phoneNumber is required when providing a otpCodeRetriever callback');
    }

    debug('Triggering user supplied otpCodeRetriever callback');
    const triggerResult = await this.triggerTwoFactorAuth(credentials.phoneNumber);

    if (!triggerResult.success) {
      return triggerResult;
    }

    const otpCode = await credentials.otpCodeRetriever();

    const otpTokenResult = await this.getLongTermTwoFactorToken(otpCode);
    if (!otpTokenResult.success) {
      return otpTokenResult;
    }

    return { success: true, longTermTwoFactorAuthToken: otpTokenResult.longTermTwoFactorAuthToken };
  }

  async login(credentials: Credentials):
  Promise<ScraperLoginResult> {
    const otpTokenResult = await this.resolveOtpToken(credentials);
    if (!otpTokenResult.success) {
      return otpTokenResult;
    }


    debug('Requesting id token');
    const getIdTokenResponse = await fetchPost(`${IDENTITY_SERVER_URL}/getIdToken`, {
      otpSmsToken: otpTokenResult.longTermTwoFactorAuthToken,
      email: credentials.email,
      pass: credentials.password,
      pinCode: '',
    });

    const { resultData: { idToken } } = getIdTokenResponse;


    debug('Requesting session token');

    const getSessionTokenResponse = await fetchPost(`${IDENTITY_SERVER_URL}/sessions/token`, {
      idToken,
      pass: credentials.password,
    });

    const { resultData: { accessToken } } = getSessionTokenResponse;

    this.accessToken = accessToken;

    return {
      success: true,
      persistentOtpToken: otpTokenResult.longTermTwoFactorAuthToken,
    };
  }

  private async fetchPortfolioMovements(portfolio: Portfolio, startDate: Date): Promise<TransactionsAccount> {
    const account = portfolio.accounts[0];
    let cursor = null;
    const movements = [];


    while (!movements.length || new Date(movements[0].movementTimestamp) >= startDate) {
      debug(`Fetching transactions for account ${portfolio.portfolioNum}...`);
      const { movements: { movements: newMovements, pagination } }:
      {movements: { movements: Movement[], pagination: QueryPagination }} =
          await fetchGraphql(
            GRAPHQL_API_URL,
            GET_MOVEMENTS, {
              portfolioId: portfolio.portfolioId,
              accountId: account.accountId,
              language: 'HEBREW',
              pagination: {
                cursor,
                limit: 50,
              },
            },
            { authorization: `Bearer ${this.accessToken}` },
          );

      movements.unshift(...newMovements);
      cursor = pagination.cursor;
      if (!pagination.hasMore) {
        break;
      }
    }

    movements.sort((x, y) => new Date(x.movementTimestamp).valueOf() - new Date(y.movementTimestamp).valueOf());

    const matchingMovements = movements.filter((movement) => new Date(movement.movementTimestamp) >= startDate);
    return {
      accountNumber: portfolio.portfolioNum,
      balance: !movements.length ? 0 : parseFloat(movements[movements.length - 1].runningBalance),
      txns: matchingMovements.map((movement): ScrapingTransaction => {
        const hasInstallments = movement.transaction?.enrichment?.recurrences?.some((x) => x.isRecurrent);
        const modifier = movement.creditDebit === 'DEBIT' ? -1 : 1;
        return ({
          date: movement.valueDate,
          chargedAmount: (+movement.movementAmount) * modifier,
          chargedCurrency: movement.movementCurrency,
          originalAmount: (+movement.movementAmount) * modifier,
          originalCurrency: movement.movementCurrency,
          description: movement.description,
          processedDate: movement.movementTimestamp,
          status: TransactionStatuses.Completed,
          type: hasInstallments ? TransactionTypes.Installments : TransactionTypes.Normal,
        });
      }),
    };
  }

  async fetchData(): Promise<ScraperScrapingResult> {
    if (!this.accessToken) {
      return createGenericError('login() was not called');
    }

    const defaultStartMoment = moment().subtract(1, 'years').add(1, 'day');
    const startDate = this.options.startDate || defaultStartMoment.toDate();
    const startMoment = moment.max(defaultStartMoment, moment(startDate));

    debug('Fetching account list');
    const result = await fetchGraphql<{ customer: Customer[] }>(GRAPHQL_API_URL, GET_CUSTOMER, {}, { authorization: `Bearer ${this.accessToken}` });
    const portfolios = result.customer.flatMap((customer) => (customer.portfolios || []));

    return {
      success: true,
      accounts: await Promise.all(portfolios.map(
        (portfolio) => this.fetchPortfolioMovements(portfolio, startMoment.toDate()),
      )),
    };
  }
}
