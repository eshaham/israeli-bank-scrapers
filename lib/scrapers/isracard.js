import _ from 'lodash';
import buildUrl from 'build-url';
import moment from 'moment';

import { BaseScraper, LOGIN_RESULT } from './base-scraper';
import { fetchGet, fetchPost } from '../helpers/fetch';

const BASE_URL = 'https://digital.isracard.co.il';
const SERVICES_URL = `${BASE_URL}/services/ProxyRequestHandler.ashx`;
const COUNTRY_CODE = '212';
const ID_TYPE = '1';

const DATE_FORMAT = 'DD/MM/YYYY';

function getTransactionsUrl(month, year) {
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

function convertTransactions(txns, processedDate) {
  return txns.map((txn) => {
    return {
      identifier: txn.voucherNumberRatz,
      date: moment(txn.fullPurchaseDate, DATE_FORMAT).toDate(),
      processedDate: moment(processedDate, DATE_FORMAT).toDate(),
      amount: txn.dealSum,
      description: txn.fullSupplierNameHeb,
    };
  });
}

async function fetchTransactions(page, month, year) {
  const dataUrl = getTransactionsUrl(month, year);
  const dataResult = await fetchGet(page, dataUrl);
  if (_.get(dataResult, 'Header.Status') === '1' && dataResult.CardsTransactionsListBean) {
    const cardsDetails = dataResult.CardsTransactionsListBean.cardNumberList;
    if (cardsDetails && cardsDetails.length) {
      const cardNumbers = cardsDetails.map((cardStr) => {
        return cardStr.substring(cardStr.length - 4);
      });
      const payDay = dataResult.CardsTransactionsListBean.payDay || '1';
      const processedDate = new Date(year, month, parseInt(payDay, 10));
      const txnGroups = _.get(dataResult, 'CardsTransactionsListBean.Index0.CurrentCardTransactions');
      if (txnGroups) {
        const allTxs = [];
        txnGroups.forEach((txnGroup) => {
          if (txnGroup.txnIsrael) {
            const txns = convertTransactions(txnGroup.txnIsrael, processedDate);
            allTxs.push(...txns);
          }
        });
        return {
          accountNumber: cardNumbers[0],
          txns: allTxs,
        };
      }
    }
  }

  return null;
}

class IsracardScraper extends BaseScraper {
  constructor() {
    super('isracard');
  }

  async login(credentials) {
    this.notify('logging in');

    await this.page.open(`${BASE_URL}/personalarea/Login`);

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
      const userName = validateResult.ValidateIdDataBean.userName;

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
    const month = startMoment.month();
    const year = startMoment.year();

    const txnsResult = await fetchTransactions(this.page, month, year);
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
