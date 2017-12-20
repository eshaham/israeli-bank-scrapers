import _ from 'lodash';
import buildUrl from 'build-url';
import moment from 'moment';

import { BaseScraper, LOGIN_RESULT } from './base-scraper';
import { fetchGet, fetchPost } from '../helpers/fetch';
import { NORMAL_TXN_TYPE, INSTALLMENTS_TXN_TYPE } from '../constants';

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

async function fetchTransactions(page, startMoment, monthMoment) {
  const accounts = await fetchAccounts(page, monthMoment);
  const dataUrl = getTransactionsUrl(monthMoment);
  const dataResult = await fetchGet(page, dataUrl);
  if (_.get(dataResult, 'Header.Status') === '1' && dataResult.CardsTransactionsListBean) {
    const accountTxns = {};
    accounts.forEach((account) => {
      const txnGroups = _.get(dataResult, `CardsTransactionsListBean.Index${account.index}.CurrentCardTransactions`);
      if (txnGroups) {
        let allTxs = [];
        txnGroups.forEach((txnGroup) => {
          if (txnGroup.txnIsrael) {
            const txns = convertTransactions(txnGroup.txnIsrael, account.processedDate);
            allTxs.push(...txns);
          }
          if (txnGroup.txnAbroad) {
            const txns = convertTransactions(txnGroup.txnAbroad, account.processedDate);
            allTxs.push(...txns);
          }
        });
        allTxs = allTxs.filter(txn => startMoment.isSameOrBefore(txn.date));
        accountTxns[account.accountNumber] = {
          accountNumber: account.accountNumber,
          index: account.index,
          txns: allTxs,
        };
      }
    });
    return accountTxns;
  }

  return null;
}

async function fetchAllTransactions(page, startMoment) {
  let monthMoment = moment(startMoment).startOf('month');

  const allMonths = [];
  const startOfNextMonth = moment().startOf('month').add(1, 'month');
  while (monthMoment.isSameOrBefore(startOfNextMonth)) {
    allMonths.push(monthMoment);
    monthMoment = moment(monthMoment).add(1, 'month');
  }

  const results = await Promise.all(allMonths.map(async (monthMoment) => {
    return fetchTransactions(page, startMoment, monthMoment);
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
  constructor(options) {
    super('isracard', options);
  }

  async login(credentials) {
    await this.page.goto(`${BASE_URL}/personalarea/Login`);

    this.notify('logging in');

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
      this.notify('unknown error during login');
      return {
        success: false,
        errorType: LOGIN_RESULT.UNKNOWN_ERROR,
      };
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
        this.notify('login successful');
        return { success: true };
      }

      if (loginResult.status === '3') {
        this.notify('need to change password');
        return {
          success: false,
          errorType: LOGIN_RESULT.CHANGE_PASSWORD,
        };
      }

      this.notify('invalid password');
      return {
        success: false,
        errorType: LOGIN_RESULT.INVALID_PASSWORD,
      };
    }

    if (validateReturnCode === '4') {
      this.notify('need to change password');
      return {
        success: false,
        errorType: LOGIN_RESULT.CHANGE_PASSWORD,
      };
    }

    this.notify('invalid password');
    return {
      success: false,
      errorType: LOGIN_RESULT.INVALID_PASSWORD,
    };
  }

  async fetchData() {
    const defaultStartMoment = moment().subtract(1, 'years');
    const startDate = this.options.startDate || defaultStartMoment.toDate();
    const startMoment = moment.max(defaultStartMoment, moment(startDate));

    const txnsResult = await fetchAllTransactions(this.page, startMoment);
    if (txnsResult) {
      return {
        success: true,
        accountNumber: txnsResult.accountNumber,
        txns: txnsResult.txns,
      };
    }

    this.notify('unknown error while fetching data');
    return {
      success: false,
      errorType: LOGIN_RESULT.UNKNOWN_ERROR,
    };
  }
}

export default IsracardScraper;
