import moment from 'moment';
import { type HTTPRequest, type Frame, type Page } from 'puppeteer';
import { getDebug } from '../helpers/debug';
import { clickButton, elementPresentOnPage, pageEval, waitUntilElementFound } from '../helpers/elements-interactions';
import { fetchPost } from '../helpers/fetch';
import { getCurrentUrl, waitForNavigation } from '../helpers/navigation';
import { getFromSessionStorage } from '../helpers/storage';
import { filterOldTransactions, getRawTransaction } from '../helpers/transactions';
import { waitUntil } from '../helpers/waiting';
import { TransactionStatuses, TransactionTypes, type Transaction, type TransactionsAccount } from '../transactions';
import { BaseScraperWithBrowser, LoginResults, type LoginOptions } from './base-scraper-with-browser';
import { type ScraperScrapingResult, type ScraperOptions } from './interface';
import _ from 'lodash';

const apiHeaders = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
  Origin: 'https://digital-web.cal-online.co.il',
  Referer: 'https://digital-web.cal-online.co.il',
  'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7',
  'Sec-Fetch-Site': 'same-site',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Dest': 'empty',
};
const LOGIN_URL = 'https://www.cal-online.co.il/';
const TRANSACTIONS_REQUEST_ENDPOINT =
  'https://api.cal-online.co.il/Transactions/api/transactionsDetails/getCardTransactionsDetails';
const FRAMES_REQUEST_ENDPOINT = 'https://api.cal-online.co.il/Frames/api/Frames/GetFrameStatus';
const PENDING_TRANSACTIONS_REQUEST_ENDPOINT =
  'https://api.cal-online.co.il/Transactions/api/approvals/getClearanceRequests';
const SSO_AUTHORIZATION_REQUEST_ENDPOINT = 'https://connect.cal-online.co.il/col-rest/calconnect/authentication/SSO';

const InvalidPasswordMessage = 'שם המשתמש או הסיסמה שהוזנו שגויים';

const debug = getDebug('visa-cal');

enum TrnTypeCode {
  regular = '5',
  credit = '6',
  installments = '8',
  standingOrder = '9',
}

interface ScrapedTransaction {
  amtBeforeConvAndIndex: number;
  branchCodeDesc: string;
  cashAccManagerName: null;
  cashAccountManager: null;
  cashAccountTrnAmt: number;
  chargeExternalToCardComment: string;
  comments: [];
  curPaymentNum: number;
  debCrdCurrencySymbol: CurrencySymbol;
  debCrdDate: string;
  debitSpreadInd: boolean;
  discountAmount: unknown;
  discountReason: unknown;
  immediateComments: [];
  isImmediateCommentInd: boolean;
  isImmediateHHKInd: boolean;
  isMargarita: boolean;
  isSpreadPaymenstAbroad: boolean;
  linkedComments: [];
  merchantAddress: string;
  merchantName: string;
  merchantPhoneNo: string;
  numOfPayments: number;
  onGoingTransactionsComment: string;
  refundInd: boolean;
  roundingAmount: unknown;
  roundingReason: unknown;
  tokenInd: 0;
  tokenNumberPart4: '';
  transCardPresentInd: boolean;
  transTypeCommentDetails: [];
  trnAmt: number;
  trnCurrencySymbol: CurrencySymbol;
  trnExacWay: number;
  trnIntId: string;
  trnNumaretor: number;
  trnPurchaseDate: string;
  trnType: string;
  trnTypeCode: TrnTypeCode;
  walletProviderCode: 0;
  walletProviderDesc: '';
  earlyPaymentInd: boolean;
}
interface ScrapedPendingTransaction {
  merchantID: string;
  merchantName: string;
  trnPurchaseDate: string;
  walletTranInd: number;
  transactionsOrigin: number;
  trnAmt: number;
  tpaApprovalAmount: unknown;
  trnCurrencySymbol: CurrencySymbol;
  trnTypeCode: TrnTypeCode;
  trnType: string;
  branchCodeDesc: string;
  transCardPresentInd: boolean;
  j5Indicator: string;
  numberOfPayments: number;
  firstPaymentAmount: number;
  transTypeCommentDetails: [];
}
interface InitResponse {
  result: {
    cards: {
      cardUniqueId: string;
      last4Digits: string;
      [key: string]: unknown;
    }[];
  };
}
type CurrencySymbol = string;
interface CardTransactionDetailsError {
  title: string;
  statusCode: number;
}
interface CardTransactionDetails extends CardTransactionDetailsError {
  result: {
    bankAccounts: {
      bankAccountNum: string;
      bankName: string;
      choiceExternalTransactions: any;
      currentBankAccountInd: boolean;
      debitDates: {
        basketAmountComment: unknown;
        choiceHHKDebit: number;
        date: string;
        debitReason: unknown;
        fixDebitAmount: number;
        fromPurchaseDate: string;
        isChoiceRepaiment: boolean;
        toPurchaseDate: string;
        totalBasketAmount: number;
        totalDebits: {
          currencySymbol: CurrencySymbol;
          amount: number;
        }[];
        transactions: ScrapedTransaction[];
      }[];
      immidiateDebits: { totalDebits: []; debitDays: [] };
    }[];
    blockedCardInd: boolean;
  };
  statusCode: 1;
  statusDescription: string;
  statusTitle: string;
}
interface CardPendingTransactionDetails extends CardTransactionDetailsError {
  result: {
    cardsList: {
      cardUniqueID: string;
      authDetalisList: ScrapedPendingTransaction[];
    }[];
  };
  statusCode: 1;
  statusDescription: string;
  statusTitle: string;
}

interface CardLevelFrame {
  cardUniqueId: string;
  nextTotalDebit?: number;
}

interface FramesResponse {
  result?: {
    bankIssuedCards?: {
      cardLevelFrames?: CardLevelFrame[];
    };
  };
}

interface AuthModule {
  auth: {
    calConnectToken: string | null;
  };
}

function isAuthModule(result: any): result is AuthModule {
  return Boolean(result?.auth?.calConnectToken && String(result.auth.calConnectToken).trim());
}

function authModuleOrUndefined(result: any): AuthModule | undefined {
  return isAuthModule(result) ? result : undefined;
}

function isPending(
  transaction: ScrapedTransaction | ScrapedPendingTransaction,
): transaction is ScrapedPendingTransaction {
  return (transaction as ScrapedTransaction).debCrdDate === undefined; // an arbitrary field that only appears in a completed transaction
}

function isCardTransactionDetails(
  result: CardTransactionDetails | CardTransactionDetailsError,
): result is CardTransactionDetails {
  return (result as CardTransactionDetails).result !== undefined;
}

function isCardPendingTransactionDetails(
  result: CardPendingTransactionDetails | CardTransactionDetailsError,
): result is CardPendingTransactionDetails {
  return (result as CardPendingTransactionDetails).result !== undefined;
}

async function getLoginFrame(page: Page) {
  let frame: Frame | null = null;
  debug('wait until login frame found');
  await waitUntil(
    () => {
      frame = page.frames().find(f => f.url().includes('connect')) || null;
      return Promise.resolve(!!frame);
    },
    'wait for iframe with login form',
    10000,
    1000,
  );

  if (!frame) {
    debug('failed to find login frame for 10 seconds');
    throw new Error('failed to extract login iframe');
  }

  return frame;
}

async function hasInvalidPasswordError(page: Page) {
  const frame = await getLoginFrame(page);
  const errorFound = await elementPresentOnPage(frame, 'div.general-error > div');
  const errorMessage = errorFound
    ? await pageEval(frame, 'div.general-error > div', '', item => {
        return (item as HTMLDivElement).innerText;
      })
    : '';
  return errorMessage === InvalidPasswordMessage;
}

async function hasChangePasswordForm(page: Page) {
  const frame = await getLoginFrame(page);
  const errorFound = await elementPresentOnPage(frame, '.change-password-subtitle');
  return errorFound;
}

function getPossibleLoginResults() {
  debug('return possible login results');
  const urls: LoginOptions['possibleResults'] = {
    [LoginResults.Success]: [/dashboard/i],
    [LoginResults.InvalidPassword]: [
      async (options?: { page?: Page }) => {
        const page = options?.page;
        if (!page) {
          return false;
        }
        return hasInvalidPasswordError(page);
      },
    ],
    // [LoginResults.AccountBlocked]: [], // TODO add when reaching this scenario
    [LoginResults.ChangePassword]: [
      async (options?: { page?: Page }) => {
        const page = options?.page;
        if (!page) {
          return false;
        }
        return hasChangePasswordForm(page);
      },
    ],
  };
  return urls;
}

function createLoginFields(credentials: ScraperSpecificCredentials) {
  debug('create login fields for username and password');
  return [
    { selector: '[formcontrolname="userName"]', value: credentials.username },
    { selector: '[formcontrolname="password"]', value: credentials.password },
  ];
}

function convertParsedDataToTransactions(
  data: CardTransactionDetails[],
  pendingData?: CardPendingTransactionDetails | null,
  options?: ScraperOptions,
): Transaction[] {
  const pendingTransactions = pendingData?.result
    ? pendingData.result.cardsList.flatMap(card => card.authDetalisList)
    : [];

  const bankAccounts = data.flatMap(monthData => monthData.result.bankAccounts);
  const regularDebitDays = bankAccounts.flatMap(accounts => accounts.debitDates);
  const immediateDebitDays = bankAccounts.flatMap(accounts => accounts.immidiateDebits.debitDays);
  const completedTransactions = [...regularDebitDays, ...immediateDebitDays].flatMap(
    debitDate => debitDate.transactions,
  );

  const all: (ScrapedTransaction | ScrapedPendingTransaction)[] = [...pendingTransactions, ...completedTransactions];

  return all.map(transaction => {
    const numOfPayments = isPending(transaction) ? transaction.numberOfPayments : transaction.numOfPayments;
    const installments = numOfPayments
      ? {
          number: isPending(transaction) ? 1 : transaction.curPaymentNum,
          total: numOfPayments,
        }
      : undefined;

    const date = moment(transaction.trnPurchaseDate);

    const chargedAmount = (isPending(transaction) ? transaction.trnAmt : transaction.amtBeforeConvAndIndex) * -1;
    const originalAmount = transaction.trnAmt * (transaction.trnTypeCode === TrnTypeCode.credit ? 1 : -1);

    const result: Transaction = {
      identifier: !isPending(transaction) ? transaction.trnIntId : undefined,
      type: [TrnTypeCode.regular, TrnTypeCode.standingOrder].includes(transaction.trnTypeCode)
        ? TransactionTypes.Normal
        : TransactionTypes.Installments,
      status: isPending(transaction) ? TransactionStatuses.Pending : TransactionStatuses.Completed,
      date: installments ? date.add(installments.number - 1, 'month').toISOString() : date.toISOString(),
      processedDate: isPending(transaction) ? date.toISOString() : new Date(transaction.debCrdDate).toISOString(),
      originalAmount,
      originalCurrency: transaction.trnCurrencySymbol,
      chargedAmount,
      chargedCurrency: !isPending(transaction) ? transaction.debCrdCurrencySymbol : undefined,
      description: transaction.merchantName,
      memo: transaction.transTypeCommentDetails.toString(),
      category: transaction.branchCodeDesc,
    };

    if (installments) {
      result.installments = installments;
    }

    if (options?.includeRawTransaction) {
      result.rawTransaction = getRawTransaction(transaction);
    }

    return result;
  });
}

type ScraperSpecificCredentials = { username: string; password: string };

class VisaCalScraper extends BaseScraperWithBrowser<ScraperSpecificCredentials> {
  private authorization: string | undefined = undefined;

  private authRequestPromise: Promise<HTTPRequest | undefined> | undefined;

  openLoginPopup = async () => {
    debug('open login popup, wait until login button available');
    await waitUntilElementFound(this.page, '#ccLoginDesktopBtn', true);
    debug('click on the login button');
    await clickButton(this.page, '#ccLoginDesktopBtn');
    debug('get the frame that holds the login');
    const frame = await getLoginFrame(this.page);
    debug('wait until the password login tab header is available');
    await waitUntilElementFound(frame, '#regular-login');
    debug('navigate to the password login tab');
    await clickButton(frame, '#regular-login');
    debug('wait until the password login tab is active');
    await waitUntilElementFound(frame, 'regular-login');

    return frame;
  };

  async getCards() {
    const initData = await waitUntil(
      () => getFromSessionStorage<InitResponse>(this.page, 'init'),
      'get init data in session storage',
      10000,
      1000,
    );
    if (!initData) {
      throw new Error('could not find "init" data in session storage');
    }
    return initData?.result.cards.map(({ cardUniqueId, last4Digits }) => ({ cardUniqueId, last4Digits }));
  }

  async getAuthorizationHeader() {
    if (!this.authorization) {
      debug('fetching authorization header');
      const authModule = await waitUntil(
        async () => authModuleOrUndefined(await getFromSessionStorage<AuthModule>(this.page, 'auth-module')),
        'get authorization header with valid token in session storage',
        10_000,
        50,
      );
      return `CALAuthScheme ${authModule.auth.calConnectToken}`;
    }
    return this.authorization;
  }

  async getXSiteId() {
    /*
      I don't know if the constant below will change in the feature.
      If so, use the next code:

      return this.page.evaluate(() => new Ut().xSiteId);

      To get the classname search for 'xSiteId' in the page source
      class Ut {
        constructor(_e, on, yn) {
            this.store = _e,
            this.config = on,
            this.eventBusService = yn,
            this.xSiteId = "09031987-273E-2311-906C-8AF85B17C8D9",
    */
    return Promise.resolve('09031987-273E-2311-906C-8AF85B17C8D9');
  }

  getLoginOptions(credentials: ScraperSpecificCredentials): LoginOptions {
    this.authRequestPromise = this.page
      .waitForRequest(SSO_AUTHORIZATION_REQUEST_ENDPOINT, { timeout: 10_000 })
      .catch(e => {
        debug('error while waiting for the token request', e);
        return undefined;
      });
    return {
      loginUrl: `${LOGIN_URL}`,
      fields: createLoginFields(credentials),
      submitButtonSelector: 'button[type="submit"]',
      possibleResults: getPossibleLoginResults(),
      checkReadiness: async () => waitUntilElementFound(this.page, '#ccLoginDesktopBtn'),
      preAction: this.openLoginPopup,
      postAction: async () => {
        try {
          await waitForNavigation(this.page);
          const currentUrl = await getCurrentUrl(this.page);
          if (currentUrl.endsWith('site-tutorial')) {
            await clickButton(this.page, 'button.btn-close');
          }
          const request = await this.authRequestPromise;
          this.authorization = String(request?.headers().authorization || '').trim();
        } catch (e) {
          const currentUrl = await getCurrentUrl(this.page);
          if (currentUrl.endsWith('dashboard')) return;
          const requiresChangePassword = await hasChangePasswordForm(this.page);
          if (requiresChangePassword) return;
          throw e;
        }
      },
      userAgent: apiHeaders['User-Agent'],
    };
  }

  async fetchData(): Promise<ScraperScrapingResult> {
    const defaultStartMoment = moment().subtract(1, 'years').subtract(6, 'months').add(1, 'day');
    const startDate = this.options.startDate || defaultStartMoment.toDate();
    const startMoment = moment.max(defaultStartMoment, moment(startDate));
    debug(`fetch transactions starting ${startMoment.format()}`);

    const [cards, xSiteId, Authorization] = await Promise.all([
      this.getCards(),
      this.getXSiteId(),
      this.getAuthorizationHeader(),
    ]);

    const futureMonthsToScrape = this.options.futureMonthsToScrape ?? 1;

    debug('fetch frames (misgarot) of cards');
    const frames = await fetchPost<FramesResponse>(
      FRAMES_REQUEST_ENDPOINT,
      { cardsForFrameData: cards.map(({ cardUniqueId }) => ({ cardUniqueId })) },
      {
        Authorization,
        'X-Site-Id': xSiteId,
        'Content-Type': 'application/json',
        ...apiHeaders,
      },
    );

    const accounts = await Promise.all(
      cards.map(async card => {
        const finalMonthToFetchMoment = moment().add(futureMonthsToScrape, 'month');
        const months = finalMonthToFetchMoment.diff(startMoment, 'months');
        const allMonthsData: CardTransactionDetails[] = [];
        const frame = _.find(frames.result?.bankIssuedCards?.cardLevelFrames, { cardUniqueId: card.cardUniqueId });

        debug(`fetch pending transactions for card ${card.cardUniqueId}`);
        let pendingData = await fetchPost(
          PENDING_TRANSACTIONS_REQUEST_ENDPOINT,
          { cardUniqueIDArray: [card.cardUniqueId] },
          {
            Authorization,
            'X-Site-Id': xSiteId,
            'Content-Type': 'application/json',
            ...apiHeaders,
          },
        );

        debug(`fetch completed transactions for card ${card.cardUniqueId}`);
        for (let i = 0; i <= months; i++) {
          const month = finalMonthToFetchMoment.clone().subtract(i, 'months');
          const monthData = await fetchPost(
            TRANSACTIONS_REQUEST_ENDPOINT,
            { cardUniqueId: card.cardUniqueId, month: month.format('M'), year: month.format('YYYY') },
            {
              Authorization,
              'X-Site-Id': xSiteId,
              'Content-Type': 'application/json',
              ...apiHeaders,
            },
          );

          if (monthData?.statusCode !== 1)
            throw new Error(
              `failed to fetch transactions for card ${card.last4Digits}. Message: ${monthData?.title || ''}`,
            );

          if (!isCardTransactionDetails(monthData)) {
            throw new Error('monthData is not of type CardTransactionDetails');
          }

          allMonthsData.push(monthData);
        }

        if (pendingData?.statusCode !== 1 && pendingData?.statusCode !== 96) {
          debug(
            `failed to fetch pending transactions for card ${card.last4Digits}. Message: ${pendingData?.title || ''}`,
          );
          pendingData = null;
        } else if (!isCardPendingTransactionDetails(pendingData)) {
          debug('pendingData is not of type CardTransactionDetails');
          pendingData = null;
        }

        const transactions = convertParsedDataToTransactions(allMonthsData, pendingData, this.options);

        debug('filter out old transactions');
        const txns =
          (this.options.outputData?.enableTransactionsFilterByDate ?? true)
            ? filterOldTransactions(transactions, moment(startDate), this.options.combineInstallments || false)
            : transactions;

        return {
          txns,
          balance: frame?.nextTotalDebit != null ? -frame.nextTotalDebit : undefined,
          accountNumber: card.last4Digits,
        } as TransactionsAccount;
      }),
    );

    debug('return the scraped accounts');

    debug(JSON.stringify(accounts, null, 2));
    return {
      success: true,
      accounts,
    };
  }
}

export default VisaCalScraper;
