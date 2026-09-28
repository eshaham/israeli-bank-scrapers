import moment, { type Moment } from 'moment';
import { type Page } from 'puppeteer';
import { ALT_SHEKEL_CURRENCY, SHEKEL_CURRENCY, SHEKEL_CURRENCY_KEYWORD } from '../constants';
import { ScraperProgressTypes } from '../definitions';
import { interceptionPriorities, maskHeadlessUserAgent } from '../helpers/browser';
import getAllMonthMoments from '../helpers/dates';
import { getDebug } from '../helpers/debug';
import { fetchGetWithinPage, fetchPostWithinPage } from '../helpers/fetch';
import { chunk } from '../helpers/arrays';
import { filterOldTransactions, fixInstallments, getRawTransaction } from '../helpers/transactions';
import { randomDelay, runSerial, sleep } from '../helpers/waiting';
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

const RATE_LIMIT = {
  SLEEP_BETWEEN: 2500, // Sweet spot: 2.5s base delay (randomized up to 3s)
  TRANSACTIONS_BATCH_SIZE: 10,
} as const;

const COUNTRY_CODE = '212';
const ID_TYPE = '1';
const INSTALLMENTS_KEYWORD = 'תשלום';

const DATE_FORMAT = 'DD/MM/YYYY';
const BALANCE_DATE_OUTPUT_FORMAT = 'YYYY-MM-DD[T]HH:mm:ss';

const CARD_LIST_PAGE_PATH = '/personalarea/cardlist/?WebPage=true';
const CARD_LIST_BALANCE_READY_MARKERS = ['עבור כרטיס שמסתיים ב', 'נותר לניצול:'];
const CARD_SUFFIX_PATTERN = '(\\d{4})';
const AMEX_CARD_SECTION_SEPARATOR = new RegExp('עבור כרטיס שמסתיים ב\\s*');
const AMEX_CARD_BALANCE_PATTERN =
  /ניצלת עד כה\s*([\d,.]+)\s*(?:₪)?\s*מתוך מסגרת האשראי\s*([\d,.]+).*?נכון לתאריך\s*:?[\s]*(\d{2}[/\.\-]\d{2}[/\.\-]\d{4})/s;
const ISRACARD_CARD_BALANCE_PATTERN = new RegExp(
  `${CARD_SUFFIX_PATTERN}[\\s\\S]*?מסגרת:\\s*₪?\\s*([\\d,.]+)[\\s\\S]*?נותר לניצול:\\s*₪?\\s*([\\d,.]+)`,
  'g',
);
const ISRACARD_CARD_BALANCE_DATE_PATTERN = /לחיוב ב-(\d{2}[/.\-]\d{2})/;

const debug = getDebug('base-isracard-amex');

type CompanyServiceOptions = {
  servicesUrl: string;
  companyCode: string;
  cardListPageUrl: string;
};

type ScrapedAccountsWithIndex = Record<string, TransactionsAccount & { index: number }>;

interface ScrapedTransaction {
  dealSumType: string;
  voucherNumberRatzOutbound: string;
  voucherNumberRatz: string;
  moreInfo?: string;
  dealSumOutbound: boolean;
  currencyId: string;
  currentPaymentCurrency: string;
  dealSum: number;
  fullPaymentDate?: string;
  fullPurchaseDate?: string;
  fullPurchaseDateOutbound?: string;
  fullSupplierNameHeb: string;
  fullSupplierNameOutbound: string;
  paymentSum: number;
  paymentSumOutbound: number;
}

interface ScrapedAccount {
  index: number;
  accountNumber: string;
  processedDate: string;
}

interface ScrapedLoginValidation {
  Header: {
    Status: string;
  };
  ValidateIdDataBean?: {
    userName?: string;
    returnCode: string;
  };
}

interface ScrapedAccountsWithinPageResponse {
  Header: {
    Status: string;
  };
  DashboardMonthBean?: {
    cardsCharges: {
      cardIndex: string;
      cardNumber: string;
      billingDate: string;
    }[];
  };
}

interface ScrapedCurrentCardTransactions {
  txnIsrael?: ScrapedTransaction[];
  txnAbroad?: ScrapedTransaction[];
}

interface ScrapedTransactionData {
  Header?: {
    Status: string;
  };
  PirteyIska_204Bean?: {
    sector: string;
  };

  CardsTransactionsListBean?: Record<
    string,
    {
      CurrentCardTransactions: ScrapedCurrentCardTransactions[];
    }
  >;
}

type ScrapedCardBalance = {
  balance: number;
  balanceDate?: string;
  cardFrame: number;
};

export function parseCardListBalances(pageText: string): Map<string, ScrapedCardBalance> {
  const balances = new Map<string, ScrapedCardBalance>();
  const cardSections = pageText.split(AMEX_CARD_SECTION_SEPARATOR).slice(1);

  cardSections.forEach(cardSection => {
    const cardSuffix = cardSection.match(new RegExp(`^${CARD_SUFFIX_PATTERN}`))?.[1];
    const balanceMatch = cardSection.match(AMEX_CARD_BALANCE_PATTERN);
    if (!cardSuffix || !balanceMatch) {
      return;
    }

    const balance = Number(balanceMatch[1].replace(/,/g, ''));
    const cardFrame = Number(balanceMatch[2].replace(/,/g, ''));
    const balanceDate = moment(balanceMatch[3].replace(/[.-]/g, '/'), DATE_FORMAT, true);
    if (!Number.isFinite(balance) || !Number.isFinite(cardFrame) || !balanceDate.isValid()) {
      return;
    }

    balances.set(cardSuffix, {
      balance: -balance,
      balanceDate: balanceDate.format(BALANCE_DATE_OUTPUT_FORMAT),
      cardFrame,
    });
  });

  const isracardBalanceDates = [...pageText.matchAll(new RegExp(ISRACARD_CARD_BALANCE_DATE_PATTERN, 'g'))].map(
    ([, date]) => date,
  );
  const uniqueIsracardBalanceDates = [...new Set(isracardBalanceDates)];
  const fallbackIsracardBalanceDate =
    uniqueIsracardBalanceDates.length === 1 ? uniqueIsracardBalanceDates[0] : undefined;
  const isracardCards = [...pageText.matchAll(ISRACARD_CARD_BALANCE_PATTERN)];

  for (const isracardCard of isracardCards) {
    const [, cardSuffix, cardFrameValue, remainingCreditValue] = isracardCard;
    const cardBalanceDateValue = isracardCard[0].match(ISRACARD_CARD_BALANCE_DATE_PATTERN)?.[1];
    const cardFrame = Number(cardFrameValue.replace(/,/g, ''));
    const remainingCredit = Number(remainingCreditValue.replace(/,/g, ''));
    // Cancelled cards have no usable frame and should not inherit another card's date.
    const canUseFallbackBalanceDate = cardFrame > 0;
    // Some active cards omit the date from their own block but share one page-level billing date.
    const balanceDateValue =
      cardBalanceDateValue ?? (canUseFallbackBalanceDate ? fallbackIsracardBalanceDate : undefined);
    const balanceDate = balanceDateValue ? moment(balanceDateValue.replace(/[.-]/g, '/'), 'DD/MM', true) : undefined;
    if (!Number.isFinite(cardFrame) || !Number.isFinite(remainingCredit) || (balanceDate && !balanceDate.isValid())) {
      continue;
    }

    const balance = remainingCredit - cardFrame;
    const formattedBalanceDate = balanceDate?.format(BALANCE_DATE_OUTPUT_FORMAT);
    balances.set(cardSuffix, {
      balance,
      cardFrame,
      ...(formattedBalanceDate ? { balanceDate: formattedBalanceDate } : {}),
    });
  }

  return balances;
}

function getAccountsUrl(servicesUrl: string, monthMoment: Moment) {
  const billingDate = monthMoment.format('YYYY-MM-DD');
  const url = new URL(servicesUrl);
  url.searchParams.set('reqName', 'DashboardMonth');
  url.searchParams.set('actionCode', '0');
  url.searchParams.set('billingDate', billingDate);
  url.searchParams.set('format', 'Json');
  return url.toString();
}

async function fetchAccounts(page: Page, servicesUrl: string, monthMoment: Moment): Promise<ScrapedAccount[]> {
  const startTime = performance.now();
  const dataUrl = getAccountsUrl(servicesUrl, monthMoment);

  debug(`fetching accounts for ${monthMoment.format('YYYY-MM')} from ${dataUrl}`);
  await randomDelay(RATE_LIMIT.SLEEP_BETWEEN, RATE_LIMIT.SLEEP_BETWEEN + 500);
  const dataResult = await fetchGetWithinPage<ScrapedAccountsWithinPageResponse>(page, dataUrl);
  debug(`Fetch for ${monthMoment.format('YYYY-MM')} completed in ${performance.now() - startTime}ms`);

  if (dataResult && dataResult.Header?.Status === '1' && dataResult.DashboardMonthBean) {
    const { cardsCharges } = dataResult.DashboardMonthBean;
    if (cardsCharges) {
      return cardsCharges.map(cardCharge => {
        return {
          index: parseInt(cardCharge.cardIndex, 10),
          accountNumber: cardCharge.cardNumber,
          processedDate: moment(cardCharge.billingDate, DATE_FORMAT).toISOString(),
        };
      });
    }
  }
  return [];
}

function getTransactionsUrl(servicesUrl: string, monthMoment: Moment) {
  const month = monthMoment.month() + 1;
  const year = monthMoment.year();
  const monthStr = month < 10 ? `0${month}` : month.toString();
  const url = new URL(servicesUrl);
  url.searchParams.set('reqName', 'CardsTransactionsList');
  url.searchParams.set('month', monthStr);
  url.searchParams.set('year', `${year}`);
  url.searchParams.set('requiredDate', 'N');
  return url.toString();
}

function convertCurrency(currencyStr: string) {
  if (currencyStr === SHEKEL_CURRENCY_KEYWORD || currencyStr === ALT_SHEKEL_CURRENCY) {
    return SHEKEL_CURRENCY;
  }
  return currencyStr;
}

function getInstallmentsInfo(txn: ScrapedTransaction): TransactionInstallments | undefined {
  if (!txn.moreInfo || !txn.moreInfo.includes(INSTALLMENTS_KEYWORD)) {
    return undefined;
  }
  const matches = txn.moreInfo.match(/\d+/g);
  if (!matches || matches.length < 2) {
    return undefined;
  }

  return {
    number: parseInt(matches[0], 10),
    total: parseInt(matches[1], 10),
  };
}

function getTransactionType(txn: ScrapedTransaction) {
  return getInstallmentsInfo(txn) ? TransactionTypes.Installments : TransactionTypes.Normal;
}

function convertTransactions(
  txns: ScrapedTransaction[],
  processedDate: string,
  options?: ScraperOptions,
): Transaction[] {
  const filteredTxns = txns.filter(
    txn =>
      txn.dealSumType !== '1' && txn.voucherNumberRatz !== '000000000' && txn.voucherNumberRatzOutbound !== '000000000',
  );

  return filteredTxns.map(txn => {
    const isOutbound = txn.dealSumOutbound;
    const txnDateStr = isOutbound ? txn.fullPurchaseDateOutbound : txn.fullPurchaseDate;
    const txnMoment = moment(txnDateStr, DATE_FORMAT);

    const currentProcessedDate = txn.fullPaymentDate
      ? moment(txn.fullPaymentDate, DATE_FORMAT).toISOString()
      : processedDate;
    const result: Transaction = {
      type: getTransactionType(txn),
      identifier: parseInt(isOutbound ? txn.voucherNumberRatzOutbound : txn.voucherNumberRatz, 10),
      date: txnMoment.toISOString(),
      processedDate: currentProcessedDate,
      originalAmount: isOutbound ? -txn.dealSumOutbound : -txn.dealSum,
      originalCurrency: convertCurrency(txn.currentPaymentCurrency ?? txn.currencyId),
      chargedAmount: isOutbound ? -txn.paymentSumOutbound : -txn.paymentSum,
      chargedCurrency: convertCurrency(txn.currencyId),
      description: isOutbound ? txn.fullSupplierNameOutbound : txn.fullSupplierNameHeb,
      memo: txn.moreInfo || '',
      installments: getInstallmentsInfo(txn) || undefined,
      status: TransactionStatuses.Completed,
    };

    if (options?.includeRawTransaction) {
      result.rawTransaction = getRawTransaction(txn);
    }

    return result;
  });
}

async function fetchTransactions(
  page: Page,
  options: ScraperOptions,
  companyServiceOptions: CompanyServiceOptions,
  startMoment: Moment,
  monthMoment: Moment,
): Promise<ScrapedAccountsWithIndex> {
  const startTime = performance.now();
  const accounts = await fetchAccounts(page, companyServiceOptions.servicesUrl, monthMoment);
  const dataUrl = getTransactionsUrl(companyServiceOptions.servicesUrl, monthMoment);

  debug(`fetching transactions for ${monthMoment.format('YYYY-MM')} from ${dataUrl}`);
  await randomDelay(RATE_LIMIT.SLEEP_BETWEEN, RATE_LIMIT.SLEEP_BETWEEN + 500);
  const dataResult = await fetchGetWithinPage<ScrapedTransactionData>(page, dataUrl);
  debug(`Fetch for ${monthMoment.format('YYYY-MM')} completed in ${performance.now() - startTime}ms`);

  if (dataResult && dataResult.Header?.Status === '1' && dataResult.CardsTransactionsListBean) {
    const accountTxns: ScrapedAccountsWithIndex = {};
    accounts.forEach(account => {
      const txnGroups: ScrapedCurrentCardTransactions[] | undefined =
        dataResult.CardsTransactionsListBean?.[`Index${account.index}`]?.CurrentCardTransactions;
      if (txnGroups) {
        let allTxns: Transaction[] = [];
        txnGroups.forEach(txnGroup => {
          if (txnGroup.txnIsrael) {
            const txns = convertTransactions(txnGroup.txnIsrael, account.processedDate, options);
            allTxns.push(...txns);
          }
          if (txnGroup.txnAbroad) {
            const txns = convertTransactions(txnGroup.txnAbroad, account.processedDate, options);
            allTxns.push(...txns);
          }
        });

        if (!options.combineInstallments) {
          allTxns = fixInstallments(allTxns);
        }
        if (options.outputData?.enableTransactionsFilterByDate ?? true) {
          allTxns = filterOldTransactions(allTxns, startMoment, options.combineInstallments || false);
        }
        accountTxns[account.accountNumber] = {
          accountNumber: account.accountNumber,
          index: account.index,
          txns: allTxns,
        };
      }
    });
    return accountTxns;
  }

  return {};
}

async function fetchCardBalances(page: Page, cardListPageUrl: string): Promise<Map<string, ScrapedCardBalance>> {
  try {
    debug(`opening card balance page ${cardListPageUrl}`);

    await page.goto(cardListPageUrl, { waitUntil: 'domcontentloaded' });
    debug(`card balance page loaded at ${page.url()}`);
    await page.waitForFunction(
      (markers: string[]) => markers.some(marker => document.body.innerText.includes(marker)),
      {},
      CARD_LIST_BALANCE_READY_MARKERS,
    );
    const balances = parseCardListBalances(await page.evaluate(() => document.body.innerText));
    debug(`parsed card balances for ${balances.size} cards from card list page`);
    return balances;
  } catch (error) {
    debug(`failed to fetch card balances from ${cardListPageUrl}`, error);
    return new Map();
  }
}

async function getExtraScrapTransaction(
  page: Page,
  options: CompanyServiceOptions,
  month: Moment,
  accountIndex: number,
  transaction: Transaction,
): Promise<Transaction> {
  const url = new URL(options.servicesUrl);
  url.searchParams.set('reqName', 'PirteyIska_204');
  url.searchParams.set('CardIndex', accountIndex.toString());
  url.searchParams.set('shovarRatz', transaction.identifier!.toString());
  url.searchParams.set('moedChiuv', month.format('MMYYYY'));

  debug(`fetching extra scrap for transaction ${transaction.identifier} for month ${month.format('YYYY-MM')}`);
  const data = await fetchGetWithinPage<ScrapedTransactionData>(page, url.toString());
  if (!data) {
    return transaction;
  }

  const rawCategory = data.PirteyIska_204Bean?.sector ?? '';
  return {
    ...transaction,
    category: rawCategory.trim(),
    rawTransaction: getRawTransaction(data, transaction),
  };
}

async function getExtraScrapAccount(
  page: Page,
  options: CompanyServiceOptions,
  accountMap: ScrapedAccountsWithIndex,
  month: moment.Moment,
): Promise<ScrapedAccountsWithIndex> {
  const accounts: ScrapedAccountsWithIndex[string][] = [];
  for (const account of Object.values(accountMap)) {
    debug(
      `get extra scrap for ${account.accountNumber} with ${account.txns.length} transactions`,
      month.format('YYYY-MM'),
    );
    const txns: Transaction[] = [];
    for (const txnsChunk of chunk(account.txns, RATE_LIMIT.TRANSACTIONS_BATCH_SIZE)) {
      debug(`processing chunk of ${txnsChunk.length} transactions for account ${account.accountNumber}`);
      const updatedTxns = await Promise.all(
        txnsChunk.map(t => getExtraScrapTransaction(page, options, month, account.index, t)),
      );
      await sleep(RATE_LIMIT.SLEEP_BETWEEN);
      txns.push(...updatedTxns);
    }
    accounts.push({ ...account, txns });
  }

  return accounts.reduce((m, x) => ({ ...m, [x.accountNumber]: x }), {});
}

async function getAdditionalTransactionInformation(
  scraperOptions: ScraperOptions,
  accountsWithIndex: ScrapedAccountsWithIndex[],
  page: Page,
  options: CompanyServiceOptions,
  allMonths: moment.Moment[],
): Promise<ScrapedAccountsWithIndex[]> {
  if (
    !scraperOptions.additionalTransactionInformation ||
    scraperOptions.optInFeatures?.includes('isracard-amex:skipAdditionalTransactionInformation')
  ) {
    return accountsWithIndex;
  }
  return runSerial(accountsWithIndex.map((a, i) => () => getExtraScrapAccount(page, options, a, allMonths[i])));
}

async function fetchAllTransactions(
  page: Page,
  options: ScraperOptions,
  companyServiceOptions: CompanyServiceOptions,
  startMoment: Moment,
) {
  const fetchStartTime = performance.now();
  const futureMonthsToScrape = options.futureMonthsToScrape ?? 1;
  const allMonths = getAllMonthMoments(startMoment, futureMonthsToScrape);
  debug(`Fetching transactions for ${allMonths.length} months`);

  const results: ScrapedAccountsWithIndex[] = await runSerial(
    allMonths.map(monthMoment => () => {
      return fetchTransactions(page, options, companyServiceOptions, startMoment, monthMoment);
    }),
  );

  const finalResult = await getAdditionalTransactionInformation(
    options,
    results,
    page,
    companyServiceOptions,
    allMonths,
  );
  const cardBalances = await fetchCardBalances(page, companyServiceOptions.cardListPageUrl);
  const combinedTxns: Record<string, Transaction[]> = {};

  finalResult.forEach(result => {
    Object.keys(result).forEach(accountNumber => {
      let txnsForAccount = combinedTxns[accountNumber];
      if (!txnsForAccount) {
        txnsForAccount = [];
        combinedTxns[accountNumber] = txnsForAccount;
      }
      const toBeAddedTxns = result[accountNumber].txns;
      combinedTxns[accountNumber].push(...toBeAddedTxns);
    });
  });

  const accounts = Object.keys(combinedTxns).map(accountNumber => {
    const balance = cardBalances.get(accountNumber);
    debug(
      `account ${accountNumber} balance ${balance ? 'matched' : 'not matched'}${balance ? `: ${balance.balance}` : ''}`,
    );
    return {
      accountNumber,
      txns: combinedTxns[accountNumber],
      balance: balance?.balance,
      balanceDate: balance?.balanceDate,
      cardFrame: balance?.cardFrame,
    };
  });

  debug(`fetchAllTransactions completed in ${performance.now() - fetchStartTime}ms`);

  return {
    success: true,
    accounts,
  };
}

type ScraperSpecificCredentials = { id: string; password: string; card6Digits: string };
class IsracardAmexBaseScraper extends BaseScraperWithBrowser<ScraperSpecificCredentials> {
  private baseUrl: string;

  private companyCode: string;

  private servicesUrl: string;

  private cardListPageUrl: string;

  constructor(options: ScraperOptions, baseUrl: string, companyCode: string) {
    super(options);

    this.baseUrl = baseUrl;
    this.companyCode = companyCode;
    this.servicesUrl = `${baseUrl}/services/ProxyRequestHandler.ashx`;
    this.cardListPageUrl = `${baseUrl}${CARD_LIST_PAGE_PATH}`;
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

    await this.navigateTo(`${this.baseUrl}/personalarea/Login`);

    this.emitProgress(ScraperProgressTypes.LoggingIn);

    const validateUrl = `${this.servicesUrl}?reqName=ValidateIdData`;
    const validateRequest = {
      id: credentials.id,
      cardSuffix: credentials.card6Digits,
      countryCode: COUNTRY_CODE,
      idType: ID_TYPE,
      checkLevel: '1',
      companyCode: this.companyCode,
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

  async fetchData() {
    const defaultStartMoment = moment().subtract(1, 'years');
    const startDate = this.options.startDate || defaultStartMoment.toDate();
    const startMoment = moment.max(defaultStartMoment, moment(startDate));

    return fetchAllTransactions(
      this.page,
      this.options,
      {
        servicesUrl: this.servicesUrl,
        companyCode: this.companyCode,
        cardListPageUrl: this.cardListPageUrl,
      },
      startMoment,
    );
  }
}

export default IsracardAmexBaseScraper;
