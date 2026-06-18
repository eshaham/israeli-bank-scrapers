"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _moment = _interopRequireDefault(require("moment"));
var _constants = require("../constants");
var _definitions = require("../definitions");
var _dates = _interopRequireDefault(require("../helpers/dates"));
var _debug = require("../helpers/debug");
var _fetch = require("../helpers/fetch");
var _arrays = require("../helpers/arrays");
var _transactions = require("../helpers/transactions");
var _waiting = require("../helpers/waiting");
var _transactions2 = require("../transactions");
var _baseScraperWithBrowser = require("./base-scraper-with-browser");
var _errors = require("./errors");
var _browser = require("../helpers/browser");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
const RATE_LIMIT = {
  SLEEP_BETWEEN: 1000,
  TRANSACTIONS_BATCH_SIZE: 10
};
const COUNTRY_CODE = '212';
const ID_TYPE = '1';
const INSTALLMENTS_KEYWORD = 'תשלום';
const DATE_FORMAT = 'DD/MM/YYYY';
const debug = (0, _debug.getDebug)('base-isracard-amex');
function getAccountsUrl(servicesUrl, monthMoment) {
  const billingDate = monthMoment.format('YYYY-MM-DD');
  const url = new URL(servicesUrl);
  url.searchParams.set('reqName', 'DashboardMonth');
  url.searchParams.set('actionCode', '0');
  url.searchParams.set('billingDate', billingDate);
  url.searchParams.set('format', 'Json');
  return url.toString();
}
async function fetchAccounts(page, servicesUrl, monthMoment) {
  const dataUrl = getAccountsUrl(servicesUrl, monthMoment);
  debug(`fetching accounts from ${dataUrl}`);
  const dataResult = await (0, _fetch.fetchGetWithinPage)(page, dataUrl);
  if (dataResult && dataResult.Header?.Status === '1' && dataResult.DashboardMonthBean) {
    const {
      cardsCharges
    } = dataResult.DashboardMonthBean;
    if (cardsCharges) {
      return cardsCharges.map(cardCharge => {
        return {
          index: parseInt(cardCharge.cardIndex, 10),
          accountNumber: cardCharge.cardNumber,
          processedDate: (0, _moment.default)(cardCharge.billingDate, DATE_FORMAT).toISOString()
        };
      });
    }
  }
  return [];
}
function getTransactionsUrl(servicesUrl, monthMoment) {
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
function convertCurrency(currencyStr) {
  if (currencyStr === _constants.SHEKEL_CURRENCY_KEYWORD || currencyStr === _constants.ALT_SHEKEL_CURRENCY) {
    return _constants.SHEKEL_CURRENCY;
  }
  return currencyStr;
}
function getInstallmentsInfo(txn) {
  if (!txn.moreInfo || !txn.moreInfo.includes(INSTALLMENTS_KEYWORD)) {
    return undefined;
  }
  const matches = txn.moreInfo.match(/\d+/g);
  if (!matches || matches.length < 2) {
    return undefined;
  }
  return {
    number: parseInt(matches[0], 10),
    total: parseInt(matches[1], 10)
  };
}
function getTransactionType(txn) {
  return getInstallmentsInfo(txn) ? _transactions2.TransactionTypes.Installments : _transactions2.TransactionTypes.Normal;
}
function convertTransactions(txns, processedDate, options) {
  const filteredTxns = txns.filter(txn => txn.dealSumType !== '1' && txn.voucherNumberRatz !== '000000000' && txn.voucherNumberRatzOutbound !== '000000000');
  return filteredTxns.map(txn => {
    const isOutbound = txn.dealSumOutbound;
    const txnDateStr = isOutbound ? txn.fullPurchaseDateOutbound : txn.fullPurchaseDate;
    const txnMoment = (0, _moment.default)(txnDateStr, DATE_FORMAT);
    const currentProcessedDate = txn.fullPaymentDate ? (0, _moment.default)(txn.fullPaymentDate, DATE_FORMAT).toISOString() : processedDate;
    const result = {
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
      status: _transactions2.TransactionStatuses.Completed
    };
    if (options?.includeRawTransaction) {
      result.rawTransaction = (0, _transactions.getRawTransaction)(txn);
    }
    return result;
  });
}
async function fetchTransactions(page, options, companyServiceOptions, startMoment, monthMoment) {
  const accounts = await fetchAccounts(page, companyServiceOptions.servicesUrl, monthMoment);
  const dataUrl = getTransactionsUrl(companyServiceOptions.servicesUrl, monthMoment);
  await (0, _waiting.sleep)(RATE_LIMIT.SLEEP_BETWEEN);
  debug(`fetching transactions from ${dataUrl} for month ${monthMoment.format('YYYY-MM')}`);
  const dataResult = await (0, _fetch.fetchGetWithinPage)(page, dataUrl);
  if (dataResult && dataResult.Header?.Status === '1' && dataResult.CardsTransactionsListBean) {
    const accountTxns = {};
    accounts.forEach(account => {
      const txnGroups = dataResult.CardsTransactionsListBean?.[`Index${account.index}`]?.CurrentCardTransactions;
      if (txnGroups) {
        let allTxns = [];
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
          allTxns = (0, _transactions.fixInstallments)(allTxns);
        }
        if (options.outputData?.enableTransactionsFilterByDate ?? true) {
          allTxns = (0, _transactions.filterOldTransactions)(allTxns, startMoment, options.combineInstallments || false);
        }
        accountTxns[account.accountNumber] = {
          accountNumber: account.accountNumber,
          index: account.index,
          txns: allTxns
        };
      }
    });
    return accountTxns;
  }
  return {};
}
async function getExtraScrapTransaction(page, options, month, accountIndex, transaction) {
  const url = new URL(options.servicesUrl);
  url.searchParams.set('reqName', 'PirteyIska_204');
  url.searchParams.set('CardIndex', accountIndex.toString());
  url.searchParams.set('shovarRatz', transaction.identifier.toString());
  url.searchParams.set('moedChiuv', month.format('MMYYYY'));
  debug(`fetching extra scrap for transaction ${transaction.identifier} for month ${month.format('YYYY-MM')}`);
  const data = await (0, _fetch.fetchGetWithinPage)(page, url.toString());
  if (!data) {
    return transaction;
  }
  const rawCategory = data.PirteyIska_204Bean?.sector ?? '';
  return {
    ...transaction,
    category: rawCategory.trim(),
    rawTransaction: (0, _transactions.getRawTransaction)(data, transaction)
  };
}
async function getExtraScrapAccount(page, options, accountMap, month) {
  const accounts = [];
  for (const account of Object.values(accountMap)) {
    debug(`get extra scrap for ${account.accountNumber} with ${account.txns.length} transactions`, month.format('YYYY-MM'));
    const txns = [];
    for (const txnsChunk of (0, _arrays.chunk)(account.txns, RATE_LIMIT.TRANSACTIONS_BATCH_SIZE)) {
      debug(`processing chunk of ${txnsChunk.length} transactions for account ${account.accountNumber}`);
      const updatedTxns = await Promise.all(txnsChunk.map(t => getExtraScrapTransaction(page, options, month, account.index, t)));
      await (0, _waiting.sleep)(RATE_LIMIT.SLEEP_BETWEEN);
      txns.push(...updatedTxns);
    }
    accounts.push({
      ...account,
      txns
    });
  }
  return accounts.reduce((m, x) => ({
    ...m,
    [x.accountNumber]: x
  }), {});
}
async function getAdditionalTransactionInformation(scraperOptions, accountsWithIndex, page, options, allMonths) {
  if (!scraperOptions.additionalTransactionInformation || scraperOptions.optInFeatures?.includes('isracard-amex:skipAdditionalTransactionInformation')) {
    return accountsWithIndex;
  }
  return (0, _waiting.runSerial)(accountsWithIndex.map((a, i) => () => getExtraScrapAccount(page, options, a, allMonths[i])));
}
async function fetchAllTransactions(page, options, companyServiceOptions, startMoment) {
  const futureMonthsToScrape = options.futureMonthsToScrape ?? 1;
  const allMonths = (0, _dates.default)(startMoment, futureMonthsToScrape);
  const results = await (0, _waiting.runSerial)(allMonths.map(monthMoment => () => {
    return fetchTransactions(page, options, companyServiceOptions, startMoment, monthMoment);
  }));
  const finalResult = await getAdditionalTransactionInformation(options, results, page, companyServiceOptions, allMonths);
  const combinedTxns = {};
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
      txns: combinedTxns[accountNumber]
    };
  });
  return {
    success: true,
    accounts
  };
}
class IsracardAmexBaseScraper extends _baseScraperWithBrowser.BaseScraperWithBrowser {
  constructor(options, baseUrl, companyCode) {
    super(options);
    this.baseUrl = baseUrl;
    this.companyCode = companyCode;
    this.servicesUrl = `${baseUrl}/services/ProxyRequestHandler.ashx`;
  }
  async login(credentials) {
    await this.page.setRequestInterception(true);
    this.page.on('request', request => {
      if (request.url().includes('detector-dom.min.js')) {
        debug('force abort for request do download detector-dom.min.js resource');
        void request.abort(undefined, _browser.interceptionPriorities.abort);
      } else {
        void request.continue(undefined, _browser.interceptionPriorities.continue);
      }
    });
    await (0, _browser.maskHeadlessUserAgent)(this.page);
    await this.navigateTo(`${this.baseUrl}/personalarea/Login`);
    this.emitProgress(_definitions.ScraperProgressTypes.LoggingIn);
    const validateUrl = `${this.servicesUrl}?reqName=ValidateIdData`;
    const validateRequest = {
      id: credentials.id,
      cardSuffix: credentials.card6Digits,
      countryCode: COUNTRY_CODE,
      idType: ID_TYPE,
      checkLevel: '1',
      companyCode: this.companyCode
    };
    debug('logging in with validate request');
    const validateResult = await (0, _fetch.fetchPostWithinPage)(this.page, validateUrl, validateRequest);
    if (!validateResult || !validateResult.Header || validateResult.Header.Status !== '1' || !validateResult.ValidateIdDataBean) {
      throw new Error('unknown error during login');
    }
    const validateReturnCode = validateResult.ValidateIdDataBean.returnCode;
    debug(`user validate with return code '${validateReturnCode}'`);
    if (validateReturnCode === '1') {
      const {
        userName
      } = validateResult.ValidateIdDataBean;
      const loginUrl = `${this.servicesUrl}?reqName=performLogonI`;
      const request = {
        KodMishtamesh: userName,
        MisparZihuy: credentials.id,
        Sisma: credentials.password,
        cardSuffix: credentials.card6Digits,
        countryCode: COUNTRY_CODE,
        idType: ID_TYPE
      };
      debug('user login started');
      const loginResult = await (0, _fetch.fetchPostWithinPage)(this.page, loginUrl, request);
      debug(`user login with status '${loginResult?.status}'`, loginResult);
      if (loginResult && loginResult.status === '1') {
        this.emitProgress(_definitions.ScraperProgressTypes.LoginSuccess);
        return {
          success: true
        };
      }
      if (loginResult && loginResult.status === '3') {
        this.emitProgress(_definitions.ScraperProgressTypes.ChangePassword);
        return {
          success: false,
          errorType: _errors.ScraperErrorTypes.ChangePassword
        };
      }
      this.emitProgress(_definitions.ScraperProgressTypes.LoginFailed);
      return {
        success: false,
        errorType: _errors.ScraperErrorTypes.InvalidPassword
      };
    }
    if (validateReturnCode === '4') {
      this.emitProgress(_definitions.ScraperProgressTypes.ChangePassword);
      return {
        success: false,
        errorType: _errors.ScraperErrorTypes.ChangePassword
      };
    }
    this.emitProgress(_definitions.ScraperProgressTypes.LoginFailed);
    return {
      success: false,
      errorType: _errors.ScraperErrorTypes.InvalidPassword
    };
  }
  async fetchData() {
    const defaultStartMoment = (0, _moment.default)().subtract(1, 'years');
    const startDate = this.options.startDate || defaultStartMoment.toDate();
    const startMoment = _moment.default.max(defaultStartMoment, (0, _moment.default)(startDate));
    return fetchAllTransactions(this.page, this.options, {
      servicesUrl: this.servicesUrl,
      companyCode: this.companyCode
    }, startMoment);
  }
}
var _default = exports.default = IsracardAmexBaseScraper;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfbW9tZW50IiwiX2ludGVyb3BSZXF1aXJlRGVmYXVsdCIsInJlcXVpcmUiLCJfY29uc3RhbnRzIiwiX2RlZmluaXRpb25zIiwiX2RhdGVzIiwiX2RlYnVnIiwiX2ZldGNoIiwiX2FycmF5cyIsIl90cmFuc2FjdGlvbnMiLCJfd2FpdGluZyIsIl90cmFuc2FjdGlvbnMyIiwiX2Jhc2VTY3JhcGVyV2l0aEJyb3dzZXIiLCJfZXJyb3JzIiwiX2Jyb3dzZXIiLCJlIiwiX19lc01vZHVsZSIsImRlZmF1bHQiLCJSQVRFX0xJTUlUIiwiU0xFRVBfQkVUV0VFTiIsIlRSQU5TQUNUSU9OU19CQVRDSF9TSVpFIiwiQ09VTlRSWV9DT0RFIiwiSURfVFlQRSIsIklOU1RBTExNRU5UU19LRVlXT1JEIiwiREFURV9GT1JNQVQiLCJkZWJ1ZyIsImdldERlYnVnIiwiZ2V0QWNjb3VudHNVcmwiLCJzZXJ2aWNlc1VybCIsIm1vbnRoTW9tZW50IiwiYmlsbGluZ0RhdGUiLCJmb3JtYXQiLCJ1cmwiLCJVUkwiLCJzZWFyY2hQYXJhbXMiLCJzZXQiLCJ0b1N0cmluZyIsImZldGNoQWNjb3VudHMiLCJwYWdlIiwiZGF0YVVybCIsImRhdGFSZXN1bHQiLCJmZXRjaEdldFdpdGhpblBhZ2UiLCJIZWFkZXIiLCJTdGF0dXMiLCJEYXNoYm9hcmRNb250aEJlYW4iLCJjYXJkc0NoYXJnZXMiLCJtYXAiLCJjYXJkQ2hhcmdlIiwiaW5kZXgiLCJwYXJzZUludCIsImNhcmRJbmRleCIsImFjY291bnROdW1iZXIiLCJjYXJkTnVtYmVyIiwicHJvY2Vzc2VkRGF0ZSIsIm1vbWVudCIsInRvSVNPU3RyaW5nIiwiZ2V0VHJhbnNhY3Rpb25zVXJsIiwibW9udGgiLCJ5ZWFyIiwibW9udGhTdHIiLCJjb252ZXJ0Q3VycmVuY3kiLCJjdXJyZW5jeVN0ciIsIlNIRUtFTF9DVVJSRU5DWV9LRVlXT1JEIiwiQUxUX1NIRUtFTF9DVVJSRU5DWSIsIlNIRUtFTF9DVVJSRU5DWSIsImdldEluc3RhbGxtZW50c0luZm8iLCJ0eG4iLCJtb3JlSW5mbyIsImluY2x1ZGVzIiwidW5kZWZpbmVkIiwibWF0Y2hlcyIsIm1hdGNoIiwibGVuZ3RoIiwibnVtYmVyIiwidG90YWwiLCJnZXRUcmFuc2FjdGlvblR5cGUiLCJUcmFuc2FjdGlvblR5cGVzIiwiSW5zdGFsbG1lbnRzIiwiTm9ybWFsIiwiY29udmVydFRyYW5zYWN0aW9ucyIsInR4bnMiLCJvcHRpb25zIiwiZmlsdGVyZWRUeG5zIiwiZmlsdGVyIiwiZGVhbFN1bVR5cGUiLCJ2b3VjaGVyTnVtYmVyUmF0eiIsInZvdWNoZXJOdW1iZXJSYXR6T3V0Ym91bmQiLCJpc091dGJvdW5kIiwiZGVhbFN1bU91dGJvdW5kIiwidHhuRGF0ZVN0ciIsImZ1bGxQdXJjaGFzZURhdGVPdXRib3VuZCIsImZ1bGxQdXJjaGFzZURhdGUiLCJ0eG5Nb21lbnQiLCJjdXJyZW50UHJvY2Vzc2VkRGF0ZSIsImZ1bGxQYXltZW50RGF0ZSIsInJlc3VsdCIsInR5cGUiLCJpZGVudGlmaWVyIiwiZGF0ZSIsIm9yaWdpbmFsQW1vdW50IiwiZGVhbFN1bSIsIm9yaWdpbmFsQ3VycmVuY3kiLCJjdXJyZW50UGF5bWVudEN1cnJlbmN5IiwiY3VycmVuY3lJZCIsImNoYXJnZWRBbW91bnQiLCJwYXltZW50U3VtT3V0Ym91bmQiLCJwYXltZW50U3VtIiwiY2hhcmdlZEN1cnJlbmN5IiwiZGVzY3JpcHRpb24iLCJmdWxsU3VwcGxpZXJOYW1lT3V0Ym91bmQiLCJmdWxsU3VwcGxpZXJOYW1lSGViIiwibWVtbyIsImluc3RhbGxtZW50cyIsInN0YXR1cyIsIlRyYW5zYWN0aW9uU3RhdHVzZXMiLCJDb21wbGV0ZWQiLCJpbmNsdWRlUmF3VHJhbnNhY3Rpb24iLCJyYXdUcmFuc2FjdGlvbiIsImdldFJhd1RyYW5zYWN0aW9uIiwiZmV0Y2hUcmFuc2FjdGlvbnMiLCJjb21wYW55U2VydmljZU9wdGlvbnMiLCJzdGFydE1vbWVudCIsImFjY291bnRzIiwic2xlZXAiLCJDYXJkc1RyYW5zYWN0aW9uc0xpc3RCZWFuIiwiYWNjb3VudFR4bnMiLCJmb3JFYWNoIiwiYWNjb3VudCIsInR4bkdyb3VwcyIsIkN1cnJlbnRDYXJkVHJhbnNhY3Rpb25zIiwiYWxsVHhucyIsInR4bkdyb3VwIiwidHhuSXNyYWVsIiwicHVzaCIsInR4bkFicm9hZCIsImNvbWJpbmVJbnN0YWxsbWVudHMiLCJmaXhJbnN0YWxsbWVudHMiLCJvdXRwdXREYXRhIiwiZW5hYmxlVHJhbnNhY3Rpb25zRmlsdGVyQnlEYXRlIiwiZmlsdGVyT2xkVHJhbnNhY3Rpb25zIiwiZ2V0RXh0cmFTY3JhcFRyYW5zYWN0aW9uIiwiYWNjb3VudEluZGV4IiwidHJhbnNhY3Rpb24iLCJkYXRhIiwicmF3Q2F0ZWdvcnkiLCJQaXJ0ZXlJc2thXzIwNEJlYW4iLCJzZWN0b3IiLCJjYXRlZ29yeSIsInRyaW0iLCJnZXRFeHRyYVNjcmFwQWNjb3VudCIsImFjY291bnRNYXAiLCJPYmplY3QiLCJ2YWx1ZXMiLCJ0eG5zQ2h1bmsiLCJjaHVuayIsInVwZGF0ZWRUeG5zIiwiUHJvbWlzZSIsImFsbCIsInQiLCJyZWR1Y2UiLCJtIiwieCIsImdldEFkZGl0aW9uYWxUcmFuc2FjdGlvbkluZm9ybWF0aW9uIiwic2NyYXBlck9wdGlvbnMiLCJhY2NvdW50c1dpdGhJbmRleCIsImFsbE1vbnRocyIsImFkZGl0aW9uYWxUcmFuc2FjdGlvbkluZm9ybWF0aW9uIiwib3B0SW5GZWF0dXJlcyIsInJ1blNlcmlhbCIsImEiLCJpIiwiZmV0Y2hBbGxUcmFuc2FjdGlvbnMiLCJmdXR1cmVNb250aHNUb1NjcmFwZSIsImdldEFsbE1vbnRoTW9tZW50cyIsInJlc3VsdHMiLCJmaW5hbFJlc3VsdCIsImNvbWJpbmVkVHhucyIsImtleXMiLCJ0eG5zRm9yQWNjb3VudCIsInRvQmVBZGRlZFR4bnMiLCJzdWNjZXNzIiwiSXNyYWNhcmRBbWV4QmFzZVNjcmFwZXIiLCJCYXNlU2NyYXBlcldpdGhCcm93c2VyIiwiY29uc3RydWN0b3IiLCJiYXNlVXJsIiwiY29tcGFueUNvZGUiLCJsb2dpbiIsImNyZWRlbnRpYWxzIiwic2V0UmVxdWVzdEludGVyY2VwdGlvbiIsIm9uIiwicmVxdWVzdCIsImFib3J0IiwiaW50ZXJjZXB0aW9uUHJpb3JpdGllcyIsImNvbnRpbnVlIiwibWFza0hlYWRsZXNzVXNlckFnZW50IiwibmF2aWdhdGVUbyIsImVtaXRQcm9ncmVzcyIsIlNjcmFwZXJQcm9ncmVzc1R5cGVzIiwiTG9nZ2luZ0luIiwidmFsaWRhdGVVcmwiLCJ2YWxpZGF0ZVJlcXVlc3QiLCJpZCIsImNhcmRTdWZmaXgiLCJjYXJkNkRpZ2l0cyIsImNvdW50cnlDb2RlIiwiaWRUeXBlIiwiY2hlY2tMZXZlbCIsInZhbGlkYXRlUmVzdWx0IiwiZmV0Y2hQb3N0V2l0aGluUGFnZSIsIlZhbGlkYXRlSWREYXRhQmVhbiIsIkVycm9yIiwidmFsaWRhdGVSZXR1cm5Db2RlIiwicmV0dXJuQ29kZSIsInVzZXJOYW1lIiwibG9naW5VcmwiLCJLb2RNaXNodGFtZXNoIiwiTWlzcGFyWmlodXkiLCJTaXNtYSIsInBhc3N3b3JkIiwibG9naW5SZXN1bHQiLCJMb2dpblN1Y2Nlc3MiLCJDaGFuZ2VQYXNzd29yZCIsImVycm9yVHlwZSIsIlNjcmFwZXJFcnJvclR5cGVzIiwiTG9naW5GYWlsZWQiLCJJbnZhbGlkUGFzc3dvcmQiLCJmZXRjaERhdGEiLCJkZWZhdWx0U3RhcnRNb21lbnQiLCJzdWJ0cmFjdCIsInN0YXJ0RGF0ZSIsInRvRGF0ZSIsIm1heCIsIl9kZWZhdWx0IiwiZXhwb3J0cyJdLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9zY3JhcGVycy9iYXNlLWlzcmFjYXJkLWFtZXgudHMiXSwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IG1vbWVudCwgeyB0eXBlIE1vbWVudCB9IGZyb20gJ21vbWVudCc7XG5pbXBvcnQgeyB0eXBlIFBhZ2UgfSBmcm9tICdwdXBwZXRlZXInO1xuaW1wb3J0IHsgQUxUX1NIRUtFTF9DVVJSRU5DWSwgU0hFS0VMX0NVUlJFTkNZLCBTSEVLRUxfQ1VSUkVOQ1lfS0VZV09SRCB9IGZyb20gJy4uL2NvbnN0YW50cyc7XG5pbXBvcnQgeyBTY3JhcGVyUHJvZ3Jlc3NUeXBlcyB9IGZyb20gJy4uL2RlZmluaXRpb25zJztcbmltcG9ydCBnZXRBbGxNb250aE1vbWVudHMgZnJvbSAnLi4vaGVscGVycy9kYXRlcyc7XG5pbXBvcnQgeyBnZXREZWJ1ZyB9IGZyb20gJy4uL2hlbHBlcnMvZGVidWcnO1xuaW1wb3J0IHsgZmV0Y2hHZXRXaXRoaW5QYWdlLCBmZXRjaFBvc3RXaXRoaW5QYWdlIH0gZnJvbSAnLi4vaGVscGVycy9mZXRjaCc7XG5pbXBvcnQgeyBjaHVuayB9IGZyb20gJy4uL2hlbHBlcnMvYXJyYXlzJztcbmltcG9ydCB7IGZpbHRlck9sZFRyYW5zYWN0aW9ucywgZml4SW5zdGFsbG1lbnRzLCBnZXRSYXdUcmFuc2FjdGlvbiB9IGZyb20gJy4uL2hlbHBlcnMvdHJhbnNhY3Rpb25zJztcbmltcG9ydCB7IHJ1blNlcmlhbCwgc2xlZXAgfSBmcm9tICcuLi9oZWxwZXJzL3dhaXRpbmcnO1xuaW1wb3J0IHtcbiAgVHJhbnNhY3Rpb25TdGF0dXNlcyxcbiAgVHJhbnNhY3Rpb25UeXBlcyxcbiAgdHlwZSBUcmFuc2FjdGlvbixcbiAgdHlwZSBUcmFuc2FjdGlvbkluc3RhbGxtZW50cyxcbiAgdHlwZSBUcmFuc2FjdGlvbnNBY2NvdW50LFxufSBmcm9tICcuLi90cmFuc2FjdGlvbnMnO1xuaW1wb3J0IHsgQmFzZVNjcmFwZXJXaXRoQnJvd3NlciB9IGZyb20gJy4vYmFzZS1zY3JhcGVyLXdpdGgtYnJvd3Nlcic7XG5pbXBvcnQgeyBTY3JhcGVyRXJyb3JUeXBlcyB9IGZyb20gJy4vZXJyb3JzJztcbmltcG9ydCB7IHR5cGUgU2NyYXBlck9wdGlvbnMsIHR5cGUgU2NyYXBlclNjcmFwaW5nUmVzdWx0IH0gZnJvbSAnLi9pbnRlcmZhY2UnO1xuaW1wb3J0IHsgaW50ZXJjZXB0aW9uUHJpb3JpdGllcywgbWFza0hlYWRsZXNzVXNlckFnZW50IH0gZnJvbSAnLi4vaGVscGVycy9icm93c2VyJztcblxuY29uc3QgUkFURV9MSU1JVCA9IHtcbiAgU0xFRVBfQkVUV0VFTjogMTAwMCxcbiAgVFJBTlNBQ1RJT05TX0JBVENIX1NJWkU6IDEwLFxufSBhcyBjb25zdDtcblxuY29uc3QgQ09VTlRSWV9DT0RFID0gJzIxMic7XG5jb25zdCBJRF9UWVBFID0gJzEnO1xuY29uc3QgSU5TVEFMTE1FTlRTX0tFWVdPUkQgPSAn16rXqdec15XXnSc7XG5cbmNvbnN0IERBVEVfRk9STUFUID0gJ0REL01NL1lZWVknO1xuXG5jb25zdCBkZWJ1ZyA9IGdldERlYnVnKCdiYXNlLWlzcmFjYXJkLWFtZXgnKTtcblxudHlwZSBDb21wYW55U2VydmljZU9wdGlvbnMgPSB7XG4gIHNlcnZpY2VzVXJsOiBzdHJpbmc7XG4gIGNvbXBhbnlDb2RlOiBzdHJpbmc7XG59O1xuXG50eXBlIFNjcmFwZWRBY2NvdW50c1dpdGhJbmRleCA9IFJlY29yZDxzdHJpbmcsIFRyYW5zYWN0aW9uc0FjY291bnQgJiB7IGluZGV4OiBudW1iZXIgfT47XG5cbmludGVyZmFjZSBTY3JhcGVkVHJhbnNhY3Rpb24ge1xuICBkZWFsU3VtVHlwZTogc3RyaW5nO1xuICB2b3VjaGVyTnVtYmVyUmF0ek91dGJvdW5kOiBzdHJpbmc7XG4gIHZvdWNoZXJOdW1iZXJSYXR6OiBzdHJpbmc7XG4gIG1vcmVJbmZvPzogc3RyaW5nO1xuICBkZWFsU3VtT3V0Ym91bmQ6IGJvb2xlYW47XG4gIGN1cnJlbmN5SWQ6IHN0cmluZztcbiAgY3VycmVudFBheW1lbnRDdXJyZW5jeTogc3RyaW5nO1xuICBkZWFsU3VtOiBudW1iZXI7XG4gIGZ1bGxQYXltZW50RGF0ZT86IHN0cmluZztcbiAgZnVsbFB1cmNoYXNlRGF0ZT86IHN0cmluZztcbiAgZnVsbFB1cmNoYXNlRGF0ZU91dGJvdW5kPzogc3RyaW5nO1xuICBmdWxsU3VwcGxpZXJOYW1lSGViOiBzdHJpbmc7XG4gIGZ1bGxTdXBwbGllck5hbWVPdXRib3VuZDogc3RyaW5nO1xuICBwYXltZW50U3VtOiBudW1iZXI7XG4gIHBheW1lbnRTdW1PdXRib3VuZDogbnVtYmVyO1xufVxuXG5pbnRlcmZhY2UgU2NyYXBlZEFjY291bnQge1xuICBpbmRleDogbnVtYmVyO1xuICBhY2NvdW50TnVtYmVyOiBzdHJpbmc7XG4gIHByb2Nlc3NlZERhdGU6IHN0cmluZztcbn1cblxuaW50ZXJmYWNlIFNjcmFwZWRMb2dpblZhbGlkYXRpb24ge1xuICBIZWFkZXI6IHtcbiAgICBTdGF0dXM6IHN0cmluZztcbiAgfTtcbiAgVmFsaWRhdGVJZERhdGFCZWFuPzoge1xuICAgIHVzZXJOYW1lPzogc3RyaW5nO1xuICAgIHJldHVybkNvZGU6IHN0cmluZztcbiAgfTtcbn1cblxuaW50ZXJmYWNlIFNjcmFwZWRBY2NvdW50c1dpdGhpblBhZ2VSZXNwb25zZSB7XG4gIEhlYWRlcjoge1xuICAgIFN0YXR1czogc3RyaW5nO1xuICB9O1xuICBEYXNoYm9hcmRNb250aEJlYW4/OiB7XG4gICAgY2FyZHNDaGFyZ2VzOiB7XG4gICAgICBjYXJkSW5kZXg6IHN0cmluZztcbiAgICAgIGNhcmROdW1iZXI6IHN0cmluZztcbiAgICAgIGJpbGxpbmdEYXRlOiBzdHJpbmc7XG4gICAgfVtdO1xuICB9O1xufVxuXG5pbnRlcmZhY2UgU2NyYXBlZEN1cnJlbnRDYXJkVHJhbnNhY3Rpb25zIHtcbiAgdHhuSXNyYWVsPzogU2NyYXBlZFRyYW5zYWN0aW9uW107XG4gIHR4bkFicm9hZD86IFNjcmFwZWRUcmFuc2FjdGlvbltdO1xufVxuXG5pbnRlcmZhY2UgU2NyYXBlZFRyYW5zYWN0aW9uRGF0YSB7XG4gIEhlYWRlcj86IHtcbiAgICBTdGF0dXM6IHN0cmluZztcbiAgfTtcbiAgUGlydGV5SXNrYV8yMDRCZWFuPzoge1xuICAgIHNlY3Rvcjogc3RyaW5nO1xuICB9O1xuXG4gIENhcmRzVHJhbnNhY3Rpb25zTGlzdEJlYW4/OiBSZWNvcmQ8XG4gICAgc3RyaW5nLFxuICAgIHtcbiAgICAgIEN1cnJlbnRDYXJkVHJhbnNhY3Rpb25zOiBTY3JhcGVkQ3VycmVudENhcmRUcmFuc2FjdGlvbnNbXTtcbiAgICB9XG4gID47XG59XG5cbmZ1bmN0aW9uIGdldEFjY291bnRzVXJsKHNlcnZpY2VzVXJsOiBzdHJpbmcsIG1vbnRoTW9tZW50OiBNb21lbnQpIHtcbiAgY29uc3QgYmlsbGluZ0RhdGUgPSBtb250aE1vbWVudC5mb3JtYXQoJ1lZWVktTU0tREQnKTtcbiAgY29uc3QgdXJsID0gbmV3IFVSTChzZXJ2aWNlc1VybCk7XG4gIHVybC5zZWFyY2hQYXJhbXMuc2V0KCdyZXFOYW1lJywgJ0Rhc2hib2FyZE1vbnRoJyk7XG4gIHVybC5zZWFyY2hQYXJhbXMuc2V0KCdhY3Rpb25Db2RlJywgJzAnKTtcbiAgdXJsLnNlYXJjaFBhcmFtcy5zZXQoJ2JpbGxpbmdEYXRlJywgYmlsbGluZ0RhdGUpO1xuICB1cmwuc2VhcmNoUGFyYW1zLnNldCgnZm9ybWF0JywgJ0pzb24nKTtcbiAgcmV0dXJuIHVybC50b1N0cmluZygpO1xufVxuXG5hc3luYyBmdW5jdGlvbiBmZXRjaEFjY291bnRzKHBhZ2U6IFBhZ2UsIHNlcnZpY2VzVXJsOiBzdHJpbmcsIG1vbnRoTW9tZW50OiBNb21lbnQpOiBQcm9taXNlPFNjcmFwZWRBY2NvdW50W10+IHtcbiAgY29uc3QgZGF0YVVybCA9IGdldEFjY291bnRzVXJsKHNlcnZpY2VzVXJsLCBtb250aE1vbWVudCk7XG4gIGRlYnVnKGBmZXRjaGluZyBhY2NvdW50cyBmcm9tICR7ZGF0YVVybH1gKTtcbiAgY29uc3QgZGF0YVJlc3VsdCA9IGF3YWl0IGZldGNoR2V0V2l0aGluUGFnZTxTY3JhcGVkQWNjb3VudHNXaXRoaW5QYWdlUmVzcG9uc2U+KHBhZ2UsIGRhdGFVcmwpO1xuICBpZiAoZGF0YVJlc3VsdCAmJiBkYXRhUmVzdWx0LkhlYWRlcj8uU3RhdHVzID09PSAnMScgJiYgZGF0YVJlc3VsdC5EYXNoYm9hcmRNb250aEJlYW4pIHtcbiAgICBjb25zdCB7IGNhcmRzQ2hhcmdlcyB9ID0gZGF0YVJlc3VsdC5EYXNoYm9hcmRNb250aEJlYW47XG4gICAgaWYgKGNhcmRzQ2hhcmdlcykge1xuICAgICAgcmV0dXJuIGNhcmRzQ2hhcmdlcy5tYXAoY2FyZENoYXJnZSA9PiB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgaW5kZXg6IHBhcnNlSW50KGNhcmRDaGFyZ2UuY2FyZEluZGV4LCAxMCksXG4gICAgICAgICAgYWNjb3VudE51bWJlcjogY2FyZENoYXJnZS5jYXJkTnVtYmVyLFxuICAgICAgICAgIHByb2Nlc3NlZERhdGU6IG1vbWVudChjYXJkQ2hhcmdlLmJpbGxpbmdEYXRlLCBEQVRFX0ZPUk1BVCkudG9JU09TdHJpbmcoKSxcbiAgICAgICAgfTtcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuICByZXR1cm4gW107XG59XG5cbmZ1bmN0aW9uIGdldFRyYW5zYWN0aW9uc1VybChzZXJ2aWNlc1VybDogc3RyaW5nLCBtb250aE1vbWVudDogTW9tZW50KSB7XG4gIGNvbnN0IG1vbnRoID0gbW9udGhNb21lbnQubW9udGgoKSArIDE7XG4gIGNvbnN0IHllYXIgPSBtb250aE1vbWVudC55ZWFyKCk7XG4gIGNvbnN0IG1vbnRoU3RyID0gbW9udGggPCAxMCA/IGAwJHttb250aH1gIDogbW9udGgudG9TdHJpbmcoKTtcbiAgY29uc3QgdXJsID0gbmV3IFVSTChzZXJ2aWNlc1VybCk7XG4gIHVybC5zZWFyY2hQYXJhbXMuc2V0KCdyZXFOYW1lJywgJ0NhcmRzVHJhbnNhY3Rpb25zTGlzdCcpO1xuICB1cmwuc2VhcmNoUGFyYW1zLnNldCgnbW9udGgnLCBtb250aFN0cik7XG4gIHVybC5zZWFyY2hQYXJhbXMuc2V0KCd5ZWFyJywgYCR7eWVhcn1gKTtcbiAgdXJsLnNlYXJjaFBhcmFtcy5zZXQoJ3JlcXVpcmVkRGF0ZScsICdOJyk7XG4gIHJldHVybiB1cmwudG9TdHJpbmcoKTtcbn1cblxuZnVuY3Rpb24gY29udmVydEN1cnJlbmN5KGN1cnJlbmN5U3RyOiBzdHJpbmcpIHtcbiAgaWYgKGN1cnJlbmN5U3RyID09PSBTSEVLRUxfQ1VSUkVOQ1lfS0VZV09SRCB8fCBjdXJyZW5jeVN0ciA9PT0gQUxUX1NIRUtFTF9DVVJSRU5DWSkge1xuICAgIHJldHVybiBTSEVLRUxfQ1VSUkVOQ1k7XG4gIH1cbiAgcmV0dXJuIGN1cnJlbmN5U3RyO1xufVxuXG5mdW5jdGlvbiBnZXRJbnN0YWxsbWVudHNJbmZvKHR4bjogU2NyYXBlZFRyYW5zYWN0aW9uKTogVHJhbnNhY3Rpb25JbnN0YWxsbWVudHMgfCB1bmRlZmluZWQge1xuICBpZiAoIXR4bi5tb3JlSW5mbyB8fCAhdHhuLm1vcmVJbmZvLmluY2x1ZGVzKElOU1RBTExNRU5UU19LRVlXT1JEKSkge1xuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cbiAgY29uc3QgbWF0Y2hlcyA9IHR4bi5tb3JlSW5mby5tYXRjaCgvXFxkKy9nKTtcbiAgaWYgKCFtYXRjaGVzIHx8IG1hdGNoZXMubGVuZ3RoIDwgMikge1xuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cblxuICByZXR1cm4ge1xuICAgIG51bWJlcjogcGFyc2VJbnQobWF0Y2hlc1swXSwgMTApLFxuICAgIHRvdGFsOiBwYXJzZUludChtYXRjaGVzWzFdLCAxMCksXG4gIH07XG59XG5cbmZ1bmN0aW9uIGdldFRyYW5zYWN0aW9uVHlwZSh0eG46IFNjcmFwZWRUcmFuc2FjdGlvbikge1xuICByZXR1cm4gZ2V0SW5zdGFsbG1lbnRzSW5mbyh0eG4pID8gVHJhbnNhY3Rpb25UeXBlcy5JbnN0YWxsbWVudHMgOiBUcmFuc2FjdGlvblR5cGVzLk5vcm1hbDtcbn1cblxuZnVuY3Rpb24gY29udmVydFRyYW5zYWN0aW9ucyhcbiAgdHhuczogU2NyYXBlZFRyYW5zYWN0aW9uW10sXG4gIHByb2Nlc3NlZERhdGU6IHN0cmluZyxcbiAgb3B0aW9ucz86IFNjcmFwZXJPcHRpb25zLFxuKTogVHJhbnNhY3Rpb25bXSB7XG4gIGNvbnN0IGZpbHRlcmVkVHhucyA9IHR4bnMuZmlsdGVyKFxuICAgIHR4biA9PlxuICAgICAgdHhuLmRlYWxTdW1UeXBlICE9PSAnMScgJiYgdHhuLnZvdWNoZXJOdW1iZXJSYXR6ICE9PSAnMDAwMDAwMDAwJyAmJiB0eG4udm91Y2hlck51bWJlclJhdHpPdXRib3VuZCAhPT0gJzAwMDAwMDAwMCcsXG4gICk7XG5cbiAgcmV0dXJuIGZpbHRlcmVkVHhucy5tYXAodHhuID0+IHtcbiAgICBjb25zdCBpc091dGJvdW5kID0gdHhuLmRlYWxTdW1PdXRib3VuZDtcbiAgICBjb25zdCB0eG5EYXRlU3RyID0gaXNPdXRib3VuZCA/IHR4bi5mdWxsUHVyY2hhc2VEYXRlT3V0Ym91bmQgOiB0eG4uZnVsbFB1cmNoYXNlRGF0ZTtcbiAgICBjb25zdCB0eG5Nb21lbnQgPSBtb21lbnQodHhuRGF0ZVN0ciwgREFURV9GT1JNQVQpO1xuXG4gICAgY29uc3QgY3VycmVudFByb2Nlc3NlZERhdGUgPSB0eG4uZnVsbFBheW1lbnREYXRlXG4gICAgICA/IG1vbWVudCh0eG4uZnVsbFBheW1lbnREYXRlLCBEQVRFX0ZPUk1BVCkudG9JU09TdHJpbmcoKVxuICAgICAgOiBwcm9jZXNzZWREYXRlO1xuICAgIGNvbnN0IHJlc3VsdDogVHJhbnNhY3Rpb24gPSB7XG4gICAgICB0eXBlOiBnZXRUcmFuc2FjdGlvblR5cGUodHhuKSxcbiAgICAgIGlkZW50aWZpZXI6IHBhcnNlSW50KGlzT3V0Ym91bmQgPyB0eG4udm91Y2hlck51bWJlclJhdHpPdXRib3VuZCA6IHR4bi52b3VjaGVyTnVtYmVyUmF0eiwgMTApLFxuICAgICAgZGF0ZTogdHhuTW9tZW50LnRvSVNPU3RyaW5nKCksXG4gICAgICBwcm9jZXNzZWREYXRlOiBjdXJyZW50UHJvY2Vzc2VkRGF0ZSxcbiAgICAgIG9yaWdpbmFsQW1vdW50OiBpc091dGJvdW5kID8gLXR4bi5kZWFsU3VtT3V0Ym91bmQgOiAtdHhuLmRlYWxTdW0sXG4gICAgICBvcmlnaW5hbEN1cnJlbmN5OiBjb252ZXJ0Q3VycmVuY3kodHhuLmN1cnJlbnRQYXltZW50Q3VycmVuY3kgPz8gdHhuLmN1cnJlbmN5SWQpLFxuICAgICAgY2hhcmdlZEFtb3VudDogaXNPdXRib3VuZCA/IC10eG4ucGF5bWVudFN1bU91dGJvdW5kIDogLXR4bi5wYXltZW50U3VtLFxuICAgICAgY2hhcmdlZEN1cnJlbmN5OiBjb252ZXJ0Q3VycmVuY3kodHhuLmN1cnJlbmN5SWQpLFxuICAgICAgZGVzY3JpcHRpb246IGlzT3V0Ym91bmQgPyB0eG4uZnVsbFN1cHBsaWVyTmFtZU91dGJvdW5kIDogdHhuLmZ1bGxTdXBwbGllck5hbWVIZWIsXG4gICAgICBtZW1vOiB0eG4ubW9yZUluZm8gfHwgJycsXG4gICAgICBpbnN0YWxsbWVudHM6IGdldEluc3RhbGxtZW50c0luZm8odHhuKSB8fCB1bmRlZmluZWQsXG4gICAgICBzdGF0dXM6IFRyYW5zYWN0aW9uU3RhdHVzZXMuQ29tcGxldGVkLFxuICAgIH07XG5cbiAgICBpZiAob3B0aW9ucz8uaW5jbHVkZVJhd1RyYW5zYWN0aW9uKSB7XG4gICAgICByZXN1bHQucmF3VHJhbnNhY3Rpb24gPSBnZXRSYXdUcmFuc2FjdGlvbih0eG4pO1xuICAgIH1cblxuICAgIHJldHVybiByZXN1bHQ7XG4gIH0pO1xufVxuXG5hc3luYyBmdW5jdGlvbiBmZXRjaFRyYW5zYWN0aW9ucyhcbiAgcGFnZTogUGFnZSxcbiAgb3B0aW9uczogU2NyYXBlck9wdGlvbnMsXG4gIGNvbXBhbnlTZXJ2aWNlT3B0aW9uczogQ29tcGFueVNlcnZpY2VPcHRpb25zLFxuICBzdGFydE1vbWVudDogTW9tZW50LFxuICBtb250aE1vbWVudDogTW9tZW50LFxuKTogUHJvbWlzZTxTY3JhcGVkQWNjb3VudHNXaXRoSW5kZXg+IHtcbiAgY29uc3QgYWNjb3VudHMgPSBhd2FpdCBmZXRjaEFjY291bnRzKHBhZ2UsIGNvbXBhbnlTZXJ2aWNlT3B0aW9ucy5zZXJ2aWNlc1VybCwgbW9udGhNb21lbnQpO1xuICBjb25zdCBkYXRhVXJsID0gZ2V0VHJhbnNhY3Rpb25zVXJsKGNvbXBhbnlTZXJ2aWNlT3B0aW9ucy5zZXJ2aWNlc1VybCwgbW9udGhNb21lbnQpO1xuICBhd2FpdCBzbGVlcChSQVRFX0xJTUlULlNMRUVQX0JFVFdFRU4pO1xuICBkZWJ1ZyhgZmV0Y2hpbmcgdHJhbnNhY3Rpb25zIGZyb20gJHtkYXRhVXJsfSBmb3IgbW9udGggJHttb250aE1vbWVudC5mb3JtYXQoJ1lZWVktTU0nKX1gKTtcbiAgY29uc3QgZGF0YVJlc3VsdCA9IGF3YWl0IGZldGNoR2V0V2l0aGluUGFnZTxTY3JhcGVkVHJhbnNhY3Rpb25EYXRhPihwYWdlLCBkYXRhVXJsKTtcbiAgaWYgKGRhdGFSZXN1bHQgJiYgZGF0YVJlc3VsdC5IZWFkZXI/LlN0YXR1cyA9PT0gJzEnICYmIGRhdGFSZXN1bHQuQ2FyZHNUcmFuc2FjdGlvbnNMaXN0QmVhbikge1xuICAgIGNvbnN0IGFjY291bnRUeG5zOiBTY3JhcGVkQWNjb3VudHNXaXRoSW5kZXggPSB7fTtcbiAgICBhY2NvdW50cy5mb3JFYWNoKGFjY291bnQgPT4ge1xuICAgICAgY29uc3QgdHhuR3JvdXBzOiBTY3JhcGVkQ3VycmVudENhcmRUcmFuc2FjdGlvbnNbXSB8IHVuZGVmaW5lZCA9XG4gICAgICAgIGRhdGFSZXN1bHQuQ2FyZHNUcmFuc2FjdGlvbnNMaXN0QmVhbj8uW2BJbmRleCR7YWNjb3VudC5pbmRleH1gXT8uQ3VycmVudENhcmRUcmFuc2FjdGlvbnM7XG4gICAgICBpZiAodHhuR3JvdXBzKSB7XG4gICAgICAgIGxldCBhbGxUeG5zOiBUcmFuc2FjdGlvbltdID0gW107XG4gICAgICAgIHR4bkdyb3Vwcy5mb3JFYWNoKHR4bkdyb3VwID0+IHtcbiAgICAgICAgICBpZiAodHhuR3JvdXAudHhuSXNyYWVsKSB7XG4gICAgICAgICAgICBjb25zdCB0eG5zID0gY29udmVydFRyYW5zYWN0aW9ucyh0eG5Hcm91cC50eG5Jc3JhZWwsIGFjY291bnQucHJvY2Vzc2VkRGF0ZSwgb3B0aW9ucyk7XG4gICAgICAgICAgICBhbGxUeG5zLnB1c2goLi4udHhucyk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmICh0eG5Hcm91cC50eG5BYnJvYWQpIHtcbiAgICAgICAgICAgIGNvbnN0IHR4bnMgPSBjb252ZXJ0VHJhbnNhY3Rpb25zKHR4bkdyb3VwLnR4bkFicm9hZCwgYWNjb3VudC5wcm9jZXNzZWREYXRlLCBvcHRpb25zKTtcbiAgICAgICAgICAgIGFsbFR4bnMucHVzaCguLi50eG5zKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGlmICghb3B0aW9ucy5jb21iaW5lSW5zdGFsbG1lbnRzKSB7XG4gICAgICAgICAgYWxsVHhucyA9IGZpeEluc3RhbGxtZW50cyhhbGxUeG5zKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAob3B0aW9ucy5vdXRwdXREYXRhPy5lbmFibGVUcmFuc2FjdGlvbnNGaWx0ZXJCeURhdGUgPz8gdHJ1ZSkge1xuICAgICAgICAgIGFsbFR4bnMgPSBmaWx0ZXJPbGRUcmFuc2FjdGlvbnMoYWxsVHhucywgc3RhcnRNb21lbnQsIG9wdGlvbnMuY29tYmluZUluc3RhbGxtZW50cyB8fCBmYWxzZSk7XG4gICAgICAgIH1cbiAgICAgICAgYWNjb3VudFR4bnNbYWNjb3VudC5hY2NvdW50TnVtYmVyXSA9IHtcbiAgICAgICAgICBhY2NvdW50TnVtYmVyOiBhY2NvdW50LmFjY291bnROdW1iZXIsXG4gICAgICAgICAgaW5kZXg6IGFjY291bnQuaW5kZXgsXG4gICAgICAgICAgdHhuczogYWxsVHhucyxcbiAgICAgICAgfTtcbiAgICAgIH1cbiAgICB9KTtcbiAgICByZXR1cm4gYWNjb3VudFR4bnM7XG4gIH1cblxuICByZXR1cm4ge307XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGdldEV4dHJhU2NyYXBUcmFuc2FjdGlvbihcbiAgcGFnZTogUGFnZSxcbiAgb3B0aW9uczogQ29tcGFueVNlcnZpY2VPcHRpb25zLFxuICBtb250aDogTW9tZW50LFxuICBhY2NvdW50SW5kZXg6IG51bWJlcixcbiAgdHJhbnNhY3Rpb246IFRyYW5zYWN0aW9uLFxuKTogUHJvbWlzZTxUcmFuc2FjdGlvbj4ge1xuICBjb25zdCB1cmwgPSBuZXcgVVJMKG9wdGlvbnMuc2VydmljZXNVcmwpO1xuICB1cmwuc2VhcmNoUGFyYW1zLnNldCgncmVxTmFtZScsICdQaXJ0ZXlJc2thXzIwNCcpO1xuICB1cmwuc2VhcmNoUGFyYW1zLnNldCgnQ2FyZEluZGV4JywgYWNjb3VudEluZGV4LnRvU3RyaW5nKCkpO1xuICB1cmwuc2VhcmNoUGFyYW1zLnNldCgnc2hvdmFyUmF0eicsIHRyYW5zYWN0aW9uLmlkZW50aWZpZXIhLnRvU3RyaW5nKCkpO1xuICB1cmwuc2VhcmNoUGFyYW1zLnNldCgnbW9lZENoaXV2JywgbW9udGguZm9ybWF0KCdNTVlZWVknKSk7XG5cbiAgZGVidWcoYGZldGNoaW5nIGV4dHJhIHNjcmFwIGZvciB0cmFuc2FjdGlvbiAke3RyYW5zYWN0aW9uLmlkZW50aWZpZXJ9IGZvciBtb250aCAke21vbnRoLmZvcm1hdCgnWVlZWS1NTScpfWApO1xuICBjb25zdCBkYXRhID0gYXdhaXQgZmV0Y2hHZXRXaXRoaW5QYWdlPFNjcmFwZWRUcmFuc2FjdGlvbkRhdGE+KHBhZ2UsIHVybC50b1N0cmluZygpKTtcbiAgaWYgKCFkYXRhKSB7XG4gICAgcmV0dXJuIHRyYW5zYWN0aW9uO1xuICB9XG5cbiAgY29uc3QgcmF3Q2F0ZWdvcnkgPSBkYXRhLlBpcnRleUlza2FfMjA0QmVhbj8uc2VjdG9yID8/ICcnO1xuICByZXR1cm4ge1xuICAgIC4uLnRyYW5zYWN0aW9uLFxuICAgIGNhdGVnb3J5OiByYXdDYXRlZ29yeS50cmltKCksXG4gICAgcmF3VHJhbnNhY3Rpb246IGdldFJhd1RyYW5zYWN0aW9uKGRhdGEsIHRyYW5zYWN0aW9uKSxcbiAgfTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZ2V0RXh0cmFTY3JhcEFjY291bnQoXG4gIHBhZ2U6IFBhZ2UsXG4gIG9wdGlvbnM6IENvbXBhbnlTZXJ2aWNlT3B0aW9ucyxcbiAgYWNjb3VudE1hcDogU2NyYXBlZEFjY291bnRzV2l0aEluZGV4LFxuICBtb250aDogbW9tZW50Lk1vbWVudCxcbik6IFByb21pc2U8U2NyYXBlZEFjY291bnRzV2l0aEluZGV4PiB7XG4gIGNvbnN0IGFjY291bnRzOiBTY3JhcGVkQWNjb3VudHNXaXRoSW5kZXhbc3RyaW5nXVtdID0gW107XG4gIGZvciAoY29uc3QgYWNjb3VudCBvZiBPYmplY3QudmFsdWVzKGFjY291bnRNYXApKSB7XG4gICAgZGVidWcoXG4gICAgICBgZ2V0IGV4dHJhIHNjcmFwIGZvciAke2FjY291bnQuYWNjb3VudE51bWJlcn0gd2l0aCAke2FjY291bnQudHhucy5sZW5ndGh9IHRyYW5zYWN0aW9uc2AsXG4gICAgICBtb250aC5mb3JtYXQoJ1lZWVktTU0nKSxcbiAgICApO1xuICAgIGNvbnN0IHR4bnM6IFRyYW5zYWN0aW9uW10gPSBbXTtcbiAgICBmb3IgKGNvbnN0IHR4bnNDaHVuayBvZiBjaHVuayhhY2NvdW50LnR4bnMsIFJBVEVfTElNSVQuVFJBTlNBQ1RJT05TX0JBVENIX1NJWkUpKSB7XG4gICAgICBkZWJ1ZyhgcHJvY2Vzc2luZyBjaHVuayBvZiAke3R4bnNDaHVuay5sZW5ndGh9IHRyYW5zYWN0aW9ucyBmb3IgYWNjb3VudCAke2FjY291bnQuYWNjb3VudE51bWJlcn1gKTtcbiAgICAgIGNvbnN0IHVwZGF0ZWRUeG5zID0gYXdhaXQgUHJvbWlzZS5hbGwoXG4gICAgICAgIHR4bnNDaHVuay5tYXAodCA9PiBnZXRFeHRyYVNjcmFwVHJhbnNhY3Rpb24ocGFnZSwgb3B0aW9ucywgbW9udGgsIGFjY291bnQuaW5kZXgsIHQpKSxcbiAgICAgICk7XG4gICAgICBhd2FpdCBzbGVlcChSQVRFX0xJTUlULlNMRUVQX0JFVFdFRU4pO1xuICAgICAgdHhucy5wdXNoKC4uLnVwZGF0ZWRUeG5zKTtcbiAgICB9XG4gICAgYWNjb3VudHMucHVzaCh7IC4uLmFjY291bnQsIHR4bnMgfSk7XG4gIH1cblxuICByZXR1cm4gYWNjb3VudHMucmVkdWNlKChtLCB4KSA9PiAoeyAuLi5tLCBbeC5hY2NvdW50TnVtYmVyXTogeCB9KSwge30pO1xufVxuXG5hc3luYyBmdW5jdGlvbiBnZXRBZGRpdGlvbmFsVHJhbnNhY3Rpb25JbmZvcm1hdGlvbihcbiAgc2NyYXBlck9wdGlvbnM6IFNjcmFwZXJPcHRpb25zLFxuICBhY2NvdW50c1dpdGhJbmRleDogU2NyYXBlZEFjY291bnRzV2l0aEluZGV4W10sXG4gIHBhZ2U6IFBhZ2UsXG4gIG9wdGlvbnM6IENvbXBhbnlTZXJ2aWNlT3B0aW9ucyxcbiAgYWxsTW9udGhzOiBtb21lbnQuTW9tZW50W10sXG4pOiBQcm9taXNlPFNjcmFwZWRBY2NvdW50c1dpdGhJbmRleFtdPiB7XG4gIGlmIChcbiAgICAhc2NyYXBlck9wdGlvbnMuYWRkaXRpb25hbFRyYW5zYWN0aW9uSW5mb3JtYXRpb24gfHxcbiAgICBzY3JhcGVyT3B0aW9ucy5vcHRJbkZlYXR1cmVzPy5pbmNsdWRlcygnaXNyYWNhcmQtYW1leDpza2lwQWRkaXRpb25hbFRyYW5zYWN0aW9uSW5mb3JtYXRpb24nKVxuICApIHtcbiAgICByZXR1cm4gYWNjb3VudHNXaXRoSW5kZXg7XG4gIH1cbiAgcmV0dXJuIHJ1blNlcmlhbChhY2NvdW50c1dpdGhJbmRleC5tYXAoKGEsIGkpID0+ICgpID0+IGdldEV4dHJhU2NyYXBBY2NvdW50KHBhZ2UsIG9wdGlvbnMsIGEsIGFsbE1vbnRoc1tpXSkpKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZmV0Y2hBbGxUcmFuc2FjdGlvbnMoXG4gIHBhZ2U6IFBhZ2UsXG4gIG9wdGlvbnM6IFNjcmFwZXJPcHRpb25zLFxuICBjb21wYW55U2VydmljZU9wdGlvbnM6IENvbXBhbnlTZXJ2aWNlT3B0aW9ucyxcbiAgc3RhcnRNb21lbnQ6IE1vbWVudCxcbikge1xuICBjb25zdCBmdXR1cmVNb250aHNUb1NjcmFwZSA9IG9wdGlvbnMuZnV0dXJlTW9udGhzVG9TY3JhcGUgPz8gMTtcbiAgY29uc3QgYWxsTW9udGhzID0gZ2V0QWxsTW9udGhNb21lbnRzKHN0YXJ0TW9tZW50LCBmdXR1cmVNb250aHNUb1NjcmFwZSk7XG4gIGNvbnN0IHJlc3VsdHM6IFNjcmFwZWRBY2NvdW50c1dpdGhJbmRleFtdID0gYXdhaXQgcnVuU2VyaWFsKFxuICAgIGFsbE1vbnRocy5tYXAobW9udGhNb21lbnQgPT4gKCkgPT4ge1xuICAgICAgcmV0dXJuIGZldGNoVHJhbnNhY3Rpb25zKHBhZ2UsIG9wdGlvbnMsIGNvbXBhbnlTZXJ2aWNlT3B0aW9ucywgc3RhcnRNb21lbnQsIG1vbnRoTW9tZW50KTtcbiAgICB9KSxcbiAgKTtcblxuICBjb25zdCBmaW5hbFJlc3VsdCA9IGF3YWl0IGdldEFkZGl0aW9uYWxUcmFuc2FjdGlvbkluZm9ybWF0aW9uKFxuICAgIG9wdGlvbnMsXG4gICAgcmVzdWx0cyxcbiAgICBwYWdlLFxuICAgIGNvbXBhbnlTZXJ2aWNlT3B0aW9ucyxcbiAgICBhbGxNb250aHMsXG4gICk7XG4gIGNvbnN0IGNvbWJpbmVkVHhuczogUmVjb3JkPHN0cmluZywgVHJhbnNhY3Rpb25bXT4gPSB7fTtcblxuICBmaW5hbFJlc3VsdC5mb3JFYWNoKHJlc3VsdCA9PiB7XG4gICAgT2JqZWN0LmtleXMocmVzdWx0KS5mb3JFYWNoKGFjY291bnROdW1iZXIgPT4ge1xuICAgICAgbGV0IHR4bnNGb3JBY2NvdW50ID0gY29tYmluZWRUeG5zW2FjY291bnROdW1iZXJdO1xuICAgICAgaWYgKCF0eG5zRm9yQWNjb3VudCkge1xuICAgICAgICB0eG5zRm9yQWNjb3VudCA9IFtdO1xuICAgICAgICBjb21iaW5lZFR4bnNbYWNjb3VudE51bWJlcl0gPSB0eG5zRm9yQWNjb3VudDtcbiAgICAgIH1cbiAgICAgIGNvbnN0IHRvQmVBZGRlZFR4bnMgPSByZXN1bHRbYWNjb3VudE51bWJlcl0udHhucztcbiAgICAgIGNvbWJpbmVkVHhuc1thY2NvdW50TnVtYmVyXS5wdXNoKC4uLnRvQmVBZGRlZFR4bnMpO1xuICAgIH0pO1xuICB9KTtcblxuICBjb25zdCBhY2NvdW50cyA9IE9iamVjdC5rZXlzKGNvbWJpbmVkVHhucykubWFwKGFjY291bnROdW1iZXIgPT4ge1xuICAgIHJldHVybiB7XG4gICAgICBhY2NvdW50TnVtYmVyLFxuICAgICAgdHhuczogY29tYmluZWRUeG5zW2FjY291bnROdW1iZXJdLFxuICAgIH07XG4gIH0pO1xuXG4gIHJldHVybiB7XG4gICAgc3VjY2VzczogdHJ1ZSxcbiAgICBhY2NvdW50cyxcbiAgfTtcbn1cblxudHlwZSBTY3JhcGVyU3BlY2lmaWNDcmVkZW50aWFscyA9IHsgaWQ6IHN0cmluZzsgcGFzc3dvcmQ6IHN0cmluZzsgY2FyZDZEaWdpdHM6IHN0cmluZyB9O1xuY2xhc3MgSXNyYWNhcmRBbWV4QmFzZVNjcmFwZXIgZXh0ZW5kcyBCYXNlU2NyYXBlcldpdGhCcm93c2VyPFNjcmFwZXJTcGVjaWZpY0NyZWRlbnRpYWxzPiB7XG4gIHByaXZhdGUgYmFzZVVybDogc3RyaW5nO1xuXG4gIHByaXZhdGUgY29tcGFueUNvZGU6IHN0cmluZztcblxuICBwcml2YXRlIHNlcnZpY2VzVXJsOiBzdHJpbmc7XG5cbiAgY29uc3RydWN0b3Iob3B0aW9uczogU2NyYXBlck9wdGlvbnMsIGJhc2VVcmw6IHN0cmluZywgY29tcGFueUNvZGU6IHN0cmluZykge1xuICAgIHN1cGVyKG9wdGlvbnMpO1xuXG4gICAgdGhpcy5iYXNlVXJsID0gYmFzZVVybDtcbiAgICB0aGlzLmNvbXBhbnlDb2RlID0gY29tcGFueUNvZGU7XG4gICAgdGhpcy5zZXJ2aWNlc1VybCA9IGAke2Jhc2VVcmx9L3NlcnZpY2VzL1Byb3h5UmVxdWVzdEhhbmRsZXIuYXNoeGA7XG4gIH1cblxuICBhc3luYyBsb2dpbihjcmVkZW50aWFsczogU2NyYXBlclNwZWNpZmljQ3JlZGVudGlhbHMpOiBQcm9taXNlPFNjcmFwZXJTY3JhcGluZ1Jlc3VsdD4ge1xuICAgIGF3YWl0IHRoaXMucGFnZS5zZXRSZXF1ZXN0SW50ZXJjZXB0aW9uKHRydWUpO1xuICAgIHRoaXMucGFnZS5vbigncmVxdWVzdCcsIHJlcXVlc3QgPT4ge1xuICAgICAgaWYgKHJlcXVlc3QudXJsKCkuaW5jbHVkZXMoJ2RldGVjdG9yLWRvbS5taW4uanMnKSkge1xuICAgICAgICBkZWJ1ZygnZm9yY2UgYWJvcnQgZm9yIHJlcXVlc3QgZG8gZG93bmxvYWQgZGV0ZWN0b3ItZG9tLm1pbi5qcyByZXNvdXJjZScpO1xuICAgICAgICB2b2lkIHJlcXVlc3QuYWJvcnQodW5kZWZpbmVkLCBpbnRlcmNlcHRpb25Qcmlvcml0aWVzLmFib3J0KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHZvaWQgcmVxdWVzdC5jb250aW51ZSh1bmRlZmluZWQsIGludGVyY2VwdGlvblByaW9yaXRpZXMuY29udGludWUpO1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgYXdhaXQgbWFza0hlYWRsZXNzVXNlckFnZW50KHRoaXMucGFnZSk7XG5cbiAgICBhd2FpdCB0aGlzLm5hdmlnYXRlVG8oYCR7dGhpcy5iYXNlVXJsfS9wZXJzb25hbGFyZWEvTG9naW5gKTtcblxuICAgIHRoaXMuZW1pdFByb2dyZXNzKFNjcmFwZXJQcm9ncmVzc1R5cGVzLkxvZ2dpbmdJbik7XG5cbiAgICBjb25zdCB2YWxpZGF0ZVVybCA9IGAke3RoaXMuc2VydmljZXNVcmx9P3JlcU5hbWU9VmFsaWRhdGVJZERhdGFgO1xuICAgIGNvbnN0IHZhbGlkYXRlUmVxdWVzdCA9IHtcbiAgICAgIGlkOiBjcmVkZW50aWFscy5pZCxcbiAgICAgIGNhcmRTdWZmaXg6IGNyZWRlbnRpYWxzLmNhcmQ2RGlnaXRzLFxuICAgICAgY291bnRyeUNvZGU6IENPVU5UUllfQ09ERSxcbiAgICAgIGlkVHlwZTogSURfVFlQRSxcbiAgICAgIGNoZWNrTGV2ZWw6ICcxJyxcbiAgICAgIGNvbXBhbnlDb2RlOiB0aGlzLmNvbXBhbnlDb2RlLFxuICAgIH07XG4gICAgZGVidWcoJ2xvZ2dpbmcgaW4gd2l0aCB2YWxpZGF0ZSByZXF1ZXN0Jyk7XG4gICAgY29uc3QgdmFsaWRhdGVSZXN1bHQgPSBhd2FpdCBmZXRjaFBvc3RXaXRoaW5QYWdlPFNjcmFwZWRMb2dpblZhbGlkYXRpb24+KHRoaXMucGFnZSwgdmFsaWRhdGVVcmwsIHZhbGlkYXRlUmVxdWVzdCk7XG4gICAgaWYgKFxuICAgICAgIXZhbGlkYXRlUmVzdWx0IHx8XG4gICAgICAhdmFsaWRhdGVSZXN1bHQuSGVhZGVyIHx8XG4gICAgICB2YWxpZGF0ZVJlc3VsdC5IZWFkZXIuU3RhdHVzICE9PSAnMScgfHxcbiAgICAgICF2YWxpZGF0ZVJlc3VsdC5WYWxpZGF0ZUlkRGF0YUJlYW5cbiAgICApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcigndW5rbm93biBlcnJvciBkdXJpbmcgbG9naW4nKTtcbiAgICB9XG5cbiAgICBjb25zdCB2YWxpZGF0ZVJldHVybkNvZGUgPSB2YWxpZGF0ZVJlc3VsdC5WYWxpZGF0ZUlkRGF0YUJlYW4ucmV0dXJuQ29kZTtcbiAgICBkZWJ1ZyhgdXNlciB2YWxpZGF0ZSB3aXRoIHJldHVybiBjb2RlICcke3ZhbGlkYXRlUmV0dXJuQ29kZX0nYCk7XG4gICAgaWYgKHZhbGlkYXRlUmV0dXJuQ29kZSA9PT0gJzEnKSB7XG4gICAgICBjb25zdCB7IHVzZXJOYW1lIH0gPSB2YWxpZGF0ZVJlc3VsdC5WYWxpZGF0ZUlkRGF0YUJlYW47XG5cbiAgICAgIGNvbnN0IGxvZ2luVXJsID0gYCR7dGhpcy5zZXJ2aWNlc1VybH0/cmVxTmFtZT1wZXJmb3JtTG9nb25JYDtcbiAgICAgIGNvbnN0IHJlcXVlc3QgPSB7XG4gICAgICAgIEtvZE1pc2h0YW1lc2g6IHVzZXJOYW1lLFxuICAgICAgICBNaXNwYXJaaWh1eTogY3JlZGVudGlhbHMuaWQsXG4gICAgICAgIFNpc21hOiBjcmVkZW50aWFscy5wYXNzd29yZCxcbiAgICAgICAgY2FyZFN1ZmZpeDogY3JlZGVudGlhbHMuY2FyZDZEaWdpdHMsXG4gICAgICAgIGNvdW50cnlDb2RlOiBDT1VOVFJZX0NPREUsXG4gICAgICAgIGlkVHlwZTogSURfVFlQRSxcbiAgICAgIH07XG4gICAgICBkZWJ1ZygndXNlciBsb2dpbiBzdGFydGVkJyk7XG4gICAgICBjb25zdCBsb2dpblJlc3VsdCA9IGF3YWl0IGZldGNoUG9zdFdpdGhpblBhZ2U8eyBzdGF0dXM6IHN0cmluZyB9Pih0aGlzLnBhZ2UsIGxvZ2luVXJsLCByZXF1ZXN0KTtcbiAgICAgIGRlYnVnKGB1c2VyIGxvZ2luIHdpdGggc3RhdHVzICcke2xvZ2luUmVzdWx0Py5zdGF0dXN9J2AsIGxvZ2luUmVzdWx0KTtcblxuICAgICAgaWYgKGxvZ2luUmVzdWx0ICYmIGxvZ2luUmVzdWx0LnN0YXR1cyA9PT0gJzEnKSB7XG4gICAgICAgIHRoaXMuZW1pdFByb2dyZXNzKFNjcmFwZXJQcm9ncmVzc1R5cGVzLkxvZ2luU3VjY2Vzcyk7XG4gICAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUgfTtcbiAgICAgIH1cblxuICAgICAgaWYgKGxvZ2luUmVzdWx0ICYmIGxvZ2luUmVzdWx0LnN0YXR1cyA9PT0gJzMnKSB7XG4gICAgICAgIHRoaXMuZW1pdFByb2dyZXNzKFNjcmFwZXJQcm9ncmVzc1R5cGVzLkNoYW5nZVBhc3N3b3JkKTtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgICAgICBlcnJvclR5cGU6IFNjcmFwZXJFcnJvclR5cGVzLkNoYW5nZVBhc3N3b3JkLFxuICAgICAgICB9O1xuICAgICAgfVxuXG4gICAgICB0aGlzLmVtaXRQcm9ncmVzcyhTY3JhcGVyUHJvZ3Jlc3NUeXBlcy5Mb2dpbkZhaWxlZCk7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgICAgZXJyb3JUeXBlOiBTY3JhcGVyRXJyb3JUeXBlcy5JbnZhbGlkUGFzc3dvcmQsXG4gICAgICB9O1xuICAgIH1cblxuICAgIGlmICh2YWxpZGF0ZVJldHVybkNvZGUgPT09ICc0Jykge1xuICAgICAgdGhpcy5lbWl0UHJvZ3Jlc3MoU2NyYXBlclByb2dyZXNzVHlwZXMuQ2hhbmdlUGFzc3dvcmQpO1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc3VjY2VzczogZmFsc2UsXG4gICAgICAgIGVycm9yVHlwZTogU2NyYXBlckVycm9yVHlwZXMuQ2hhbmdlUGFzc3dvcmQsXG4gICAgICB9O1xuICAgIH1cblxuICAgIHRoaXMuZW1pdFByb2dyZXNzKFNjcmFwZXJQcm9ncmVzc1R5cGVzLkxvZ2luRmFpbGVkKTtcbiAgICByZXR1cm4ge1xuICAgICAgc3VjY2VzczogZmFsc2UsXG4gICAgICBlcnJvclR5cGU6IFNjcmFwZXJFcnJvclR5cGVzLkludmFsaWRQYXNzd29yZCxcbiAgICB9O1xuICB9XG5cbiAgYXN5bmMgZmV0Y2hEYXRhKCkge1xuICAgIGNvbnN0IGRlZmF1bHRTdGFydE1vbWVudCA9IG1vbWVudCgpLnN1YnRyYWN0KDEsICd5ZWFycycpO1xuICAgIGNvbnN0IHN0YXJ0RGF0ZSA9IHRoaXMub3B0aW9ucy5zdGFydERhdGUgfHwgZGVmYXVsdFN0YXJ0TW9tZW50LnRvRGF0ZSgpO1xuICAgIGNvbnN0IHN0YXJ0TW9tZW50ID0gbW9tZW50Lm1heChkZWZhdWx0U3RhcnRNb21lbnQsIG1vbWVudChzdGFydERhdGUpKTtcblxuICAgIHJldHVybiBmZXRjaEFsbFRyYW5zYWN0aW9ucyhcbiAgICAgIHRoaXMucGFnZSxcbiAgICAgIHRoaXMub3B0aW9ucyxcbiAgICAgIHtcbiAgICAgICAgc2VydmljZXNVcmw6IHRoaXMuc2VydmljZXNVcmwsXG4gICAgICAgIGNvbXBhbnlDb2RlOiB0aGlzLmNvbXBhbnlDb2RlLFxuICAgICAgfSxcbiAgICAgIHN0YXJ0TW9tZW50LFxuICAgICk7XG4gIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgSXNyYWNhcmRBbWV4QmFzZVNjcmFwZXI7XG4iXSwibWFwcGluZ3MiOiI7Ozs7OztBQUFBLElBQUFBLE9BQUEsR0FBQUMsc0JBQUEsQ0FBQUMsT0FBQTtBQUVBLElBQUFDLFVBQUEsR0FBQUQsT0FBQTtBQUNBLElBQUFFLFlBQUEsR0FBQUYsT0FBQTtBQUNBLElBQUFHLE1BQUEsR0FBQUosc0JBQUEsQ0FBQUMsT0FBQTtBQUNBLElBQUFJLE1BQUEsR0FBQUosT0FBQTtBQUNBLElBQUFLLE1BQUEsR0FBQUwsT0FBQTtBQUNBLElB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QSxJQUFJdUMsV0FBVyxJQUFJQSxXQUFXLENBQUMxRyxNQUFNLEtBQUssR0FBRyxFQUFFO1FBQzdDLElBQUksQ0FBQ21GLFlBQVksQ0FBQ0MsaUNBQW9CLENBQUN3QixjQUFjLENBQUM7UUFDdEQsT0FBTztVQUNMekMsT0FBTyxFQUFFLEtBQUs7VUFDZDBDLFNBQVMsRUFBRUMseUJBQWlCLENBQUNGO1FBQy9CLENBQUM7TUFDSDtNQUVBLElBQUksQ0FBQ3pCLFlBQVksQ0FBQ0MsaUNBQW9CLENBQUMyQixXQUFXLENBQUM7TUFDbkQsT0FBTztRQUNMNUMsT0FBTyxFQUFFLEtBQUs7UUFDZDBDLFNBQVMsRUFBRUMseUJBQWlCLENBQUNFO01BQy9CLENBQUM7SUFDSDtJQUVBLElBQUlkLGtCQUFrQixLQUFLLEdBQUcsRUFBRTtNQUM5QixJQUFJLENBQUNmLFlBQVksQ0FBQ0MsaUNBQW9CLENBQUN3QixjQUFjLENBQUM7TUFDdEQsT0FBTztRQUNMekMsT0FBTyxFQUFFLEtBQUs7UUFDZDBDLFNBQVMsRUFBRUMseUJBQWlCLENBQUNGO01BQy9CLENBQUM7SUFDSDtJQUVBLElBQUksQ0FBQ3pCLFlBQVksQ0FBQ0MsaUNBQW9CLENBQUMyQixXQUFXLENBQUM7SUFDbkQsT0FBTztNQUNMNUMsT0FBTyxFQUFFLEtBQUs7TUFDZDBDLFNBQVMsRUFBRUMseUJBQWlCLENBQUNFO0lBQy9CLENBQUM7RUFDSDtFQUVBLE1BQU1DLFNBQVNBLENBQUEsRUFBRztJQUNoQixNQUFNQyxrQkFBa0IsR0FBRyxJQUFBN0ssZUFBTSxFQUFDLENBQUMsQ0FBQzhLLFFBQVEsQ0FBQyxDQUFDLEVBQUUsT0FBTyxDQUFDO0lBQ3hELE1BQU1DLFNBQVMsR0FBRyxJQUFJLENBQUNwSixPQUFPLENBQUNvSixTQUFTLElBQUlGLGtCQUFrQixDQUFDRyxNQUFNLENBQUMsQ0FBQztJQUN2RSxNQUFNN0csV0FBVyxHQUFHbkUsZUFBTSxDQUFDaUwsR0FBRyxDQUFDSixrQkFBa0IsRUFBRSxJQUFBN0ssZUFBTSxFQUFDK0ssU0FBUyxDQUFDLENBQUM7SUFFckUsT0FBTzFELG9CQUFvQixDQUN6QixJQUFJLENBQUNySSxJQUFJLEVBQ1QsSUFBSSxDQUFDMkMsT0FBTyxFQUNaO01BQ0VyRCxXQUFXLEVBQUUsSUFBSSxDQUFDQSxXQUFXO01BQzdCNkosV0FBVyxFQUFFLElBQUksQ0FBQ0E7SUFDcEIsQ0FBQyxFQUNEaEUsV0FDRixDQUFDO0VBQ0g7QUFDRjtBQUFDLElBQUErRyxRQUFBLEdBQUFDLE9BQUEsQ0FBQXhOLE9BQUEsR0FFY29LLHVCQUF1QiIsImlnbm9yZUxpc3QiOltdfQ==