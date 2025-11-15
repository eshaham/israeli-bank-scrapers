import buildUrl from 'build-url';
import _ from 'lodash';
import moment, { type Moment } from 'moment';
import { type Page } from 'puppeteer';
import { ALT_SHEKEL_CURRENCY, SHEKEL_CURRENCY, SHEKEL_CURRENCY_KEYWORD } from '../constants';
import { ScraperProgressTypes } from '../definitions';
import getAllMonthMoments from '../helpers/dates';
import { getDebug } from '../helpers/debug';
import { fetchGetWithinPage, fetchPostWithinPage } from '../helpers/fetch';
import { filterOldTransactions, fixInstallments } from '../helpers/transactions';
import { runSerial } from '../helpers/waiting';
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
import { interceptionPriorities, maskHeadlessUserAgent } from '../helpers/browser';
import { clickButton, waitUntilElementFound } from '../helpers/elements-interactions';

const COUNTRY_CODE = '212';
const ID_TYPE = '1';
const INSTALLMENTS_KEYWORD = 'תשלום';

const DATE_FORMAT = 'DD/MM/YYYY';

const debug = getDebug('base-isracard-amex');

type CompanyServiceOptions = {
  servicesUrl: string;
  companyCode: string;
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

function getAccountsUrl(servicesUrl: string, monthMoment: Moment) {
  const billingDate = monthMoment.format('YYYY-MM-DD');
  return buildUrl(servicesUrl, {
    queryParams: {
      reqName: 'DashboardMonth',
      actionCode: '0',
      billingDate,
      format: 'Json',
    },
  });
}

async function fetchAccounts(page: Page, servicesUrl: string, monthMoment: Moment): Promise<ScrapedAccount[]> {
  const dataUrl = getAccountsUrl(servicesUrl, monthMoment);
  const dataResult = await fetchGetWithinPage<ScrapedAccountsWithinPageResponse>(page, dataUrl);
  if (dataResult && _.get(dataResult, 'Header.Status') === '1' && dataResult.DashboardMonthBean) {
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
  return buildUrl(servicesUrl, {
    queryParams: {
      reqName: 'CardsTransactionsList',
      month: monthStr,
      year: `${year}`,
      requiredDate: 'N',
    },
  });
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

function convertTransactions(txns: ScrapedTransaction[], processedDate: string): Transaction[] {
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
  const accounts = await fetchAccounts(page, companyServiceOptions.servicesUrl, monthMoment);
  const dataUrl = getTransactionsUrl(companyServiceOptions.servicesUrl, monthMoment);
  const dataResult = await fetchGetWithinPage<ScrapedTransactionData>(page, dataUrl);
  if (dataResult && _.get(dataResult, 'Header.Status') === '1' && dataResult.CardsTransactionsListBean) {
    const accountTxns: ScrapedAccountsWithIndex = {};
    accounts.forEach(account => {
      const txnGroups: ScrapedCurrentCardTransactions[] | undefined = _.get(
        dataResult,
        `CardsTransactionsListBean.Index${account.index}.CurrentCardTransactions`,
      );
      if (txnGroups) {
        let allTxns: Transaction[] = [];
        txnGroups.forEach(txnGroup => {
          if (txnGroup.txnIsrael) {
            const txns = convertTransactions(txnGroup.txnIsrael, account.processedDate);
            allTxns.push(...txns);
          }
          if (txnGroup.txnAbroad) {
            const txns = convertTransactions(txnGroup.txnAbroad, account.processedDate);
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

function getTransactionExtraDetails(
  servicesUrl: string,
  month: Moment,
  accountIndex: number,
  transaction: Transaction,
): string {
  const moedChiuv = month.format('MMYYYY');
  return buildUrl(servicesUrl, {
    queryParams: {
      reqName: 'PirteyIska_204',
      CardIndex: accountIndex.toString(),
      shovarRatz: transaction.identifier!.toString(),
      moedChiuv,
    },
  });
}
async function getExtraScrapTransaction(
  page: Page,
  options: CompanyServiceOptions,
  month: Moment,
  accountIndex: number,
  transaction: Transaction,
): Promise<Transaction> {
  const dataUrl = getTransactionExtraDetails(options.servicesUrl, month, accountIndex, transaction);
  const data = await fetchGetWithinPage<ScrapedTransactionData>(page, dataUrl);

  if (!data) {
    return transaction;
  }

  const rawCategory = _.get(data, 'PirteyIska_204Bean.sector') ?? '';
  return {
    ...transaction,
    category: rawCategory.trim(),
  };
}

function getExtraScrapTransactions(
  accountWithIndex: TransactionsAccount & { index: number },
  page: Page,
  options: CompanyServiceOptions,
  month: moment.Moment,
): Promise<Transaction[]> {
  const promises = accountWithIndex.txns.map(t =>
    getExtraScrapTransaction(page, options, month, accountWithIndex.index, t),
  );
  return Promise.all(promises);
}

async function getExtraScrapAccount(
  page: Page,
  options: CompanyServiceOptions,
  accountMap: ScrapedAccountsWithIndex,
  month: moment.Moment,
): Promise<ScrapedAccountsWithIndex> {
  const promises = Object.keys(accountMap).map(async a => ({
    ...accountMap[a],
    txns: await getExtraScrapTransactions(accountMap[a], page, options, month),
  }));
  const accounts = await Promise.all(promises);
  return accounts.reduce((m, x) => ({ ...m, [x.accountNumber]: x }), {});
}

function getExtraScrap(
  accountsWithIndex: ScrapedAccountsWithIndex[],
  page: Page,
  options: CompanyServiceOptions,
  allMonths: moment.Moment[],
): Promise<ScrapedAccountsWithIndex[]> {
  const actions = accountsWithIndex.map((a, i) => () => getExtraScrapAccount(page, options, a, allMonths[i]));
  return runSerial(actions);
}

async function fetchAllTransactions(
  page: Page,
  options: ScraperOptions,
  companyServiceOptions: CompanyServiceOptions,
  startMoment: Moment,
) {
  const futureMonthsToScrape = options.futureMonthsToScrape ?? 1;
  const allMonths = getAllMonthMoments(startMoment, futureMonthsToScrape);
  const results: ScrapedAccountsWithIndex[] = await Promise.all(
    allMonths.map(async monthMoment => {
      return fetchTransactions(page, options, companyServiceOptions, startMoment, monthMoment);
    }),
  );

  const finalResult = options.additionalTransactionInformation
    ? await getExtraScrap(results, page, companyServiceOptions, allMonths)
    : results;

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
    return {
      accountNumber,
      txns: combinedTxns[accountNumber],
    };
  });

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

  constructor(options: ScraperOptions, baseUrl: string, companyCode: string) {
    super(options);

    this.baseUrl = baseUrl;
    this.companyCode = companyCode;
    this.servicesUrl = `${baseUrl}/services/ProxyRequestHandler.ashx`;
  }

  async login(credentials: ScraperSpecificCredentials): Promise<ScraperScrapingResult> {
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

    await waitUntilElementFound(this.page, '#flip', true);
    debug('click on the "Enter with password" button');
    await clickButton(this.page, '#flip');
    debug('Wait for the panel to visually flip');
    await waitUntilElementFound(this.page, '#otpLoginPwd', true);

    const validateUrl = `${this.servicesUrl}?reqName=ValidateIdData`;
    const validateRequest = {
      id: credentials.id,
      cardSuffix: credentials.card6Digits,
      countryCode: COUNTRY_CODE,
      idType: ID_TYPE,
      checkLevel: '1',
      companyCode: this.companyCode,
    };
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
      const loginResult = await fetchPostWithinPage<{ status: string }>(this.page, loginUrl, request);
      debug(`user login with status '${loginResult?.status}'`);

      if (loginResult && loginResult.status === '1') {
        this.emitProgress(ScraperProgressTypes.LoginSuccess);
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
      },
      startMoment,
    );
  }
}

export default IsracardAmexBaseScraper;
