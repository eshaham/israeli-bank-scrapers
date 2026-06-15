import moment from 'moment/moment';
import { getDebug } from '../helpers/debug';
import { mobileFetchGraphql, mobileFetchPost } from '../helpers/mobile-fetch';
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
import { GET_CARD_ACTIVITY, GET_CARDS_DETAILS, GET_CUSTOMER, GET_MOVEMENTS } from './one-zero-queries';

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

type CardAmount = {
  amount: number;
  currency: string;
};

type CardBaseDetails = {
  cardId: string;
  lastFourDigits: string;
  cardType: string;
  cardStatus: string;
  currency: string;
  localFirstName: string;
  localLastName: string;
  provider: string;
};

type CardDetail = {
  baseDetails: CardBaseDetails;
};

type CardTransaction = {
  transactionId: string;
  merchantName: string;
  purchaseDate: string;
  paymentDate: string | null;
  debitAmount: CardAmount | null;
  originalAmount: CardAmount | null;
  direction: string;
  status: string;
  type: string;
  numberOfPayments: number | null;
  paymentNumber: number | null;
};

const IDENTITY_SERVER_URL = 'https://identity.tfd-bank.com/v1';

const GRAPHQL_API_URL = 'https://mobile.tfd-bank.com/mobile-graph/graphql';

type ScraperSpecificCredentials = { email: string; password: string } & (
  | {
      otpCodeRetriever: () => Promise<string>;
      phoneNumber: string;
    }
  | {
      otpLongTermToken: string;
    }
);

export default class OneZeroScraper extends BaseScraper<ScraperSpecificCredentials> {
  private otpContext?: string;

  private accessToken?: string;

  async triggerTwoFactorAuth(phoneNumber: string): Promise<ScraperTwoFactorAuthTriggerResult> {
    if (!phoneNumber.startsWith('+')) {
      return createGenericError(
        'A full international phone number starting with + and a three digit country code is required',
      );
    }

    debug('Fetching device token');
    const deviceTokenResponse = await mobileFetchPost(`${IDENTITY_SERVER_URL}/devices/token`, {
      extClientId: 'mobile',
      os: 'Android',
    });

    const {
      resultData: { deviceToken },
    } = deviceTokenResponse;

    debug(`Sending OTP to phone number ${phoneNumber}`);

    const otpPrepareResponse = await mobileFetchPost(`${IDENTITY_SERVER_URL}/otp/prepare`, {
      factorValue: phoneNumber,
      deviceToken,
      otpChannel: 'SMS_OTP',
    });

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
    const otpVerifyResponse = await mobileFetchPost(`${IDENTITY_SERVER_URL}/otp/verify`, {
      otpContext: this.otpContext,
      otpCode,
    });

    const {
      resultData: { otpToken },
    } = otpVerifyResponse;
    return { success: true, longTermTwoFactorAuthToken: otpToken };
  }

  private async resolveOtpToken(
    credentials: ScraperSpecificCredentials,
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
    const otpTokenResult = await this.resolveOtpToken(credentials);
    if (!otpTokenResult.success) {
      return otpTokenResult;
    }

    debug('Requesting id token');
    const getIdTokenResponse = await mobileFetchPost(`${IDENTITY_SERVER_URL}/getIdToken`, {
      otpSmsToken: otpTokenResult.longTermTwoFactorAuthToken,
      email: credentials.email,
      pass: credentials.password,
      pinCode: '',
    });

    const {
      resultData: { idToken },
    } = getIdTokenResponse;

    debug('Requesting session token');

    const getSessionTokenResponse = await mobileFetchPost(`${IDENTITY_SERVER_URL}/sessions/token`, {
      idToken,
      pass: credentials.password,
    });

    const {
      resultData: { accessToken },
    } = getSessionTokenResponse;

    this.accessToken = accessToken;

    return {
      success: true,
      persistentOtpToken: otpTokenResult.longTermTwoFactorAuthToken,
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
      }: { movements: { movements: Movement[]; pagination: QueryPagination } } = await mobileFetchGraphql(
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
        { authorization: `Bearer ${this.accessToken}` },
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

  private async fetchCreditCardAccounts(portfolioId: string, startDate: Date): Promise<TransactionsAccount[]> {
    debug('Fetching credit cards list');
    const cardsResult = await mobileFetchGraphql<{ cardsDetailsV3: { cardsDetails: CardDetail[] } }>(
      GRAPHQL_API_URL,
      GET_CARDS_DETAILS,
      { portfolioId },
      { authorization: `Bearer ${this.accessToken}` },
    );

    const cards = cardsResult.cardsDetailsV3.cardsDetails.filter(card => card.baseDetails.cardStatus === 'ACTIVE');

    const accounts: TransactionsAccount[] = [];

    for (const card of cards) {
      const { cardId, lastFourDigits, localFirstName, localLastName } = card.baseDetails;
      const allTransactions: CardTransaction[] = [];

      const now = new Date();
      let year = now.getFullYear();
      let month = now.getMonth() + 1;
      const startYear = startDate.getFullYear();
      const startMonth = startDate.getMonth() + 1;

      while (year > startYear || (year === startYear && month >= startMonth)) {
        debug(`Fetching card activity for *${lastFourDigits}, ${year}-${month}`);
        try {
          const activityResult = await mobileFetchGraphql<{
            cardActivityV3: { transactions: CardTransaction[] };
          }>(
            GRAPHQL_API_URL,
            GET_CARD_ACTIVITY,
            { cardId, billingYear: year, billingMonth: month },
            { authorization: `Bearer ${this.accessToken}` },
          );
          allTransactions.push(...activityResult.cardActivityV3.transactions);
        } catch (e) {
          debug(`Failed to fetch card activity for *${lastFourDigits}, ${year}-${month}: ${String(e)}`);
        }
        month -= 1;
        if (month === 0) {
          month = 12;
          year -= 1;
        }
      }

      const matchingTransactions = allTransactions
        .filter(txn => new Date(txn.purchaseDate) >= startDate)
        .sort((a, b) => new Date(a.purchaseDate).valueOf() - new Date(b.purchaseDate).valueOf());

      accounts.push({
        accountNumber: `*${lastFourDigits} ${localFirstName} ${localLastName}`,
        txns: matchingTransactions.map((txn): ScrapingTransaction => {
          const modifier = txn.direction === 'DEBIT' ? -1 : 1;
          const isInstallment = (txn.numberOfPayments ?? 0) > 1;
          const result: ScrapingTransaction = {
            identifier: txn.transactionId,
            date: txn.purchaseDate,
            processedDate: txn.paymentDate ?? txn.purchaseDate,
            chargedAmount: (txn.debitAmount?.amount ?? 0) * modifier,
            chargedCurrency: txn.debitAmount?.currency ?? 'ILS',
            originalAmount: (txn.originalAmount?.amount ?? 0) * modifier,
            originalCurrency: txn.originalAmount?.currency ?? txn.debitAmount?.currency ?? 'ILS',
            description: txn.merchantName,
            status: txn.status === 'BOOKED' ? TransactionStatuses.Completed : TransactionStatuses.Pending,
            type: isInstallment ? TransactionTypes.Installments : TransactionTypes.Normal,
            ...(isInstallment && {
              installments: {
                number: txn.paymentNumber ?? 1,
                total: txn.numberOfPayments ?? 1,
              },
            }),
          };

          if (this.options?.includeRawTransaction) {
            result.rawTransaction = getRawTransaction(txn);
          }

          return result;
        }),
      });
    }

    return accounts;
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
    const result = await mobileFetchGraphql<{ customer: Customer[] }>(
      GRAPHQL_API_URL,
      GET_CUSTOMER,
      {},
      { authorization: `Bearer ${this.accessToken}` },
    );
    const portfolios = result.customer.flatMap(customer => customer.portfolios || []);

    const accounts = await Promise.all(
      portfolios.map(portfolio => this.fetchPortfolioMovements(portfolio, startMoment.toDate())),
    );

    if (this.options.optInFeatures?.includes('oneZero:includeCreditCards')) {
      debug('Fetching credit card transactions (opt-in)');
      for (const portfolio of portfolios) {
        const cardAccounts = await this.fetchCreditCardAccounts(portfolio.portfolioId, startMoment.toDate());
        accounts.push(...cardAccounts);
      }
    }

    return {
      success: true,
      accounts,
    };
  }
}
