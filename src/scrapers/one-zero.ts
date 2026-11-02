import moment from 'moment/moment';
import { getDebug } from '../helpers/debug';
import { fetchGraphql, fetchPost } from '../helpers/fetch';
import { getRawTransaction } from '../helpers/transactions';
import {
  type Transaction as ScrapingTransaction,
  TransactionStatuses,
  TransactionTypes,
  type TransactionsAccount,
} from '../transactions';
import { BaseScraper } from './base-scraper';
import { ScraperErrorTypes, createGenericError } from './errors';
import {
  type ScraperGetLongTermTwoFactorTokenResult,
  type ScraperLoginResult,
  type ScraperScrapingResult,
  type ScraperTwoFactorAuthTriggerResult,
} from './interface';
import { ONE_ZERO_CLIENT_CERT } from './one-zero-client-cert';
import { GET_CUSTOMER, GET_MOVEMENTS } from './one-zero-queries';

const HEBREW_WORDS_REGEX = /[\u0590-\u05FF][\u0590-\u05FF"'\-_ /\\]*[\u0590-\u05FF]/g;

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
  movementReversedId?: string | null;
  movementTimestamp: string;
  movementType: string;
  portfolioId: string;
  runningBalance: string;
  transaction?: Transaction | null;
  valueDate: string;
};

type QueryPagination = { hasMore: boolean; cursor: string };

const IDENTITY_SERVER_URL = 'https://identity.tfd-bank.com/v1';

const GRAPHQL_API_URL = 'https://mobile.tfd-bank.com/mobile-graph/graphql';

const ONE_ZERO_HEADERS = {
  'User-Agent': 'ONEZEROIL/4.7.0(564) Lokalize/0 (Android 11 ; Pixel 3) MTLS',
};

function parseJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const [, payloadPart] = token.split('.');
    if (!payloadPart) {
      return null;
    }
    return JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function isIdToken(token: string): boolean {
  return parseJwtPayload(token)?.tokenType === 'idToken';
}

function mapIdentityError(errorType: string | undefined, isSavedJwtToken: boolean): ScraperLoginResult {
  if (
    errorType &&
    ['ErrorPassLocked', 'ErrorFactorLocked', 'ErrorEPLocked', 'ErrorMaxRetryReached'].includes(errorType)
  ) {
    return {
      success: false,
      errorType: ScraperErrorTypes.AccountBlocked,
      errorMessage: errorType,
    };
  }
  if (errorType === 'ErrorForceChangePass') {
    return {
      success: false,
      errorType: ScraperErrorTypes.ChangePassword,
      errorMessage: errorType,
    };
  }
  if (isSavedJwtToken && (errorType === 'ErrorInvalidToken' || errorType === 'ErrorIdTokenRevoke')) {
    return {
      success: false,
      errorType: ScraperErrorTypes.TwoFactorRetrieverMissing,
      errorMessage: 'Saved OneZero authentication token expired or was revoked; SMS OTP verification is required',
    };
  }
  return {
    success: false,
    errorType: ScraperErrorTypes.InvalidPassword,
    errorMessage: errorType || 'OneZero authentication failed',
  };
}

type ScraperSpecificCredentials = { email: string; password: string } & (
  | {
      otpCodeRetriever: () => Promise<string>;
      phoneNumber: string;
    }
  | {
      otpLongTermToken: string;
    }
  | {
      idToken: string;
    }
);

export default class OneZeroScraper extends BaseScraper<ScraperSpecificCredentials> {
  private otpContext?: string;

  private accessToken?: string;

  /**
   * Long-lived (~10 year) device-bound token returned by `/v1/getIdToken`.
   * Reusing this token in `credentials.idToken` or `credentials.otpLongTermToken`
   * allows subsequent logins to go directly to `/v1/sessions/token` without SMS OTP.
   */
  public idToken?: string;

  async triggerTwoFactorAuth(phoneNumber: string): Promise<ScraperTwoFactorAuthTriggerResult> {
    if (!phoneNumber.startsWith('+')) {
      return createGenericError(
        'A full international phone number starting with + and a three digit country code is required',
      );
    }

    debug('Fetching device token');
    const deviceTokenResponse = await fetchPost(
      `${IDENTITY_SERVER_URL}/devices/token`,
      {
        extClientId: 'mobile',
        os: 'Android',
      },
      ONE_ZERO_HEADERS,
      ONE_ZERO_CLIENT_CERT,
    );

    const {
      resultData: { deviceToken },
    } = deviceTokenResponse;

    debug(`Sending OTP to phone number ${phoneNumber}`);

    const otpPrepareResponse = await fetchPost(
      `${IDENTITY_SERVER_URL}/otp/prepare`,
      {
        factorValue: phoneNumber,
        deviceToken,
        otpChannel: 'SMS_OTP',
      },
      ONE_ZERO_HEADERS,
      ONE_ZERO_CLIENT_CERT,
    );

    const {
      resultData: { otpContext },
    } = otpPrepareResponse;

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
    const otpVerifyResponse = await fetchPost(
      `${IDENTITY_SERVER_URL}/otp/verify`,
      {
        otpContext: this.otpContext,
        otpCode,
      },
      ONE_ZERO_HEADERS,
      ONE_ZERO_CLIENT_CERT,
    );

    const {
      resultData: { otpToken },
    } = otpVerifyResponse;
    return { success: true, longTermTwoFactorAuthToken: otpToken };
  }

  private async resolveOtpToken(
    credentials: Exclude<ScraperSpecificCredentials, { idToken: string }>,
  ): Promise<ScraperGetLongTermTwoFactorTokenResult> {
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

  async login(credentials: ScraperSpecificCredentials): Promise<ScraperLoginResult> {
    let idToken: string;

    if ('idToken' in credentials) {
      if (!credentials.idToken) {
        return createGenericError('Invalid idToken');
      }
      debug('Reusing saved idToken, skipping SMS verification');
      idToken = credentials.idToken;
    } else {
      const otpTokenResult = await this.resolveOtpToken(credentials);
      if (!otpTokenResult.success) {
        return otpTokenResult;
      }

      if (isIdToken(otpTokenResult.longTermTwoFactorAuthToken)) {
        debug('Reusing saved idToken from otpLongTermToken, skipping getIdToken');
        idToken = otpTokenResult.longTermTwoFactorAuthToken;
      } else {
        debug('Requesting id token');
        const getIdTokenResponse = await fetchPost(
          `${IDENTITY_SERVER_URL}/getIdToken`,
          {
            otpSmsToken: otpTokenResult.longTermTwoFactorAuthToken,
            email: credentials.email,
            pass: credentials.password,
            pinCode: '',
          },
          ONE_ZERO_HEADERS,
          ONE_ZERO_CLIENT_CERT,
        );

        if (!getIdTokenResponse?.resultData?.idToken) {
          const isSavedJwt = Boolean(parseJwtPayload(otpTokenResult.longTermTwoFactorAuthToken));
          return mapIdentityError(getIdTokenResponse?.errorResponse?.type, isSavedJwt);
        }

        idToken = getIdTokenResponse.resultData.idToken;
      }
    }

    this.idToken = idToken;

    debug('Requesting session token');

    const getSessionTokenResponse = await fetchPost(
      `${IDENTITY_SERVER_URL}/sessions/token`,
      {
        idToken,
        pass: credentials.password,
      },
      ONE_ZERO_HEADERS,
      ONE_ZERO_CLIENT_CERT,
    );

    if (!getSessionTokenResponse?.resultData?.accessToken) {
      return mapIdentityError(getSessionTokenResponse?.errorResponse?.type, Boolean(parseJwtPayload(idToken)));
    }

    const {
      resultData: { accessToken },
    } = getSessionTokenResponse;

    this.accessToken = accessToken;

    return {
      success: true,
      persistentOtpToken: idToken,
    };
  }

  private async fetchPortfolioMovements(portfolio: Portfolio, startDate: Date): Promise<TransactionsAccount> {
    // TODO: Find out if we need the other accounts, there seems to always be one
    const account = portfolio.accounts[0];
    let cursor = null;
    const movements = [];

    while (!movements.length || new Date(movements[0].movementTimestamp) >= startDate) {
      debug(`Fetching transactions for account ${portfolio.portfolioNum}...`);
      const {
        movements: { movements: newMovements, pagination },
      }: { movements: { movements: Movement[]; pagination: QueryPagination } } = await fetchGraphql(
        GRAPHQL_API_URL,
        GET_MOVEMENTS,
        {
          portfolioId: portfolio.portfolioId,
          accountId: account.accountId,
          language: 'HEBREW',
          pagination: {
            cursor,
            limit: 50,
          },
        },
        { ...ONE_ZERO_HEADERS, authorization: `Bearer ${this.accessToken}` },
        ONE_ZERO_CLIENT_CERT,
      );

      movements.unshift(...newMovements);
      cursor = pagination.cursor;
      if (!pagination.hasMore) {
        break;
      }
    }

    movements.sort((x, y) => new Date(x.movementTimestamp).valueOf() - new Date(y.movementTimestamp).valueOf());

    const matchingMovements = movements.filter(movement => new Date(movement.movementTimestamp) >= startDate);
    return {
      accountNumber: portfolio.portfolioNum,
      balance: !movements.length ? 0 : parseFloat(movements[movements.length - 1].runningBalance),
      txns: matchingMovements.map((movement): ScrapingTransaction => {
        const hasInstallments = movement.transaction?.enrichment?.recurrences?.some(x => x.isRecurrent);
        const modifier = movement.creditDebit === 'DEBIT' ? -1 : 1;
        const result: ScrapingTransaction = {
          identifier: movement.movementId,
          date: movement.valueDate,
          chargedAmount: +movement.movementAmount * modifier,
          chargedCurrency: movement.movementCurrency,
          originalAmount: +movement.movementAmount * modifier,
          originalCurrency: movement.movementCurrency,
          description: this.sanitizeHebrew(movement.description),
          processedDate: movement.movementTimestamp,
          status: TransactionStatuses.Completed,
          type: hasInstallments ? TransactionTypes.Installments : TransactionTypes.Normal,
        };

        if (this.options?.includeRawTransaction) {
          result.rawTransaction = getRawTransaction(movement);
        }

        return result;
      }),
    };
  }

  /**
   * one zero hebrew strings are reversed with a unicode control character that forces display in LTR order
   * We need to remove the unicode control character, and then reverse hebrew substrings inside the string
   */
  private sanitizeHebrew(text: string) {
    if (!text.includes('\u202d')) {
      return text.trim();
    }

    const plainString = text.replace(/\u202d/gi, '').trim();
    const hebrewSubStringsRanges = [...plainString.matchAll(HEBREW_WORDS_REGEX)];
    const rangesToReverse = hebrewSubStringsRanges.map(str => ({ start: str.index!, end: str.index! + str[0].length }));
    const out = [];
    let index = 0;

    for (const { start, end } of rangesToReverse) {
      out.push(...plainString.substring(index, start));
      index += start - index;
      const reversed = [...plainString.substring(start, end)].reverse();
      out.push(...reversed);
      index += end - start;
    }

    out.push(...plainString.substring(index, plainString.length));

    return out.join('');
  }

  async fetchData(): Promise<ScraperScrapingResult> {
    if (!this.accessToken) {
      return createGenericError('login() was not called');
    }

    const defaultStartMoment = moment().subtract(1, 'years').add(1, 'day');
    const startDate = this.options.startDate || defaultStartMoment.toDate();
    const startMoment = moment.max(defaultStartMoment, moment(startDate));

    debug('Fetching account list');
    const result = await fetchGraphql<{ customer: Customer[] }>(
      GRAPHQL_API_URL,
      GET_CUSTOMER,
      {},
      { ...ONE_ZERO_HEADERS, authorization: `Bearer ${this.accessToken}` },
      ONE_ZERO_CLIENT_CERT,
    );
    const portfolios = result.customer.flatMap(customer => customer.portfolios || []);

    return {
      success: true,
      accounts: await Promise.all(
        portfolios.map(portfolio => this.fetchPortfolioMovements(portfolio, startMoment.toDate())),
      ),
    };
  }
}
