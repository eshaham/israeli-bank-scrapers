import moment, { type Moment } from 'moment';
import { type Page } from 'puppeteer';
import { SHEKEL_CURRENCY } from '../constants';
import { ScraperProgressTypes } from '../definitions';
import { interceptionPriorities, maskHeadlessUserAgent } from '../helpers/browser';
import getAllMonthMoments from '../helpers/dates';
import { getDebug } from '../helpers/debug';
import { fetchPostWithinPage } from '../helpers/fetch';
import { filterOldTransactions, fixInstallments, getRawTransaction } from '../helpers/transactions';
import { randomDelay } from '../helpers/waiting';
import {
  TransactionStatuses,
  TransactionTypes,
  type Transaction,
  type TransactionInstallments,
  type TransactionsAccount,
} from '../transactions';
import { BaseScraperWithBrowser } from './base-scraper-with-browser';
import { ScraperErrorTypes } from './errors';
import { type ScraperOptions, type ScraperScrapingResult } from './interface';

const GET_CARD_LIST_COMPANY_CODE = '99';
const CARD_SUFFIX_LENGTH = 4;
const COUNTRY_CODE = '212';
const ID_TYPE = '1';

const DATE_FORMAT = 'DD/MM/YYYY';
const BILLING_MONTH_FORMAT = 'MM/YYYY';

const RATE_LIMIT = {
  SLEEP_BETWEEN: 2500,
} as const;

const JSON_HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json' };

const debug = getDebug('isracard-group');

interface ScrapedLoginValidation {
  Header: {
    Status: string;
  };
  ValidateIdDataBean?: {
    userName?: string;
    returnCode: string;
  };
}

export interface ScrapedCard {
  companyCode: string;
  cardStatus: string;
  cardSuffix: string;
  serviceType: string;
  isActive: boolean;
  isBlock: boolean;
  isPartner: boolean;
  limitData?: {
    creditLimitAmount: string;
    limitUsed: string;
  };
  cardChargeNext?: {
    billingDate: string;
  };
}

interface ScrapedCardListResponse {
  data: {
    cardsList: ScrapedCard[];
  } | null;
  errorCode: string;
  errorDescription: string | null;
  isSuccess: boolean;
}

interface ScrapedMonthlyBillingResponse {
  data: {
    cards: Record<string, { billingDate: string }>;
  } | null;
  errorCode: string;
  errorDescription: string | null;
  isSuccess: boolean;
}

export interface ScrapedApprovedTransaction {
  purchaseDate: string;
  israelTransactionTime: string;
  businessName: string;
  originalAmount: number;
  currencyIso: string;
  ilsBillingAmount: number;
  extraDetails: string | null;
  seqConfirmationNumber: string;
  branchCodeDescription: string | null;
}

export interface ScrapedVoucher {
  purchaseDate: string;
  purchaseTime: string | null;
  businessName: string;
  originalAmount: number;
  originalCurrencyIso: string;
  billingAmount: number;
  moreInfo: string | null;
  seqVoucherNumber: string;
  currentInstallmentNum: number | null;
  numberOfInstallment: number | null;
  transactionDescription: string | null;
}

interface ScrapedOutOfStatementGroup {
  immediateVouchersCurrencyDate: ScrapedVoucher[];
  totalVouchersCurrencyDate: {
    dateImmediateVouchers?: string;
  };
}

interface ScrapedTransactionsResponse {
  data: {
    approvals: { approvedTransactions: ScrapedApprovedTransaction[] } | null;
    israelAbroadVouchers: {
      vouchers: {
        israelAbroadVouchersList: ScrapedVoucher[];
      };
      outOfStatementChargeDateVouchers: ScrapedOutOfStatementGroup[];
    } | null;
  } | null;
  errorCode: string;
  errorDescription: string | null;
  isSuccess: boolean;
}

export function getCardBalance(card: ScrapedCard): number | undefined {
  if (!card.limitData) {
    return undefined;
  }
  const limitUsed = Number(card.limitData.limitUsed);
  return Number.isNaN(limitUsed) ? undefined : -limitUsed;
}

export function getCardFrame(card: ScrapedCard): number | undefined {
  if (!card.limitData) {
    return undefined;
  }
  const creditLimit = Number(card.limitData.creditLimitAmount);
  return Number.isNaN(creditLimit) ? undefined : creditLimit;
}

export function getCardBalanceDate(card: ScrapedCard): string | undefined {
  if (!card.cardChargeNext?.billingDate) {
    return undefined;
  }
  return moment(card.cardChargeNext.billingDate, DATE_FORMAT).toISOString();
}

async function fetchGroupCards(page: Page, cardListUrl: string, loginCompanyCode: string): Promise<ScrapedCard[]> {
  debug('fetching card list');
  const response = await fetchPostWithinPage<ScrapedCardListResponse>(
    page,
    cardListUrl,
    { companyCode: GET_CARD_LIST_COMPANY_CODE, cardSuffixLength: CARD_SUFFIX_LENGTH },
    JSON_HEADERS,
  );

  if (!response || !response.isSuccess || !response.data) {
    throw new Error(`failed to fetch card list: ${response?.errorDescription ?? 'unknown error'}`);
  }

  return response.data.cardsList.filter(
    card => card.companyCode === loginCompanyCode && card.isActive && !card.isBlock,
  );
}

async function fetchEffectiveBillingDate(
  page: Page,
  monthlyBillingUrl: string,
  transactionsCompanyCode: number,
  card: ScrapedCard,
  monthMoment: Moment,
): Promise<string | undefined> {
  const billingDate = monthMoment.format(BILLING_MONTH_FORMAT);

  debug(`fetching effective billing date for card ${card.cardSuffix}, ${billingDate}`);
  await randomDelay(RATE_LIMIT.SLEEP_BETWEEN, RATE_LIMIT.SLEEP_BETWEEN + 500);

  const response = await fetchPostWithinPage<ScrapedMonthlyBillingResponse>(
    page,
    monthlyBillingUrl,
    {
      cards: [
        {
          cardStatus: Number(card.cardStatus),
          cardSuffix: card.cardSuffix,
          companyCode: transactionsCompanyCode,
          serviceType: Number(card.serviceType),
          isPartner: card.isPartner,
        },
      ],
      billingDate,
    },
    JSON_HEADERS,
  );

  if (!response || !response.isSuccess || !response.data) {
    throw new Error(
      `failed to fetch monthly billing date for card ${card.cardSuffix}, ${billingDate}: ${response?.errorDescription ?? 'unknown error'}`,
    );
  }

  const billing = response.data.cards[card.cardSuffix];
  return billing ? moment(billing.billingDate, DATE_FORMAT).toISOString() : undefined;
}

export function convertApprovedTransaction(txn: ScrapedApprovedTransaction, options?: ScraperOptions): Transaction {
  const isoDate = moment(`${txn.purchaseDate} ${txn.israelTransactionTime}`, `${DATE_FORMAT} HH:mm`).toISOString();

  const result: Transaction = {
    type: TransactionTypes.Normal,
    identifier: txn.seqConfirmationNumber,
    date: isoDate,
    processedDate: isoDate,
    originalAmount: -txn.originalAmount,
    originalCurrency: txn.currencyIso,
    chargedAmount: -txn.ilsBillingAmount,
    chargedCurrency: SHEKEL_CURRENCY,
    description: (txn.businessName || '').trim(),
    memo: txn.extraDetails || '',
    category: txn.branchCodeDescription?.trim() || undefined,
    status: TransactionStatuses.Pending,
  };

  if (options?.includeRawTransaction) {
    result.rawTransaction = getRawTransaction(txn);
  }

  return result;
}

export function getVoucherInstallments(voucher: ScrapedVoucher): TransactionInstallments | undefined {
  if (!voucher.numberOfInstallment || !voucher.currentInstallmentNum) {
    return undefined;
  }
  return {
    number: voucher.currentInstallmentNum,
    total: voucher.numberOfInstallment,
  };
}

export function convertVoucher(
  voucher: ScrapedVoucher,
  processedDateIso: string,
  options?: ScraperOptions,
): Transaction {
  const dateMoment = moment(`${voucher.purchaseDate} ${voucher.purchaseTime || '00:00:00'}`, `${DATE_FORMAT} HH:mm:ss`);
  const installments = getVoucherInstallments(voucher);

  const result: Transaction = {
    type: installments ? TransactionTypes.Installments : TransactionTypes.Normal,
    identifier: voucher.seqVoucherNumber,
    date: dateMoment.toISOString(),
    processedDate: processedDateIso,
    originalAmount: -voucher.originalAmount,
    originalCurrency: voucher.originalCurrencyIso,
    chargedAmount: -voucher.billingAmount,
    chargedCurrency: SHEKEL_CURRENCY,
    description: (voucher.businessName || '').trim(),
    memo: (voucher.moreInfo || '').trim(),
    category: voucher.transactionDescription?.trim() || undefined,
    installments,
    status: TransactionStatuses.Completed,
  };

  if (options?.includeRawTransaction) {
    result.rawTransaction = getRawTransaction(voucher);
  }

  return result;
}

async function fetchMonthTransactions(
  page: Page,
  transactionsUrl: string,
  transactionsCompanyCode: number,
  card: ScrapedCard,
  monthMoment: Moment,
  isNextBillingDate: boolean,
  processedDateIso: string,
  options: ScraperOptions,
): Promise<Transaction[]> {
  const billingMonth = monthMoment.format(DATE_FORMAT);

  debug(`fetching transactions for card ${card.cardSuffix}, ${billingMonth} (isNextBillingDate=${isNextBillingDate})`);
  await randomDelay(RATE_LIMIT.SLEEP_BETWEEN, RATE_LIMIT.SLEEP_BETWEEN + 500);

  const response = await fetchPostWithinPage<ScrapedTransactionsResponse>(
    page,
    transactionsUrl,
    {
      card4Number: card.cardSuffix,
      isNextBillingDate,
      cardStatus: Number(card.cardStatus),
      billingMonth,
      companyCode: transactionsCompanyCode,
      isPartner: card.isPartner,
    },
    JSON_HEADERS,
  );

  if (!response || !response.isSuccess || !response.data) {
    throw new Error(
      `failed to fetch transactions for card ${card.cardSuffix}, billing month ${billingMonth}: ${response?.errorDescription ?? 'unknown error'}`,
    );
  }

  const txns: Transaction[] = [];

  const approvedTxns = response.data.approvals?.approvedTransactions ?? [];
  txns.push(...approvedTxns.map(txn => convertApprovedTransaction(txn, options)));

  const voucherList = response.data.israelAbroadVouchers?.vouchers?.israelAbroadVouchersList ?? [];
  txns.push(...voucherList.map(voucher => convertVoucher(voucher, processedDateIso, options)));

  const outOfStatementGroups = response.data.israelAbroadVouchers?.outOfStatementChargeDateVouchers ?? [];
  outOfStatementGroups.forEach(group => {
    const groupDateStr = group.totalVouchersCurrencyDate?.dateImmediateVouchers;
    const groupIso = groupDateStr ? moment(groupDateStr, DATE_FORMAT).toISOString() : processedDateIso;
    txns.push(
      ...(group.immediateVouchersCurrencyDate ?? []).map(voucher => convertVoucher(voucher, groupIso, options)),
    );
  });

  return txns;
}

type ScraperSpecificCredentials = { id: string; password: string; card6Digits: string };

class IsracardGroupScraper extends BaseScraperWithBrowser<ScraperSpecificCredentials> {
  constructor(
    options: ScraperOptions,
    private loginBaseUrl: string,
    private webBaseUrl: string,
    private loginCompanyCode: string,
    private transactionsCompanyCode: number,
  ) {
    super(options);
  }

  private get servicesUrl(): string {
    return `${this.loginBaseUrl}/services/ProxyRequestHandler.ashx`;
  }

  private get cardListUrl(): string {
    return `${this.webBaseUrl}/ocp/transactions/DigitalV3.Transactions/GetCardList`;
  }

  private get monthlyBillingUrl(): string {
    return `${this.webBaseUrl}/ocp/transactions/DigitalV3.Transactions/GetMonthlyBilling`;
  }

  private get transactionsUrl(): string {
    return `${this.webBaseUrl}/ocp/transactions/DigitalV3.Transactions/GetTransactionsList`;
  }

  async login(credentials: ScraperSpecificCredentials): Promise<ScraperScrapingResult> {
    const loginStartTime = performance.now();

    await this.page.setRequestInterception(true);
    this.page.on('request', request => {
      if (request.url().includes('detector-dom.min.js')) {
        debug('force abort for request do download detector-dom.min.js resource');
        void request.abort(undefined, interceptionPriorities.abort);
      } else {
        void request.continue(undefined, interceptionPriorities.continue);
      }
    });

    await maskHeadlessUserAgent(this.page);
    await this.page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    await this.navigateTo(`${this.loginBaseUrl}/personalarea/Login`);
    await randomDelay(RATE_LIMIT.SLEEP_BETWEEN, RATE_LIMIT.SLEEP_BETWEEN + 500);

    this.emitProgress(ScraperProgressTypes.LoggingIn);

    const validateUrl = `${this.servicesUrl}?reqName=ValidateIdData`;
    const validateRequest = {
      id: credentials.id,
      cardSuffix: credentials.card6Digits,
      countryCode: COUNTRY_CODE,
      idType: ID_TYPE,
      checkLevel: '1',
      companyCode: this.loginCompanyCode,
    };
    debug('logging in with validate request');
    const validateResult = await fetchPostWithinPage<ScrapedLoginValidation>(this.page, validateUrl, validateRequest);
    if (
      !validateResult ||
      !validateResult.Header ||
      validateResult.Header.Status !== '1' ||
      !validateResult.ValidateIdDataBean
    ) {
      throw new Error('unknown error during login');
    }

    const validateReturnCode = validateResult.ValidateIdDataBean.returnCode;
    debug(`user validate with return code '${validateReturnCode}'`);
    if (validateReturnCode === '1') {
      const { userName } = validateResult.ValidateIdDataBean;

      const loginUrl = `${this.servicesUrl}?reqName=performLogonI`;
      const request = {
        KodMishtamesh: userName,
        MisparZihuy: credentials.id,
        Sisma: credentials.password,
        cardSuffix: credentials.card6Digits,
        countryCode: COUNTRY_CODE,
        idType: ID_TYPE,
      };
      debug('user login started');
      const loginResult = await fetchPostWithinPage<{ status: string }>(this.page, loginUrl, request);
      debug(`user login with status '${loginResult?.status}'`, loginResult);

      if (loginResult && loginResult.status === '1') {
        this.emitProgress(ScraperProgressTypes.LoginSuccess);
        debug(`Login completed in ${performance.now() - loginStartTime}ms`);

        await this.navigateTo(`${this.webBaseUrl}/transactions`);

        return { success: true };
      }

      if (loginResult && loginResult.status === '3') {
        this.emitProgress(ScraperProgressTypes.ChangePassword);
        return {
          success: false,
          errorType: ScraperErrorTypes.ChangePassword,
        };
      }

      this.emitProgress(ScraperProgressTypes.LoginFailed);
      return {
        success: false,
        errorType: ScraperErrorTypes.InvalidPassword,
      };
    }

    if (validateReturnCode === '4') {
      this.emitProgress(ScraperProgressTypes.ChangePassword);
      return {
        success: false,
        errorType: ScraperErrorTypes.ChangePassword,
      };
    }

    this.emitProgress(ScraperProgressTypes.LoginFailed);
    return {
      success: false,
      errorType: ScraperErrorTypes.InvalidPassword,
    };
  }

  async fetchData(): Promise<ScraperScrapingResult> {
    const fetchStartTime = performance.now();
    const defaultStartMoment = moment().subtract(1, 'years');
    const startDate = this.options.startDate || defaultStartMoment.toDate();
    const startMoment = moment.max(defaultStartMoment, moment(startDate));
    const futureMonthsToScrape = this.options.futureMonthsToScrape ?? 1;
    const allMonths = getAllMonthMoments(startMoment, futureMonthsToScrape);
    const currentMonthStart = moment().startOf('month');

    const cards = await fetchGroupCards(this.page, this.cardListUrl, this.loginCompanyCode);
    debug(`found ${cards.length} cards, fetching transactions for ${allMonths.length} months each`);

    const txnsByCard: Record<string, Transaction[]> = {};
    cards.forEach(card => {
      txnsByCard[card.cardSuffix] = [];
    });

    for (const monthMoment of allMonths) {
      const isNextBillingDate = monthMoment.isAfter(currentMonthStart);

      for (const card of cards) {
        const effectiveDateIso = await fetchEffectiveBillingDate(
          this.page,
          this.monthlyBillingUrl,
          this.transactionsCompanyCode,
          card,
          monthMoment,
        );
        const processedDateIso = effectiveDateIso ?? monthMoment.toISOString();
        const monthTxns = await fetchMonthTransactions(
          this.page,
          this.transactionsUrl,
          this.transactionsCompanyCode,
          card,
          monthMoment,
          isNextBillingDate,
          processedDateIso,
          this.options,
        );
        txnsByCard[card.cardSuffix].push(...monthTxns);
      }
    }

    const accounts: TransactionsAccount[] = cards.map(card => {
      let txns = txnsByCard[card.cardSuffix];
      if (!this.options.combineInstallments) {
        txns = fixInstallments(txns);
      }
      if (this.options.outputData?.enableTransactionsFilterByDate ?? true) {
        txns = filterOldTransactions(txns, startMoment, this.options.combineInstallments || false);
      }
      return {
        accountNumber: card.cardSuffix,
        balance: getCardBalance(card),
        balanceDate: getCardBalanceDate(card),
        cardFrame: getCardFrame(card),
        txns,
      };
    });

    debug(`fetchData completed in ${performance.now() - fetchStartTime}ms`);

    return {
      success: true,
      accounts,
    };
  }
}

export default IsracardGroupScraper;
