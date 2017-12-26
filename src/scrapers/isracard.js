import _ from 'lodash';
import buildUrl from 'build-url';
import moment from 'moment';

import { BaseScraper, LOGIN_RESULT } from './base-scraper';
import { fetchGet, fetchPost } from '../helpers/fetch';
import { SCRAPE_PROGRESS_TYPES, NORMAL_TXN_TYPE, INSTALLMENTS_TXN_TYPE } from '../constants';
import getAllMonthMoments from '../helpers/dates';
import { fixInstallments, filterOldTransactions } from '../helpers/transactions';

const BASE_URL = 'https://digital.isracard.co.il';
const SERVICES_URL = `${BASE_URL}/services/ProxyRequestHandler.ashx`;
const COUNTRY_CODE = '212';
const ID_TYPE = '1';
const INSTALLMENTS_KEYWORD = 'תשלום';

const DATE_FORMAT = 'DD/MM/YYYY';

function getAccountsUrl(monthMoment) {
  const billingDate = monthMoment.format('YYYY-MM-DD');
  return buildUrl(SERVICES_URL, {
    queryParams: {
      reqName: 'DashboardMonth',
      actionCode: 0,
      billingDate,
      format: 'Json',
    },
  });
}

async function fetchAccounts(page, monthMoment) {
  const dataUrl = getAccountsUrl(monthMoment);
  const dataResult = await fetchGet(page, dataUrl);
  if (_.get(dataResult, 'Header.Status') === '1' && dataResult.DashboardMonthBean) {
    const { cardsCharges } = dataResult.DashboardMonthBean;
    if (cardsCharges) {
      return cardsCharges.map((cardCharge) => {
        return {
          index: parseInt(cardCharge.cardIndex, 10),
          accountNumber: cardCharge.cardNumber,
          processedDate: moment(cardCharge.billingDate, DATE_FORMAT).toDate(),
        };
      });
    }
  }
  return null;
}

function getTransactionsUrl(monthMoment) {
  const month = monthMoment.month() + 1;
  const year = monthMoment.year();
  const monthStr = month < 10 ? `0${month}` : month.toString();
  return buildUrl(SERVICES_URL, {
    queryParams: {
      reqName: 'CardsTransactionsList',
      month: monthStr,
      year,
      requiredDate: 'N',
    },
  });
}

function getInstallmentsInfo(txn) {
  if (!txn.moreInfo || !txn.moreInfo.includes(INSTALLMENTS_KEYWORD)) {
    return null;
  }
  const matches = txn.moreInfo.match(/\d+/g);
  if (!matches || matches.length < 2) {
    return null;
  }

  return {
    number: matches[0],
    total: matches[1],
  };
}

function getTransactionType(txn) {
  return getInstallmentsInfo(txn) ? NORMAL_TXN_TYPE : INSTALLMENTS_TXN_TYPE;
}

function convertTransactions(txns, processedDate) {
  return txns.map((txn) => {
    return {
      type: getTransactionType(txn),
      identifier: txn.voucherNumberRatz,
      date: moment(txn.fullPurchaseDate, DATE_FORMAT).toDate(),
      processedDate,
      originalAmount: -txn.dealSum,
      chargedAmount: -txn.paymentSum,
      description: txn.fullSupplierNameHeb,
      installments: getInstallmentsInfo(txn),
    };
  });
}

async function fetchTransactions(page, options, startMoment, monthMoment) {
  const accounts = await fetchAccounts(page, monthMoment);
  const dataUrl = getTransactionsUrl(monthMoment);
  const dataResult = await fetchGet(page, dataUrl);
  if (_.get(dataResult, 'Header.Status') === '1' && dataResult.CardsTransactionsListBean) {
    const accountTxns = {};
    accounts.forEach((account) => {
      const txnGroups = _.get(dataResult, `CardsTransactionsListBean.Index${account.index}.CurrentCardTransactions`);
      if (txnGroups) {
        let allTxns = [];
        txnGroups.forEach((txnGroup) => {
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
        allTxns = filterOldTransactions(allTxns, startMoment, options.combineInstallments);

        accountTxns[account.accountNumber] = {
          accountNumber: account.accountNumber,
          index: account.index,
          txns: allTxns,
        };
      }
    });
    return accountTxns;
  }

  return null;
}

async function fetchAllTransactions(page, options, startMoment) {
  const allMonths = getAllMonthMoments(startMoment, true);
  const results = await Promise.all(allMonths.map(async (monthMoment) => {
    return fetchTransactions(page, options, startMoment, monthMoment);
  }));

  const combinedTxns = {};
  results.forEach((result) => {
    Object.keys(result).forEach((accountNumber) => {
      let txnsForAccount = combinedTxns[accountNumber];
      if (!txnsForAccount) {
        txnsForAccount = [];
        combinedTxns[accountNumber] = txnsForAccount;
      }
      const toBeAddedTxns = result[accountNumber].txns;
      combinedTxns[accountNumber].push(...toBeAddedTxns);
    });
  });

  const lastResult = results[results.length - 1];
  const firstAccountNumberOfLastMonth = Object.keys(lastResult).filter((accountNumber) => {
    return lastResult[accountNumber].index === 0;
  })[0];

  let firstAccountNumberOfLastMonthTxns = combinedTxns[firstAccountNumberOfLastMonth];
  firstAccountNumberOfLastMonthTxns = firstAccountNumberOfLastMonthTxns.sort((a, b) => {
    return a.date - b.date;
  });
  return {
    accountNumber: firstAccountNumberOfLastMonth,
    txns: firstAccountNumberOfLastMonthTxns,
  };
}

class IsracardScraper extends BaseScraper {
  async login(credentials) {
    await this.page.goto(`${BASE_URL}/personalarea/Login`);

    this.emitProgress(SCRAPE_PROGRESS_TYPES.LOGGING_IN);

    const validateUrl = `${SERVICES_URL}?reqName=ValidateIdData`;
    const validateRequest = {
      id: credentials.id,
      cardSuffix: credentials.card6Digits,
      countryCode: COUNTRY_CODE,
      idType: ID_TYPE,
      checkLevel: '1',
      companyCode: '11',
    };
    const validateResult = await fetchPost(this.page, validateUrl, validateRequest);
    if (!validateResult || !validateResult.Header || validateResult.Header.Status !== '1' || !validateResult.ValidateIdDataBean) {
      throw new Error('unknown error during login');
    }

    const validateReturnCode = validateResult.ValidateIdDataBean.returnCode;
    if (validateReturnCode === '1') {
      const { userName } = validateResult.ValidateIdDataBean;

      const loginUrl = `${SERVICES_URL}?reqName=performLogonI`;
      const request = {
        KodMishtamesh: userName,
        MisparZihuy: credentials.id,
        Sisma: credentials.password,
        cardSuffix: credentials.card6Digits,
        countryCode: COUNTRY_CODE,
        idType: ID_TYPE,
      };
      const loginResult = await fetchPost(this.page, loginUrl, request);
      if (loginResult.status === '1') {
        this.emitProgress(SCRAPE_PROGRESS_TYPES.LOGIN_SUCCESS);
        return { success: true };
      }

      if (loginResult.status === '3') {
        this.emitProgress(SCRAPE_PROGRESS_TYPES.CHANGE_PASSWORD);
        return {
          success: false,
          errorType: LOGIN_RESULT.CHANGE_PASSWORD,
        };
      }

      this.emitProgress(SCRAPE_PROGRESS_TYPES.LOGIN_FAILED);
      return {
        success: false,
        errorType: LOGIN_RESULT.INVALID_PASSWORD,
      };
    }

    if (validateReturnCode === '4') {
      this.emitProgress(SCRAPE_PROGRESS_TYPES.CHANGE_PASSWORD);
      return {
        success: false,
        errorType: LOGIN_RESULT.CHANGE_PASSWORD,
      };
    }

    this.emitProgress(SCRAPE_PROGRESS_TYPES.LOGIN_FAILED);
    return {
      success: false,
      errorType: LOGIN_RESULT.INVALID_PASSWORD,
    };
  }

  async fetchData() {
    const defaultStartMoment = moment().subtract(1, 'years');
    const startDate = this.options.startDate || defaultStartMoment.toDate();
    const startMoment = moment.max(defaultStartMoment, moment(startDate));

    const txnsResult = await fetchAllTransactions(this.page, this.options, startMoment);
    if (!txnsResult) {
      throw new Error('unknown error while fetching data');
    }

    return {
      success: true,
      accountNumber: txnsResult.accountNumber,
      txns: txnsResult.txns,
    };
  }
}

export default IsracardScraper;
