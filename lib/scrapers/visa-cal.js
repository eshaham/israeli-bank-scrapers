"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _moment = _interopRequireDefault(require("moment"));
var _debug = require("../helpers/debug");
var _elementsInteractions = require("../helpers/elements-interactions");
var _fetch = require("../helpers/fetch");
var _navigation = require("../helpers/navigation");
var _storage = require("../helpers/storage");
var _transactions = require("../helpers/transactions");
var _waiting = require("../helpers/waiting");
var _transactions2 = require("../transactions");
var _baseScraperWithBrowser = require("./base-scraper-with-browser");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
const apiHeaders = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
  Origin: 'https://digital-web.cal-online.co.il',
  Referer: 'https://digital-web.cal-online.co.il',
  'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7',
  'Sec-Fetch-Site': 'same-site',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Dest': 'empty'
};
const LOGIN_URL = 'https://www.cal-online.co.il/';
const TRANSACTIONS_REQUEST_ENDPOINT = 'https://api.cal-online.co.il/Transactions/api/transactionsDetails/getCardTransactionsDetails';
const FRAMES_REQUEST_ENDPOINT = 'https://api.cal-online.co.il/Frames/api/Frames/GetFrameStatus';
const PENDING_TRANSACTIONS_REQUEST_ENDPOINT = 'https://api.cal-online.co.il/Transactions/api/approvals/getClearanceRequests';
const SSO_AUTHORIZATION_REQUEST_ENDPOINT = 'https://connect.cal-online.co.il/col-rest/calconnect/authentication/SSO';
const InvalidPasswordMessage = 'שם המשתמש או הסיסמה שהוזנו שגויים';
const ChangePasswordMessage = 'להחליף סיסמה';
const debug = (0, _debug.getDebug)('visa-cal');
var TrnTypeCode = /*#__PURE__*/function (TrnTypeCode) {
  TrnTypeCode["regular"] = "5";
  TrnTypeCode["credit"] = "6";
  TrnTypeCode["installments"] = "8";
  TrnTypeCode["standingOrder"] = "9";
  return TrnTypeCode;
}(TrnTypeCode || {});
function isAuthModule(result) {
  return Boolean(result?.auth?.calConnectToken && String(result.auth.calConnectToken).trim());
}
function authModuleOrUndefined(result) {
  return isAuthModule(result) ? result : undefined;
}
function isPending(transaction) {
  return transaction.debCrdDate === undefined; // an arbitrary field that only appears in a completed transaction
}
function isCardTransactionDetails(result) {
  return result.result !== undefined;
}
function isCardPendingTransactionDetails(result) {
  return result.result !== undefined;
}
async function getLoginFrame(page) {
  let frame = null;
  debug('wait until login frame found');
  await (0, _waiting.waitUntil)(() => {
    frame = page.frames().find(f => f.url().includes('connect')) || null;
    return Promise.resolve(!!frame);
  }, 'wait for iframe with login form', 10000, 1000);
  if (!frame) {
    debug('failed to find login frame for 10 seconds');
    throw new Error('failed to extract login iframe');
  }
  return frame;
}
async function hasInvalidPasswordError(page) {
  const frame = await getLoginFrame(page);
  const errorFound = await (0, _elementsInteractions.elementPresentOnPage)(frame, 'div.general-error > div');
  const errorMessage = errorFound ? await (0, _elementsInteractions.pageEval)(frame, 'div.general-error > div', '', item => {
    return item.innerText;
  }) : '';
  return errorMessage === InvalidPasswordMessage;
}
async function hasChangePasswordForm(page) {
  const frame = await getLoginFrame(page);
  // "כדי להחליף סיסמה יש ללחוץ על 'שכחתי שם משתמש / סיסמה' במסך הכניסה"
  const errorFound = await (0, _elementsInteractions.elementPresentOnPage)(frame, '.err-desc');
  if (errorFound) {
    const errText = await (0, _elementsInteractions.pageEval)(frame, '.err-desc', '', item => {
      return item.innerText.trim();
    });
    return errText.includes(ChangePasswordMessage);
  }
  return false;
}
function getPossibleLoginResults() {
  debug('return possible login results');
  const urls = {
    [_baseScraperWithBrowser.LoginResults.Success]: [/dashboard/i],
    [_baseScraperWithBrowser.LoginResults.InvalidPassword]: [async options => {
      const page = options?.page;
      if (!page) {
        return false;
      }
      return hasInvalidPasswordError(page);
    }],
    // [LoginResults.AccountBlocked]: [], // TODO add when reaching this scenario
    [_baseScraperWithBrowser.LoginResults.ChangePassword]: [async options => {
      const page = options?.page;
      if (!page) {
        return false;
      }
      return hasChangePasswordForm(page);
    }]
  };
  return urls;
}
function createLoginFields(credentials) {
  debug('create login fields for username and password');
  return [{
    selector: '[formcontrolname="userName"]',
    value: credentials.username
  }, {
    selector: '[formcontrolname="password"]',
    value: credentials.password
  }];
}
function convertParsedDataToTransactions(data, pendingData, options) {
  const pendingTransactions = pendingData?.result ? pendingData.result.cardsList.flatMap(card => card.authDetalisList) : [];
  const bankAccounts = data.flatMap(monthData => monthData.result.bankAccounts);
  const regularDebitDays = bankAccounts.flatMap(accounts => accounts.debitDates);
  const immediateDebitDays = bankAccounts.flatMap(accounts => accounts.immidiateDebits.debitDays);
  const completedTransactions = [...regularDebitDays, ...immediateDebitDays].flatMap(debitDate => debitDate.transactions);
  const all = [...pendingTransactions, ...completedTransactions];
  return all.map(transaction => {
    const numOfPayments = isPending(transaction) ? transaction.numberOfPayments : transaction.numOfPayments;
    const installments = numOfPayments ? {
      number: isPending(transaction) ? 1 : transaction.curPaymentNum,
      total: numOfPayments
    } : undefined;
    const date = (0, _moment.default)(transaction.trnPurchaseDate);
    const chargedAmount = (isPending(transaction) ? transaction.trnAmt : transaction.amtBeforeConvAndIndex) * -1;
    const originalAmount = transaction.trnAmt * (transaction.trnTypeCode === TrnTypeCode.credit ? 1 : -1);
    const result = {
      identifier: !isPending(transaction) ? transaction.trnIntId : undefined,
      type: [TrnTypeCode.regular, TrnTypeCode.standingOrder].includes(transaction.trnTypeCode) ? _transactions2.TransactionTypes.Normal : _transactions2.TransactionTypes.Installments,
      status: isPending(transaction) ? _transactions2.TransactionStatuses.Pending : _transactions2.TransactionStatuses.Completed,
      date: installments ? date.add(installments.number - 1, 'month').toISOString() : date.toISOString(),
      processedDate: isPending(transaction) ? date.toISOString() : new Date(transaction.debCrdDate).toISOString(),
      originalAmount,
      originalCurrency: transaction.trnCurrencySymbol,
      chargedAmount,
      chargedCurrency: !isPending(transaction) ? transaction.debCrdCurrencySymbol : undefined,
      description: transaction.merchantName,
      memo: transaction.transTypeCommentDetails.toString(),
      category: transaction.branchCodeDesc
    };
    if (installments) {
      result.installments = installments;
    }
    if (options?.includeRawTransaction) {
      result.rawTransaction = (0, _transactions.getRawTransaction)(transaction);
    }
    return result;
  });
}
class VisaCalScraper extends _baseScraperWithBrowser.BaseScraperWithBrowser {
  authorization = undefined;
  openLoginPopup = async () => {
    debug('open login popup, wait until login button available');
    await (0, _elementsInteractions.waitUntilElementFound)(this.page, '#ccLoginDesktopBtn', true);
    debug('click on the login button');
    await (0, _elementsInteractions.clickButton)(this.page, '#ccLoginDesktopBtn');
    debug('get the frame that holds the login');
    const frame = await getLoginFrame(this.page);
    debug('wait until the password login tab header is available');
    await (0, _elementsInteractions.waitUntilElementFound)(frame, '#regular-login');
    debug('navigate to the password login tab');
    await (0, _elementsInteractions.clickButton)(frame, '#regular-login');
    debug('wait until the password login tab is active');
    await (0, _elementsInteractions.waitUntilElementFound)(frame, 'regular-login');
    return frame;
  };
  async getCards() {
    const initData = await (0, _waiting.waitUntil)(() => (0, _storage.getFromSessionStorage)(this.page, 'init'), 'get init data in session storage', 10000, 1000);
    if (!initData) {
      throw new Error('could not find "init" data in session storage');
    }
    return initData?.result.cards.map(({
      cardUniqueId,
      last4Digits
    }) => ({
      cardUniqueId,
      last4Digits
    }));
  }
  async getAuthorizationHeader() {
    if (!this.authorization) {
      debug('fetching authorization header');
      const authModule = await (0, _waiting.waitUntil)(async () => authModuleOrUndefined(await (0, _storage.getFromSessionStorage)(this.page, 'auth-module')), 'get authorization header with valid token in session storage', 10_000, 50);
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
  getLoginOptions(credentials) {
    this.authRequestPromise = this.page.waitForRequest(SSO_AUTHORIZATION_REQUEST_ENDPOINT, {
      timeout: 10_000
    }).catch(e => {
      debug('error while waiting for the token request', e);
      return undefined;
    });
    return {
      loginUrl: `${LOGIN_URL}`,
      fields: createLoginFields(credentials),
      submitButtonSelector: 'button[type="submit"]',
      possibleResults: getPossibleLoginResults(),
      checkReadiness: async () => (0, _elementsInteractions.waitUntilElementFound)(this.page, '#ccLoginDesktopBtn'),
      preAction: this.openLoginPopup,
      postAction: async () => {
        try {
          await (0, _navigation.waitForNavigation)(this.page);
          const currentUrl = await (0, _navigation.getCurrentUrl)(this.page);
          if (currentUrl.endsWith('site-tutorial')) {
            await (0, _elementsInteractions.clickButton)(this.page, 'button.btn-close');
          }
          const request = await this.authRequestPromise;
          this.authorization = String(request?.headers().authorization || '').trim();
        } catch (e) {
          const currentUrl = await (0, _navigation.getCurrentUrl)(this.page);
          if (currentUrl.endsWith('dashboard')) return;
          const requiresChangePassword = await hasChangePasswordForm(this.page);
          if (requiresChangePassword) return;
          throw e;
        }
      },
      userAgent: apiHeaders['User-Agent'],
      preparePage: async () => {
        // Bypass Cal's anti-bot detection by doing a direct API login
        // and injecting the SSO token into the browser's login flow.
        // The browser-based login form submission is blocked by Cal's WAF
        // when detected as automation, so we pre-authenticate via direct API call.
        debug('visaCal: doing direct API login to bypass WAF anti-bot detection');
        try {
          const loginResponse = await fetch('https://connect.cal-online.co.il/col-rest/calconnect/authentication/login', {
            method: 'POST',
            headers: {
              accept: 'application/json, text/plain, */*',
              'content-type': 'application/json',
              origin: 'https://digital-web.cal-online.co.il',
              referer: 'https://digital-web.cal-online.co.il/',
              'x-site-id': '09031987-273E-2311-906C-8AF85B17C8D9'
            },
            body: JSON.stringify({
              username: credentials.username,
              password: credentials.password,
              recaptcha: ''
            })
          });
          if (!loginResponse.ok) {
            debug(`visaCal: direct login failed with status ${loginResponse.status}`);
            return;
          }
          const loginData = await loginResponse.json();
          if (!loginData.token) {
            debug('visaCal: direct login did not return a token');
            return;
          }
          debug('visaCal: direct login successful, setting up request interception');
          this.__visaCalToken = loginData.token;
          await this.page.setRequestInterception(true);
          this.page.on('request', async request => {
            const url = request.url();
            if (url.includes('/col-rest/calconnect/authentication/login') && request.method() === 'POST') {
              debug('visaCal: intercepting login POST, injecting direct API token');
              request.respond({
                status: 200,
                contentType: 'application/json',
                headers: {
                  'access-control-allow-origin': 'https://digital-web.cal-online.co.il',
                  'access-control-allow-credentials': 'true'
                },
                body: JSON.stringify({
                  token: loginData.token,
                  hash: null,
                  innerLoginType: 0
                })
              });
              return;
            }
            request.continue();
          });
        } catch (err) {
          debug(`visaCal: direct API login error: ${err.message}`);
        }
      }
    };
  }
  async fetchData() {
    const defaultStartMoment = (0, _moment.default)().subtract(1, 'years').subtract(6, 'months').add(1, 'day');
    const startDate = this.options.startDate || defaultStartMoment.toDate();
    const startMoment = _moment.default.max(defaultStartMoment, (0, _moment.default)(startDate));
    debug(`fetch transactions starting ${startMoment.format()}`);
    const [cards, xSiteId, Authorization] = await Promise.all([this.getCards(), this.getXSiteId(), this.getAuthorizationHeader()]);
    const futureMonthsToScrape = this.options.futureMonthsToScrape ?? 1;
    debug('fetch frames (misgarot) of cards');
    const frames = await (0, _fetch.fetchPost)(FRAMES_REQUEST_ENDPOINT, {
      cardsForFrameData: cards.map(({
        cardUniqueId
      }) => ({
        cardUniqueId
      }))
    }, {
      Authorization,
      'X-Site-Id': xSiteId,
      'Content-Type': 'application/json',
      ...apiHeaders
    });
    const accounts = await Promise.all(cards.map(async card => {
      const finalMonthToFetchMoment = (0, _moment.default)().add(futureMonthsToScrape, 'month');
      const months = finalMonthToFetchMoment.diff(startMoment, 'months');
      const allMonthsData = [];
      const frame = frames.result?.bankIssuedCards?.cardLevelFrames?.find(f => f.cardUniqueId === card.cardUniqueId);
      debug(`fetch pending transactions for card ${card.cardUniqueId}`);
      let pendingData = await (0, _fetch.fetchPost)(PENDING_TRANSACTIONS_REQUEST_ENDPOINT, {
        cardUniqueIDArray: [card.cardUniqueId]
      }, {
        Authorization,
        'X-Site-Id': xSiteId,
        'Content-Type': 'application/json',
        ...apiHeaders
      });
      debug(`fetch completed transactions for card ${card.cardUniqueId}`);
      for (let i = 0; i <= months; i++) {
        const month = finalMonthToFetchMoment.clone().subtract(i, 'months');
        const monthData = await (0, _fetch.fetchPost)(TRANSACTIONS_REQUEST_ENDPOINT, {
          cardUniqueId: card.cardUniqueId,
          month: month.format('M'),
          year: month.format('YYYY')
        }, {
          Authorization,
          'X-Site-Id': xSiteId,
          'Content-Type': 'application/json',
          ...apiHeaders
        });
        if (monthData?.statusCode !== 1) throw new Error(`failed to fetch transactions for card ${card.last4Digits}. Message: ${monthData?.title || ''}`);
        if (!isCardTransactionDetails(monthData)) {
          throw new Error('monthData is not of type CardTransactionDetails');
        }
        allMonthsData.push(monthData);
      }
      if (pendingData?.statusCode !== 1 && pendingData?.statusCode !== 96) {
        debug(`failed to fetch pending transactions for card ${card.last4Digits}. Message: ${pendingData?.title || ''}`);
        pendingData = null;
      } else if (!isCardPendingTransactionDetails(pendingData)) {
        debug('pendingData is not of type CardTransactionDetails');
        pendingData = null;
      }
      const transactions = convertParsedDataToTransactions(allMonthsData, pendingData, this.options);
      debug('filter out old transactions');
      const txns = this.options.outputData?.enableTransactionsFilterByDate ?? true ? (0, _transactions.filterOldTransactions)(transactions, (0, _moment.default)(startDate), this.options.combineInstallments || false) : transactions;
      return {
        txns,
        balance: frame?.nextTotalDebit != null ? -frame.nextTotalDebit : undefined,
        accountNumber: card.last4Digits
      };
    }));
    debug('return the scraped accounts');
    debug(JSON.stringify(accounts, null, 2));
    return {
      success: true,
      accounts
    };
  }
}
var _default = exports.default = VisaCalScraper;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfbW9tZW50IiwiX2ludGVyb3BSZXF1aXJlRGVmYXVsdCIsInJlcXVpcmUiLCJfZGVidWciLCJfZWxlbWVudHNJbnRlcmFjdGlvbnMiLCJfZmV0Y2giLCJfbmF2aWdhdGlvbiIsIl9zdG9yYWdlIiwiX3RyYW5zYWN0aW9ucyIsIl93YWl0aW5nIiwiX3RyYW5zYWN0aW9uczIiLCJfYmFzZVNjcmFwZXJXaXRoQnJvd3NlciIsImUiLCJfX2VzTW9kdWxlIiwiZGVmYXVsdCIsImFwaUhlYWRlcnMiLCJPcmlnaW4iLCJSZWZlcmVyIiwiTE9HSU5fVVJMIiwiVFJBTlNBQ1RJT05TX1JFUVVFU1RfRU5EUE9JTlQiLCJGUkFNRVNfUkVRVUVTVF9FTkRQT0lOVCIsIlBFTkRJTkdfVFJBTlNBQ1RJT05TX1JFUVVFU1RfRU5EUE9JTlQiLCJTU09fQVVUSE9SSVpBVElPTl9SRVFVRVNUX0VORFBPSU5UIiwiSW52YWxpZFBhc3N3b3JkTWVzc2FnZSIsIkNoYW5nZVBhc3N3b3JkTWVzc2FnZSIsImRlYnVnIiwiZ2V0RGVidWciLCJUcm5UeXBlQ29kZSIsImlzQXV0aE1vZHVsZSIsInJlc3VsdCIsIkJvb2xlYW4iLCJhdXRoIiwiY2FsQ29ubmVjdFRva2VuIiwiU3RyaW5nIiwidHJpbSIsImF1dGhNb2R1bGVPclVuZGVmaW5lZCIsInVuZGVmaW5lZCIsImlzUGVuZGluZyIsInRyYW5zYWN0aW9uIiwiZGViQ3JkRGF0ZSIsImlzQ2FyZFRyYW5zYWN0aW9uRGV0YWlscyIsImlzQ2FyZFBlbmRpbmdUcmFuc2FjdGlvbkRldGFpbHMiLCJnZXRMb2dpbkZyYW1lIiwicGFnZSIsImZyYW1lIiwid2FpdFVudGlsIiwiZnJhbWVzIiwiZmluZCIsImYiLCJ1cmwiLCJpbmNsdWRlcyIsIlByb21pc2UiLCJyZXNvbHZlIiwiRXJyb3IiLCJoYXNJbnZhbGlkUGFzc3dvcmRFcnJvciIsImVycm9yRm91bmQiLCJlbGVtZW50UHJlc2VudE9uUGFnZSIsImVycm9yTWVzc2FnZSIsInBhZ2VFdmFsIiwiaXRlbSIsImlubmVyVGV4dCIsImhhc0NoYW5nZVBhc3N3b3JkRm9ybSIsImVyclRleHQiLCJnZXRQb3NzaWJsZUxvZ2luUmVzdWx0cyIsInVybHMiLCJMb2dpblJlc3VsdHMiLCJTdWNjZXNzIiwiSW52YWxpZFBhc3N3b3JkIiwib3B0aW9ucyIsIkNoYW5nZVBhc3N3b3JkIiwiY3JlYXRlTG9naW5GaWVsZHMiLCJjcmVkZW50aWFscyIsInNlbGVjdG9yIiwidmFsdWUiLCJ1c2VybmFtZSIsInBhc3N3b3JkIiwiY29udmVydFBhcnNlZERhdGFUb1RyYW5zYWN0aW9ucyIsImRhdGEiLCJwZW5kaW5nRGF0YSIsInBlbmRpbmdUcmFuc2FjdGlvbnMiLCJjYXJkc0xpc3QiLCJmbGF0TWFwIiwiY2FyZCIsImF1dGhEZXRhbGlzTGlzdCIsImJhbmtBY2NvdW50cyIsIm1vbnRoRGF0YSIsInJlZ3VsYXJEZWJpdERheXMiLCJhY2NvdW50cyIsImRlYml0RGF0ZXMiLCJpbW1lZGlhdGVEZWJpdERheXMiLCJpbW1pZGlhdGVEZWJpdHMiLCJkZWJpdERheXMiLCJjb21wbGV0ZWRUcmFuc2FjdGlvbnMiLCJkZWJpdERhdGUiLCJ0cmFuc2FjdGlvbnMiLCJhbGwiLCJtYXAiLCJudW1PZlBheW1lbnRzIiwibnVtYmVyT2ZQYXltZW50cyIsImluc3RhbGxtZW50cyIsIm51bWJlciIsImN1clBheW1lbnROdW0iLCJ0b3RhbCIsImRhdGUiLCJtb21lbnQiLCJ0cm5QdXJjaGFzZURhdGUiLCJjaGFyZ2VkQW1vdW50IiwidHJuQW10IiwiYW10QmVmb3JlQ29udkFuZEluZGV4Iiwib3JpZ2luYWxBbW91bnQiLCJ0cm5UeXBlQ29kZSIsImNyZWRpdCIsImlkZW50aWZpZXIiLCJ0cm5JbnRJZCIsInR5cGUiLCJyZWd1bGFyIiwic3RhbmRpbmdPcmRlciIsIlRyYW5zYWN0aW9uVHlwZXMiLCJOb3JtYWwiLCJJbnN0YWxsbWVudHMiLCJzdGF0dXMiLCJUcmFuc2FjdGlvblN0YXR1c2VzIiwiUGVuZGluZyIsIkNvbXBsZXRlZCIsImFkZCIsInRvSVNPU3RyaW5nIiwicHJvY2Vzc2VkRGF0ZSIsIkRhdGUiLCJvcmlnaW5hbEN1cnJlbmN5IiwidHJuQ3VycmVuY3lTeW1ib2wiLCJjaGFyZ2VkQ3VycmVuY3kiLCJkZWJDcmRDdXJyZW5jeVN5bWJvbCIsImRlc2NyaXB0aW9uIiwibWVyY2hhbnROYW1lIiwibWVtbyIsInRyYW5zVHlwZUNvbW1lbnREZXRhaWxzIiwidG9TdHJpbmciLCJjYXRlZ29yeSIsImJyYW5jaENvZGVEZXNjIiwiaW5jbHVkZVJhd1RyYW5zYWN0aW9uIiwicmF3VHJhbnNhY3Rpb24iLCJnZXRSYXdUcmFuc2FjdGlvbiIsIlZpc2FDYWxTY3JhcGVyIiwiQmFzZVNjcmFwZXJXaXRoQnJvd3NlciIsImF1dGhvcml6YXRpb24iLCJvcGVuTG9naW5Qb3B1cCIsIndhaXRVbnRpbEVsZW1lbnRGb3VuZCIsImNsaWNrQnV0dG9uIiwiZ2V0Q2FyZHMiLCJpbml0RGF0YSIsImdldEZyb21TZXNzaW9uU3RvcmFnZSIsImNhcmRzIiwiY2FyZFVuaXF1ZUlkIiwibGFzdDREaWdpdHMiLCJnZXRBdXRob3JpemF0aW9uSGVhZGVyIiwiYXV0aE1vZHVsZSIsImdldFhTaXRlSWQiLCJnZXRMb2dpbk9wdGlvbnMiLCJhdXRoUmVxdWVzdFByb21pc2UiLCJ3YWl0Rm9yUmVxdWVzdCIsInRpbWVvdXQiLCJjYXRjaCIsImxvZ2luVXJsIiwiZmllbGRzIiwic3VibWl0QnV0dG9uU2VsZWN0b3IiLCJwb3NzaWJsZVJlc3VsdHMiLCJjaGVja1JlYWRpbmVzcyIsInByZUFjdGlvbiIsInBvc3RBY3Rpb24iLCJ3YWl0Rm9yTmF2aWdhdGlvbiIsImN1cnJlbnRVcmwiLCJnZXRDdXJyZW50VXJsIiwiZW5kc1dpdGgiLCJyZXF1ZXN0IiwiaGVhZGVycyIsInJlcXVpcmVzQ2hhbmdlUGFzc3dvcmQiLCJ1c2VyQWdlbnQiLCJwcmVwYXJlUGFnZSIsImxvZ2luUmVzcG9uc2UiLCJmZXRjaCIsIm1ldGhvZCIsImFjY2VwdCIsIm9yaWdpbiIsInJlZmVyZXIiLCJib2R5IiwiSlNPTiIsInN0cmluZ2lmeSIsInJlY2FwdGNoYSIsIm9rIiwibG9naW5EYXRhIiwianNvbiIsInRva2VuIiwiX192aXNhQ2FsVG9rZW4iLCJzZXRSZXF1ZXN0SW50ZXJjZXB0aW9uIiwib24iLCJyZXNwb25kIiwiY29udGVudFR5cGUiLCJoYXNoIiwiaW5uZXJMb2dpblR5cGUiLCJjb250aW51ZSIsImVyciIsIm1lc3NhZ2UiLCJmZXRjaERhdGEiLCJkZWZhdWx0U3RhcnRNb21lbnQiLCJzdWJ0cmFjdCIsInN0YXJ0RGF0ZSIsInRvRGF0ZSIsInN0YXJ0TW9tZW50IiwibWF4IiwiZm9ybWF0IiwieFNpdGVJZCIsIkF1dGhvcml6YXRpb24iLCJmdXR1cmVNb250aHNUb1NjcmFwZSIsImZldGNoUG9zdCIsImNhcmRzRm9yRnJhbWVEYXRhIiwiZmluYWxNb250aFRvRmV0Y2hNb21lbnQiLCJtb250aHMiLCJkaWZmIiwiYWxsTW9udGhzRGF0YSIsImJhbmtJc3N1ZWRDYXJkcyIsImNhcmRMZXZlbEZyYW1lcyIsImNhcmRVbmlxdWVJREFycmF5IiwiaSIsIm1vbnRoIiwiY2xvbmUiLCJ5ZWFyIiwic3RhdHVzQ29kZSIsInRpdGxlIiwicHVzaCIsInR4bnMiLCJvdXRwdXREYXRhIiwiZW5hYmxlVHJhbnNhY3Rpb25zRmlsdGVyQnlEYXRlIiwiZmlsdGVyT2xkVHJhbnNhY3Rpb25zIiwiY29tYmluZUluc3RhbGxtZW50cyIsImJhbGFuY2UiLCJuZXh0VG90YWxEZWJpdCIsImFjY291bnROdW1iZXIiLCJzdWNjZXNzIiwiX2RlZmF1bHQiLCJleHBvcnRzIl0sInNvdXJjZXMiOlsiLi4vLi4vc3JjL3NjcmFwZXJzL3Zpc2EtY2FsLnRzIl0sInNvdXJjZXNDb250ZW50IjpbImltcG9ydCBtb21lbnQgZnJvbSAnbW9tZW50JztcbmltcG9ydCB7IHR5cGUgSFRUUFJlcXVlc3QsIHR5cGUgRnJhbWUsIHR5cGUgUGFnZSB9IGZyb20gJ3B1cHBldGVlcic7XG5pbXBvcnQgeyBnZXREZWJ1ZyB9IGZyb20gJy4uL2hlbHBlcnMvZGVidWcnO1xuaW1wb3J0IHsgY2xpY2tCdXR0b24sIGVsZW1lbnRQcmVzZW50T25QYWdlLCBwYWdlRXZhbCwgd2FpdFVudGlsRWxlbWVudEZvdW5kIH0gZnJvbSAnLi4vaGVscGVycy9lbGVtZW50cy1pbnRlcmFjdGlvbnMnO1xuaW1wb3J0IHsgZmV0Y2hQb3N0IH0gZnJvbSAnLi4vaGVscGVycy9mZXRjaCc7XG5pbXBvcnQgeyBnZXRDdXJyZW50VXJsLCB3YWl0Rm9yTmF2aWdhdGlvbiB9IGZyb20gJy4uL2hlbHBlcnMvbmF2aWdhdGlvbic7XG5pbXBvcnQgeyBnZXRGcm9tU2Vzc2lvblN0b3JhZ2UgfSBmcm9tICcuLi9oZWxwZXJzL3N0b3JhZ2UnO1xuaW1wb3J0IHsgZmlsdGVyT2xkVHJhbnNhY3Rpb25zLCBnZXRSYXdUcmFuc2FjdGlvbiB9IGZyb20gJy4uL2hlbHBlcnMvdHJhbnNhY3Rpb25zJztcbmltcG9ydCB7IHdhaXRVbnRpbCB9IGZyb20gJy4uL2hlbHBlcnMvd2FpdGluZyc7XG5pbXBvcnQgeyBUcmFuc2FjdGlvblN0YXR1c2VzLCBUcmFuc2FjdGlvblR5cGVzLCB0eXBlIFRyYW5zYWN0aW9uLCB0eXBlIFRyYW5zYWN0aW9uc0FjY291bnQgfSBmcm9tICcuLi90cmFuc2FjdGlvbnMnO1xuaW1wb3J0IHsgQmFzZVNjcmFwZXJXaXRoQnJvd3NlciwgTG9naW5SZXN1bHRzLCB0eXBlIExvZ2luT3B0aW9ucyB9IGZyb20gJy4vYmFzZS1zY3JhcGVyLXdpdGgtYnJvd3Nlcic7XG5pbXBvcnQgeyB0eXBlIFNjcmFwZXJTY3JhcGluZ1Jlc3VsdCwgdHlwZSBTY3JhcGVyT3B0aW9ucyB9IGZyb20gJy4vaW50ZXJmYWNlJztcblxuY29uc3QgYXBpSGVhZGVycyA9IHtcbiAgJ1VzZXItQWdlbnQnOlxuICAgICdNb3ppbGxhLzUuMCAoTWFjaW50b3NoOyBJbnRlbCBNYWMgT1MgWCAxMF8xNV83KSBBcHBsZVdlYktpdC81MzcuMzYgKEtIVE1MLCBsaWtlIEdlY2tvKSBDaHJvbWUvMTQyLjAuMC4wIFNhZmFyaS81MzcuMzYnLFxuICBPcmlnaW46ICdodHRwczovL2RpZ2l0YWwtd2ViLmNhbC1vbmxpbmUuY28uaWwnLFxuICBSZWZlcmVyOiAnaHR0cHM6Ly9kaWdpdGFsLXdlYi5jYWwtb25saW5lLmNvLmlsJyxcbiAgJ0FjY2VwdC1MYW5ndWFnZSc6ICdoZS1JTCxoZTtxPTAuOSxlbi1VUztxPTAuOCxlbjtxPTAuNycsXG4gICdTZWMtRmV0Y2gtU2l0ZSc6ICdzYW1lLXNpdGUnLFxuICAnU2VjLUZldGNoLU1vZGUnOiAnY29ycycsXG4gICdTZWMtRmV0Y2gtRGVzdCc6ICdlbXB0eScsXG59O1xuY29uc3QgTE9HSU5fVVJMID0gJ2h0dHBzOi8vd3d3LmNhbC1vbmxpbmUuY28uaWwvJztcbmNvbnN0IFRSQU5TQUNUSU9OU19SRVFVRVNUX0VORFBPSU5UID1cbiAgJ2h0dHBzOi8vYXBpLmNhbC1vbmxpbmUuY28uaWwvVHJhbnNhY3Rpb25zL2FwaS90cmFuc2FjdGlvbnNEZXRhaWxzL2dldENhcmRUcmFuc2FjdGlvbnNEZXRhaWxzJztcbmNvbnN0IEZSQU1FU19SRVFVRVNUX0VORFBPSU5UID0gJ2h0dHBzOi8vYXBpLmNhbC1vbmxpbmUuY28uaWwvRnJhbWVzL2FwaS9GcmFtZXMvR2V0RnJhbWVTdGF0dXMnO1xuY29uc3QgUEVORElOR19UUkFOU0FDVElPTlNfUkVRVUVTVF9FTkRQT0lOVCA9XG4gICdodHRwczovL2FwaS5jYWwtb25saW5lLmNvLmlsL1RyYW5zYWN0aW9ucy9hcGkvYXBwcm92YWxzL2dldENsZWFyYW5jZVJlcXVlc3RzJztcbmNvbnN0IFNTT19BVVRIT1JJWkFUSU9OX1JFUVVFU1RfRU5EUE9JTlQgPSAnaHR0cHM6Ly9jb25uZWN0LmNhbC1vbmxpbmUuY28uaWwvY29sLXJlc3QvY2FsY29ubmVjdC9hdXRoZW50aWNhdGlvbi9TU08nO1xuXG5jb25zdCBJbnZhbGlkUGFzc3dvcmRNZXNzYWdlID0gJ9ep150g15TXntep16rXntepINeQ15Ug15TXodeZ16HXnteUINep15TXldeW16DXlSDXqdeS15XXmdeZ150nO1xuY29uc3QgQ2hhbmdlUGFzc3dvcmRNZXNzYWdlID0gJ9ec15TXl9ec15nXoyDXodeZ16HXnteUJztcblxuY29uc3QgZGVidWcgPSBnZXREZWJ1ZygndmlzYS1jYWwnKTtcblxuZW51bSBUcm5UeXBlQ29kZSB7XG4gIHJlZ3VsYXIgPSAnNScsXG4gIGNyZWRpdCA9ICc2JyxcbiAgaW5zdGFsbG1lbnRzID0gJzgnLFxuICBzdGFuZGluZ09yZGVyID0gJzknLFxufVxuXG5pbnRlcmZhY2UgU2NyYXBlZFRyYW5zYWN0aW9uIHtcbiAgYW10QmVmb3JlQ29udkFuZEluZGV4OiBudW1iZXI7XG4gIGJyYW5jaENvZGVEZXNjOiBzdHJpbmc7XG4gIGNhc2hBY2NNYW5hZ2VyTmFtZTogbnVsbDtcbiAgY2FzaEFjY291bnRNYW5hZ2VyOiBudWxsO1xuICBjYXNoQWNjb3VudFRybkFtdDogbnVtYmVyO1xuICBjaGFyZ2VFeHRlcm5hbFRvQ2FyZENvbW1lbnQ6IHN0cmluZztcbiAgY29tbWVudHM6IFtdO1xuICBjdXJQYXltZW50TnVtOiBudW1iZXI7XG4gIGRlYkNyZEN1cnJlbmN5U3ltYm9sOiBDdXJyZW5jeVN5bWJvbDtcbiAgZGViQ3JkRGF0ZTogc3RyaW5nO1xuICBkZWJpdFNwcmVhZEluZDogYm9vbGVhbjtcbiAgZGlzY291bnRBbW91bnQ6IHVua25vd247XG4gIGRpc2NvdW50UmVhc29uOiB1bmtub3duO1xuICBpbW1lZGlhdGVDb21tZW50czogW107XG4gIGlzSW1tZWRpYXRlQ29tbWVudEluZDogYm9vbGVhbjtcbiAgaXNJbW1lZGlhdGVISEtJbmQ6IGJvb2xlYW47XG4gIGlzTWFyZ2FyaXRhOiBib29sZWFuO1xuICBpc1NwcmVhZFBheW1lbnN0QWJyb2FkOiBib29sZWFuO1xuICBsaW5rZWRDb21tZW50czogW107XG4gIG1lcmNoYW50QWRkcmVzczogc3RyaW5nO1xuICBtZXJjaGFudE5hbWU6IHN0cmluZztcbiAgbWVyY2hhbnRQaG9uZU5vOiBzdHJpbmc7XG4gIG51bU9mUGF5bWVudHM6IG51bWJlcjtcbiAgb25Hb2luZ1RyYW5zYWN0aW9uc0NvbW1lbnQ6IHN0cmluZztcbiAgcmVmdW5kSW5kOiBib29sZWFuO1xuICByb3VuZGluZ0Ftb3VudDogdW5rbm93bjtcbiAgcm91bmRpbmdSZWFzb246IHVua25vd247XG4gIHRva2VuSW5kOiAwO1xuICB0b2tlbk51bWJlclBhcnQ0OiAnJztcbiAgdHJhbnNDYXJkUHJlc2VudEluZDogYm9vbGVhbjtcbiAgdHJhbnNUeXBlQ29tbWVudERldGFpbHM6IFtdO1xuICB0cm5BbXQ6IG51bWJlcjtcbiAgdHJuQ3VycmVuY3lTeW1ib2w6IEN1cnJlbmN5U3ltYm9sO1xuICB0cm5FeGFjV2F5OiBudW1iZXI7XG4gIHRybkludElkOiBzdHJpbmc7XG4gIHRybk51bWFyZXRvcjogbnVtYmVyO1xuICB0cm5QdXJjaGFzZURhdGU6IHN0cmluZztcbiAgdHJuVHlwZTogc3RyaW5nO1xuICB0cm5UeXBlQ29kZTogVHJuVHlwZUNvZGU7XG4gIHdhbGxldFByb3ZpZGVyQ29kZTogMDtcbiAgd2FsbGV0UHJvdmlkZXJEZXNjOiAnJztcbiAgZWFybHlQYXltZW50SW5kOiBib29sZWFuO1xufVxuaW50ZXJmYWNlIFNjcmFwZWRQZW5kaW5nVHJhbnNhY3Rpb24ge1xuICBtZXJjaGFudElEOiBzdHJpbmc7XG4gIG1lcmNoYW50TmFtZTogc3RyaW5nO1xuICB0cm5QdXJjaGFzZURhdGU6IHN0cmluZztcbiAgd2FsbGV0VHJhbkluZDogbnVtYmVyO1xuICB0cmFuc2FjdGlvbnNPcmlnaW46IG51bWJlcjtcbiAgdHJuQW10OiBudW1iZXI7XG4gIHRwYUFwcHJvdmFsQW1vdW50OiB1bmtub3duO1xuICB0cm5DdXJyZW5jeVN5bWJvbDogQ3VycmVuY3lTeW1ib2w7XG4gIHRyblR5cGVDb2RlOiBUcm5UeXBlQ29kZTtcbiAgdHJuVHlwZTogc3RyaW5nO1xuICBicmFuY2hDb2RlRGVzYzogc3RyaW5nO1xuICB0cmFuc0NhcmRQcmVzZW50SW5kOiBib29sZWFuO1xuICBqNUluZGljYXRvcjogc3RyaW5nO1xuICBudW1iZXJPZlBheW1lbnRzOiBudW1iZXI7XG4gIGZpcnN0UGF5bWVudEFtb3VudDogbnVtYmVyO1xuICB0cmFuc1R5cGVDb21tZW50RGV0YWlsczogW107XG59XG5pbnRlcmZhY2UgSW5pdFJlc3BvbnNlIHtcbiAgcmVzdWx0OiB7XG4gICAgY2FyZHM6IHtcbiAgICAgIGNhcmRVbmlxdWVJZDogc3RyaW5nO1xuICAgICAgbGFzdDREaWdpdHM6IHN0cmluZztcbiAgICAgIFtrZXk6IHN0cmluZ106IHVua25vd247XG4gICAgfVtdO1xuICB9O1xufVxudHlwZSBDdXJyZW5jeVN5bWJvbCA9IHN0cmluZztcbmludGVyZmFjZSBDYXJkVHJhbnNhY3Rpb25EZXRhaWxzRXJyb3Ige1xuICB0aXRsZTogc3RyaW5nO1xuICBzdGF0dXNDb2RlOiBudW1iZXI7XG59XG5pbnRlcmZhY2UgQ2FyZFRyYW5zYWN0aW9uRGV0YWlscyBleHRlbmRzIENhcmRUcmFuc2FjdGlvbkRldGFpbHNFcnJvciB7XG4gIHJlc3VsdDoge1xuICAgIGJhbmtBY2NvdW50czoge1xuICAgICAgYmFua0FjY291bnROdW06IHN0cmluZztcbiAgICAgIGJhbmtOYW1lOiBzdHJpbmc7XG4gICAgICBjaG9pY2VFeHRlcm5hbFRyYW5zYWN0aW9uczogYW55O1xuICAgICAgY3VycmVudEJhbmtBY2NvdW50SW5kOiBib29sZWFuO1xuICAgICAgZGViaXREYXRlczoge1xuICAgICAgICBiYXNrZXRBbW91bnRDb21tZW50OiB1bmtub3duO1xuICAgICAgICBjaG9pY2VISEtEZWJpdDogbnVtYmVyO1xuICAgICAgICBkYXRlOiBzdHJpbmc7XG4gICAgICAgIGRlYml0UmVhc29uOiB1bmtub3duO1xuICAgICAgICBmaXhEZWJpdEFtb3VudDogbnVtYmVyO1xuICAgICAgICBmcm9tUHVyY2hhc2VEYXRlOiBzdHJpbmc7XG4gICAgICAgIGlzQ2hvaWNlUmVwYWltZW50OiBib29sZWFuO1xuICAgICAgICB0b1B1cmNoYXNlRGF0ZTogc3RyaW5nO1xuICAgICAgICB0b3RhbEJhc2tldEFtb3VudDogbnVtYmVyO1xuICAgICAgICB0b3RhbERlYml0czoge1xuICAgICAgICAgIGN1cnJlbmN5U3ltYm9sOiBDdXJyZW5jeVN5bWJvbDtcbiAgICAgICAgICBhbW91bnQ6IG51bWJlcjtcbiAgICAgICAgfVtdO1xuICAgICAgICB0cmFuc2FjdGlvbnM6IFNjcmFwZWRUcmFuc2FjdGlvbltdO1xuICAgICAgfVtdO1xuICAgICAgaW1taWRpYXRlRGViaXRzOiB7IHRvdGFsRGViaXRzOiBbXTsgZGViaXREYXlzOiBbXSB9O1xuICAgIH1bXTtcbiAgICBibG9ja2VkQ2FyZEluZDogYm9vbGVhbjtcbiAgfTtcbiAgc3RhdHVzQ29kZTogMTtcbiAgc3RhdHVzRGVzY3JpcHRpb246IHN0cmluZztcbiAgc3RhdHVzVGl0bGU6IHN0cmluZztcbn1cbmludGVyZmFjZSBDYXJkUGVuZGluZ1RyYW5zYWN0aW9uRGV0YWlscyBleHRlbmRzIENhcmRUcmFuc2FjdGlvbkRldGFpbHNFcnJvciB7XG4gIHJlc3VsdDoge1xuICAgIGNhcmRzTGlzdDoge1xuICAgICAgY2FyZFVuaXF1ZUlEOiBzdHJpbmc7XG4gICAgICBhdXRoRGV0YWxpc0xpc3Q6IFNjcmFwZWRQZW5kaW5nVHJhbnNhY3Rpb25bXTtcbiAgICB9W107XG4gIH07XG4gIHN0YXR1c0NvZGU6IDE7XG4gIHN0YXR1c0Rlc2NyaXB0aW9uOiBzdHJpbmc7XG4gIHN0YXR1c1RpdGxlOiBzdHJpbmc7XG59XG5cbmludGVyZmFjZSBDYXJkTGV2ZWxGcmFtZSB7XG4gIGNhcmRVbmlxdWVJZDogc3RyaW5nO1xuICBuZXh0VG90YWxEZWJpdD86IG51bWJlcjtcbn1cblxuaW50ZXJmYWNlIEZyYW1lc1Jlc3BvbnNlIHtcbiAgcmVzdWx0Pzoge1xuICAgIGJhbmtJc3N1ZWRDYXJkcz86IHtcbiAgICAgIGNhcmRMZXZlbEZyYW1lcz86IENhcmRMZXZlbEZyYW1lW107XG4gICAgfTtcbiAgfTtcbn1cblxuaW50ZXJmYWNlIEF1dGhNb2R1bGUge1xuICBhdXRoOiB7XG4gICAgY2FsQ29ubmVjdFRva2VuOiBzdHJpbmcgfCBudWxsO1xuICB9O1xufVxuXG5mdW5jdGlvbiBpc0F1dGhNb2R1bGUocmVzdWx0OiBhbnkpOiByZXN1bHQgaXMgQXV0aE1vZHVsZSB7XG4gIHJldHVybiBCb29sZWFuKHJlc3VsdD8uYXV0aD8uY2FsQ29ubmVjdFRva2VuICYmIFN0cmluZyhyZXN1bHQuYXV0aC5jYWxDb25uZWN0VG9rZW4pLnRyaW0oKSk7XG59XG5cbmZ1bmN0aW9uIGF1dGhNb2R1bGVPclVuZGVmaW5lZChyZXN1bHQ6IGFueSk6IEF1dGhNb2R1bGUgfCB1bmRlZmluZWQge1xuICByZXR1cm4gaXNBdXRoTW9kdWxlKHJlc3VsdCkgPyByZXN1bHQgOiB1bmRlZmluZWQ7XG59XG5cbmZ1bmN0aW9uIGlzUGVuZGluZyhcbiAgdHJhbnNhY3Rpb246IFNjcmFwZWRUcmFuc2FjdGlvbiB8IFNjcmFwZWRQZW5kaW5nVHJhbnNhY3Rpb24sXG4pOiB0cmFuc2FjdGlvbiBpcyBTY3JhcGVkUGVuZGluZ1RyYW5zYWN0aW9uIHtcbiAgcmV0dXJuICh0cmFuc2FjdGlvbiBhcyBTY3JhcGVkVHJhbnNhY3Rpb24pLmRlYkNyZERhdGUgPT09IHVuZGVmaW5lZDsgLy8gYW4gYXJiaXRyYXJ5IGZpZWxkIHRoYXQgb25seSBhcHBlYXJzIGluIGEgY29tcGxldGVkIHRyYW5zYWN0aW9uXG59XG5cbmZ1bmN0aW9uIGlzQ2FyZFRyYW5zYWN0aW9uRGV0YWlscyhcbiAgcmVzdWx0OiBDYXJkVHJhbnNhY3Rpb25EZXRhaWxzIHwgQ2FyZFRyYW5zYWN0aW9uRGV0YWlsc0Vycm9yLFxuKTogcmVzdWx0IGlzIENhcmRUcmFuc2FjdGlvbkRldGFpbHMge1xuICByZXR1cm4gKHJlc3VsdCBhcyBDYXJkVHJhbnNhY3Rpb25EZXRhaWxzKS5yZXN1bHQgIT09IHVuZGVmaW5lZDtcbn1cblxuZnVuY3Rpb24gaXNDYXJkUGVuZGluZ1RyYW5zYWN0aW9uRGV0YWlscyhcbiAgcmVzdWx0OiBDYXJkUGVuZGluZ1RyYW5zYWN0aW9uRGV0YWlscyB8IENhcmRUcmFuc2FjdGlvbkRldGFpbHNFcnJvcixcbik6IHJlc3VsdCBpcyBDYXJkUGVuZGluZ1RyYW5zYWN0aW9uRGV0YWlscyB7XG4gIHJldHVybiAocmVzdWx0IGFzIENhcmRQZW5kaW5nVHJhbnNhY3Rpb25EZXRhaWxzKS5yZXN1bHQgIT09IHVuZGVmaW5lZDtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZ2V0TG9naW5GcmFtZShwYWdlOiBQYWdlKSB7XG4gIGxldCBmcmFtZTogRnJhbWUgfCBudWxsID0gbnVsbDtcbiAgZGVidWcoJ3dhaXQgdW50aWwgbG9naW4gZnJhbWUgZm91bmQnKTtcbiAgYXdhaXQgd2FpdFVudGlsKFxuICAgICgpID0+IHtcbiAgICAgIGZyYW1lID0gcGFnZS5mcmFtZXMoKS5maW5kKGYgPT4gZi51cmwoKS5pbmNsdWRlcygnY29ubmVjdCcpKSB8fCBudWxsO1xuICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSghIWZyYW1lKTtcbiAgICB9LFxuICAgICd3YWl0IGZvciBpZnJhbWUgd2l0aCBsb2dpbiBmb3JtJyxcbiAgICAxMDAwMCxcbiAgICAxMDAwLFxuICApO1xuXG4gIGlmICghZnJhbWUpIHtcbiAgICBkZWJ1ZygnZmFpbGVkIHRvIGZpbmQgbG9naW4gZnJhbWUgZm9yIDEwIHNlY29uZHMnKTtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ2ZhaWxlZCB0byBleHRyYWN0IGxvZ2luIGlmcmFtZScpO1xuICB9XG5cbiAgcmV0dXJuIGZyYW1lO1xufVxuXG5hc3luYyBmdW5jdGlvbiBoYXNJbnZhbGlkUGFzc3dvcmRFcnJvcihwYWdlOiBQYWdlKSB7XG4gIGNvbnN0IGZyYW1lID0gYXdhaXQgZ2V0TG9naW5GcmFtZShwYWdlKTtcbiAgY29uc3QgZXJyb3JGb3VuZCA9IGF3YWl0IGVsZW1lbnRQcmVzZW50T25QYWdlKGZyYW1lLCAnZGl2LmdlbmVyYWwtZXJyb3IgPiBkaXYnKTtcbiAgY29uc3QgZXJyb3JNZXNzYWdlID0gZXJyb3JGb3VuZFxuICAgID8gYXdhaXQgcGFnZUV2YWwoZnJhbWUsICdkaXYuZ2VuZXJhbC1lcnJvciA+IGRpdicsICcnLCBpdGVtID0+IHtcbiAgICAgICAgcmV0dXJuIChpdGVtIGFzIEhUTUxEaXZFbGVtZW50KS5pbm5lclRleHQ7XG4gICAgICB9KVxuICAgIDogJyc7XG4gIHJldHVybiBlcnJvck1lc3NhZ2UgPT09IEludmFsaWRQYXNzd29yZE1lc3NhZ2U7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGhhc0NoYW5nZVBhc3N3b3JkRm9ybShwYWdlOiBQYWdlKSB7XG4gIGNvbnN0IGZyYW1lID0gYXdhaXQgZ2V0TG9naW5GcmFtZShwYWdlKTtcbiAgLy8gXCLXm9eT15kg15zXlNeX15zXmdejINeh15nXodee15Qg15nXqSDXnNec15fXldelINei15wgJ9ep15vXl9eq15kg16nXnSDXntep16rXntepIC8g16HXmdeh157XlCcg15HXnteh15og15TXm9eg15nXodeUXCJcbiAgY29uc3QgZXJyb3JGb3VuZCA9IGF3YWl0IGVsZW1lbnRQcmVzZW50T25QYWdlKGZyYW1lLCAnLmVyci1kZXNjJyk7XG4gIGlmIChlcnJvckZvdW5kKSB7XG4gICAgY29uc3QgZXJyVGV4dCA9IGF3YWl0IHBhZ2VFdmFsKGZyYW1lLCAnLmVyci1kZXNjJywgJycsIGl0ZW0gPT4ge1xuICAgICAgcmV0dXJuIChpdGVtIGFzIEhUTUxFbGVtZW50KS5pbm5lclRleHQudHJpbSgpO1xuICAgIH0pO1xuICAgIHJldHVybiBlcnJUZXh0LmluY2x1ZGVzKENoYW5nZVBhc3N3b3JkTWVzc2FnZSk7XG4gIH1cbiAgcmV0dXJuIGZhbHNlO1xufVxuXG5mdW5jdGlvbiBnZXRQb3NzaWJsZUxvZ2luUmVzdWx0cygpIHtcbiAgZGVidWcoJ3JldHVybiBwb3NzaWJsZSBsb2dpbiByZXN1bHRzJyk7XG4gIGNvbnN0IHVybHM6IExvZ2luT3B0aW9uc1sncG9zc2libGVSZXN1bHRzJ10gPSB7XG4gICAgW0xvZ2luUmVzdWx0cy5TdWNjZXNzXTogWy9kYXNoYm9hcmQvaV0sXG4gICAgW0xvZ2luUmVzdWx0cy5JbnZhbGlkUGFzc3dvcmRdOiBbXG4gICAgICBhc3luYyAob3B0aW9ucz86IHsgcGFnZT86IFBhZ2UgfSkgPT4ge1xuICAgICAgICBjb25zdCBwYWdlID0gb3B0aW9ucz8ucGFnZTtcbiAgICAgICAgaWYgKCFwYWdlKSB7XG4gICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBoYXNJbnZhbGlkUGFzc3dvcmRFcnJvcihwYWdlKTtcbiAgICAgIH0sXG4gICAgXSxcbiAgICAvLyBbTG9naW5SZXN1bHRzLkFjY291bnRCbG9ja2VkXTogW10sIC8vIFRPRE8gYWRkIHdoZW4gcmVhY2hpbmcgdGhpcyBzY2VuYXJpb1xuICAgIFtMb2dpblJlc3VsdHMuQ2hhbmdlUGFzc3dvcmRdOiBbXG4gICAgICBhc3luYyAob3B0aW9ucz86IHsgcGFnZT86IFBhZ2UgfSkgPT4ge1xuICAgICAgICBjb25zdCBwYWdlID0gb3B0aW9ucz8ucGFnZTtcbiAgICAgICAgaWYgKCFwYWdlKSB7XG4gICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBoYXNDaGFuZ2VQYXNzd29yZEZvcm0ocGFnZSk7XG4gICAgICB9LFxuICAgIF0sXG4gIH07XG4gIHJldHVybiB1cmxzO1xufVxuXG5mdW5jdGlvbiBjcmVhdGVMb2dpbkZpZWxkcyhjcmVkZW50aWFsczogU2NyYXBlclNwZWNpZmljQ3JlZGVudGlhbHMpIHtcbiAgZGVidWcoJ2NyZWF0ZSBsb2dpbiBmaWVsZHMgZm9yIHVzZXJuYW1lIGFuZCBwYXNzd29yZCcpO1xuICByZXR1cm4gW1xuICAgIHsgc2VsZWN0b3I6ICdbZm9ybWNvbnRyb2xuYW1lPVwidXNlck5hbWVcIl0nLCB2YWx1ZTogY3JlZGVudGlhbHMudXNlcm5hbWUgfSxcbiAgICB7IHNlbGVjdG9yOiAnW2Zvcm1jb250cm9sbmFtZT1cInBhc3N3b3JkXCJdJywgdmFsdWU6IGNyZWRlbnRpYWxzLnBhc3N3b3JkIH0sXG4gIF07XG59XG5cbmZ1bmN0aW9uIGNvbnZlcnRQYXJzZWREYXRhVG9UcmFuc2FjdGlvbnMoXG4gIGRhdGE6IENhcmRUcmFuc2FjdGlvbkRldGFpbHNbXSxcbiAgcGVuZGluZ0RhdGE/OiBDYXJkUGVuZGluZ1RyYW5zYWN0aW9uRGV0YWlscyB8IG51bGwsXG4gIG9wdGlvbnM/OiBTY3JhcGVyT3B0aW9ucyxcbik6IFRyYW5zYWN0aW9uW10ge1xuICBjb25zdCBwZW5kaW5nVHJhbnNhY3Rpb25zID0gcGVuZGluZ0RhdGE/LnJlc3VsdFxuICAgID8gcGVuZGluZ0RhdGEucmVzdWx0LmNhcmRzTGlzdC5mbGF0TWFwKGNhcmQgPT4gY2FyZC5hdXRoRGV0YWxpc0xpc3QpXG4gICAgOiBbXTtcblxuICBjb25zdCBiYW5rQWNjb3VudHMgPSBkYXRhLmZsYXRNYXAobW9udGhEYXRhID0+IG1vbnRoRGF0YS5yZXN1bHQuYmFua0FjY291bnRzKTtcbiAgY29uc3QgcmVndWxhckRlYml0RGF5cyA9IGJhbmtBY2NvdW50cy5mbGF0TWFwKGFjY291bnRzID0+IGFjY291bnRzLmRlYml0RGF0ZXMpO1xuICBjb25zdCBpbW1lZGlhdGVEZWJpdERheXMgPSBiYW5rQWNjb3VudHMuZmxhdE1hcChhY2NvdW50cyA9PiBhY2NvdW50cy5pbW1pZGlhdGVEZWJpdHMuZGViaXREYXlzKTtcbiAgY29uc3QgY29tcGxldGVkVHJhbnNhY3Rpb25zID0gWy4uLnJlZ3VsYXJEZWJpdERheXMsIC4uLmltbWVkaWF0ZURlYml0RGF5c10uZmxhdE1hcChcbiAgICBkZWJpdERhdGUgPT4gZGViaXREYXRlLnRyYW5zYWN0aW9ucyxcbiAgKTtcblxuICBjb25zdCBhbGw6IChTY3JhcGVkVHJhbnNhY3Rpb24gfCBTY3JhcGVkUGVuZGluZ1RyYW5zYWN0aW9uKVtdID0gWy4uLnBlbmRpbmdUcmFuc2FjdGlvbnMsIC4uLmNvbXBsZXRlZFRyYW5zYWN0aW9uc107XG5cbiAgcmV0dXJuIGFsbC5tYXAodHJhbnNhY3Rpb24gPT4ge1xuICAgIGNvbnN0IG51bU9mUGF5bWVudHMgPSBpc1BlbmRpbmcodHJhbnNhY3Rpb24pID8gdHJhbnNhY3Rpb24ubnVtYmVyT2ZQYXltZW50cyA6IHRyYW5zYWN0aW9uLm51bU9mUGF5bWVudHM7XG4gICAgY29uc3QgaW5zdGFsbG1lbnRzID0gbnVtT2ZQYXltZW50c1xuICAgICAgPyB7XG4gICAgICAgICAgbnVtYmVyOiBpc1BlbmRpbmcodHJhbnNhY3Rpb24pID8gMSA6IHRyYW5zYWN0aW9uLmN1clBheW1lbnROdW0sXG4gICAgICAgICAgdG90YWw6IG51bU9mUGF5bWVudHMsXG4gICAgICAgIH1cbiAgICAgIDogdW5kZWZpbmVkO1xuXG4gICAgY29uc3QgZGF0ZSA9IG1vbWVudCh0cmFuc2FjdGlvbi50cm5QdXJjaGFzZURhdGUpO1xuXG4gICAgY29uc3QgY2hhcmdlZEFtb3VudCA9IChpc1BlbmRpbmcodHJhbnNhY3Rpb24pID8gdHJhbnNhY3Rpb24udHJuQW10IDogdHJhbnNhY3Rpb24uYW10QmVmb3JlQ29udkFuZEluZGV4KSAqIC0xO1xuICAgIGNvbnN0IG9yaWdpbmFsQW1vdW50ID0gdHJhbnNhY3Rpb24udHJuQW10ICogKHRyYW5zYWN0aW9uLnRyblR5cGVDb2RlID09PSBUcm5UeXBlQ29kZS5jcmVkaXQgPyAxIDogLTEpO1xuXG4gICAgY29uc3QgcmVzdWx0OiBUcmFuc2FjdGlvbiA9IHtcbiAgICAgIGlkZW50aWZpZXI6ICFpc1BlbmRpbmcodHJhbnNhY3Rpb24pID8gdHJhbnNhY3Rpb24udHJuSW50SWQgOiB1bmRlZmluZWQsXG4gICAgICB0eXBlOiBbVHJuVHlwZUNvZGUucmVndWxhciwgVHJuVHlwZUNvZGUuc3RhbmRpbmdPcmRlcl0uaW5jbHVkZXModHJhbnNhY3Rpb24udHJuVHlwZUNvZGUpXG4gICAgICAgID8gVHJhbnNhY3Rpb25UeXBlcy5Ob3JtYWxcbiAgICAgICAgOiBUcmFuc2FjdGlvblR5cGVzLkluc3RhbGxtZW50cyxcbiAgICAgIHN0YXR1czogaXNQZW5kaW5nKHRyYW5zYWN0aW9uKSA/IFRyYW5zYWN0aW9uU3RhdHVzZXMuUGVuZGluZyA6IFRyYW5zYWN0aW9uU3RhdHVzZXMuQ29tcGxldGVkLFxuICAgICAgZGF0ZTogaW5zdGFsbG1lbnRzID8gZGF0ZS5hZGQoaW5zdGFsbG1lbnRzLm51bWJlciAtIDEsICdtb250aCcpLnRvSVNPU3RyaW5nKCkgOiBkYXRlLnRvSVNPU3RyaW5nKCksXG4gICAgICBwcm9jZXNzZWREYXRlOiBpc1BlbmRpbmcodHJhbnNhY3Rpb24pID8gZGF0ZS50b0lTT1N0cmluZygpIDogbmV3IERhdGUodHJhbnNhY3Rpb24uZGViQ3JkRGF0ZSkudG9JU09TdHJpbmcoKSxcbiAgICAgIG9yaWdpbmFsQW1vdW50LFxuICAgICAgb3JpZ2luYWxDdXJyZW5jeTogdHJhbnNhY3Rpb24udHJuQ3VycmVuY3lTeW1ib2wsXG4gICAgICBjaGFyZ2VkQW1vdW50LFxuICAgICAgY2hhcmdlZEN1cnJlbmN5OiAhaXNQZW5kaW5nKHRyYW5zYWN0aW9uKSA/IHRyYW5zYWN0aW9uLmRlYkNyZEN1cnJlbmN5U3ltYm9sIDogdW5kZWZpbmVkLFxuICAgICAgZGVzY3JpcHRpb246IHRyYW5zYWN0aW9uLm1lcmNoYW50TmFtZSxcbiAgICAgIG1lbW86IHRyYW5zYWN0aW9uLnRyYW5zVHlwZUNvbW1lbnREZXRhaWxzLnRvU3RyaW5nKCksXG4gICAgICBjYXRlZ29yeTogdHJhbnNhY3Rpb24uYnJhbmNoQ29kZURlc2MsXG4gICAgfTtcblxuICAgIGlmIChpbnN0YWxsbWVudHMpIHtcbiAgICAgIHJlc3VsdC5pbnN0YWxsbWVudHMgPSBpbnN0YWxsbWVudHM7XG4gICAgfVxuXG4gICAgaWYgKG9wdGlvbnM/LmluY2x1ZGVSYXdUcmFuc2FjdGlvbikge1xuICAgICAgcmVzdWx0LnJhd1RyYW5zYWN0aW9uID0gZ2V0UmF3VHJhbnNhY3Rpb24odHJhbnNhY3Rpb24pO1xuICAgIH1cblxuICAgIHJldHVybiByZXN1bHQ7XG4gIH0pO1xufVxuXG50eXBlIFNjcmFwZXJTcGVjaWZpY0NyZWRlbnRpYWxzID0geyB1c2VybmFtZTogc3RyaW5nOyBwYXNzd29yZDogc3RyaW5nIH07XG5cbmNsYXNzIFZpc2FDYWxTY3JhcGVyIGV4dGVuZHMgQmFzZVNjcmFwZXJXaXRoQnJvd3NlcjxTY3JhcGVyU3BlY2lmaWNDcmVkZW50aWFscz4ge1xuICBwcml2YXRlIGF1dGhvcml6YXRpb246IHN0cmluZyB8IHVuZGVmaW5lZCA9IHVuZGVmaW5lZDtcblxuICBwcml2YXRlIGF1dGhSZXF1ZXN0UHJvbWlzZTogUHJvbWlzZTxIVFRQUmVxdWVzdCB8IHVuZGVmaW5lZD4gfCB1bmRlZmluZWQ7XG5cbiAgb3BlbkxvZ2luUG9wdXAgPSBhc3luYyAoKSA9PiB7XG4gICAgZGVidWcoJ29wZW4gbG9naW4gcG9wdXAsIHdhaXQgdW50aWwgbG9naW4gYnV0dG9uIGF2YWlsYWJsZScpO1xuICAgIGF3YWl0IHdhaXRVbnRpbEVsZW1lbnRGb3VuZCh0aGlzLnBhZ2UsICcjY2NMb2dpbkRlc2t0b3BCdG4nLCB0cnVlKTtcbiAgICBkZWJ1ZygnY2xpY2sgb24gdGhlIGxvZ2luIGJ1dHRvbicpO1xuICAgIGF3YWl0IGNsaWNrQnV0dG9uKHRoaXMucGFnZSwgJyNjY0xvZ2luRGVza3RvcEJ0bicpO1xuICAgIGRlYnVnKCdnZXQgdGhlIGZyYW1lIHRoYXQgaG9sZHMgdGhlIGxvZ2luJyk7XG4gICAgY29uc3QgZnJhbWUgPSBhd2FpdCBnZXRMb2dpbkZyYW1lKHRoaXMucGFnZSk7XG4gICAgZGVidWcoJ3dhaXQgdW50aWwgdGhlIHBhc3N3b3JkIGxvZ2luIHRhYiBoZWFkZXIgaXMgYXZhaWxhYmxlJyk7XG4gICAgYXdhaXQgd2FpdFVudGlsRWxlbWVudEZvdW5kKGZyYW1lLCAnI3JlZ3VsYXItbG9naW4nKTtcbiAgICBkZWJ1ZygnbmF2aWdhdGUgdG8gdGhlIHBhc3N3b3JkIGxvZ2luIHRhYicpO1xuICAgIGF3YWl0IGNsaWNrQnV0dG9uKGZyYW1lLCAnI3JlZ3VsYXItbG9naW4nKTtcbiAgICBkZWJ1Zygnd2FpdCB1bnRpbCB0aGUgcGFzc3dvcmQgbG9naW4gdGFiIGlzIGFjdGl2ZScpO1xuICAgIGF3YWl0IHdhaXRVbnRpbEVsZW1lbnRGb3VuZChmcmFtZSwgJ3JlZ3VsYXItbG9naW4nKTtcblxuICAgIHJldHVybiBmcmFtZTtcbiAgfTtcblxuICBhc3luYyBnZXRDYXJkcygpIHtcbiAgICBjb25zdCBpbml0RGF0YSA9IGF3YWl0IHdhaXRVbnRpbChcbiAgICAgICgpID0+IGdldEZyb21TZXNzaW9uU3RvcmFnZTxJbml0UmVzcG9uc2U+KHRoaXMucGFnZSwgJ2luaXQnKSxcbiAgICAgICdnZXQgaW5pdCBkYXRhIGluIHNlc3Npb24gc3RvcmFnZScsXG4gICAgICAxMDAwMCxcbiAgICAgIDEwMDAsXG4gICAgKTtcbiAgICBpZiAoIWluaXREYXRhKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ2NvdWxkIG5vdCBmaW5kIFwiaW5pdFwiIGRhdGEgaW4gc2Vzc2lvbiBzdG9yYWdlJyk7XG4gICAgfVxuICAgIHJldHVybiBpbml0RGF0YT8ucmVzdWx0LmNhcmRzLm1hcCgoeyBjYXJkVW5pcXVlSWQsIGxhc3Q0RGlnaXRzIH0pID0+ICh7IGNhcmRVbmlxdWVJZCwgbGFzdDREaWdpdHMgfSkpO1xuICB9XG5cbiAgYXN5bmMgZ2V0QXV0aG9yaXphdGlvbkhlYWRlcigpIHtcbiAgICBpZiAoIXRoaXMuYXV0aG9yaXphdGlvbikge1xuICAgICAgZGVidWcoJ2ZldGNoaW5nIGF1dGhvcml6YXRpb24gaGVhZGVyJyk7XG4gICAgICBjb25zdCBhdXRoTW9kdWxlID0gYXdhaXQgd2FpdFVudGlsKFxuICAgICAgICBhc3luYyAoKSA9PiBhdXRoTW9kdWxlT3JVbmRlZmluZWQoYXdhaXQgZ2V0RnJvbVNlc3Npb25TdG9yYWdlPEF1dGhNb2R1bGU+KHRoaXMucGFnZSwgJ2F1dGgtbW9kdWxlJykpLFxuICAgICAgICAnZ2V0IGF1dGhvcml6YXRpb24gaGVhZGVyIHdpdGggdmFsaWQgdG9rZW4gaW4gc2Vzc2lvbiBzdG9yYWdlJyxcbiAgICAgICAgMTBfMDAwLFxuICAgICAgICA1MCxcbiAgICAgICk7XG4gICAgICByZXR1cm4gYENBTEF1dGhTY2hlbWUgJHthdXRoTW9kdWxlLmF1dGguY2FsQ29ubmVjdFRva2VufWA7XG4gICAgfVxuICAgIHJldHVybiB0aGlzLmF1dGhvcml6YXRpb247XG4gIH1cblxuICBhc3luYyBnZXRYU2l0ZUlkKCkge1xuICAgIC8qXG4gICAgICBJIGRvbid0IGtub3cgaWYgdGhlIGNvbnN0YW50IGJlbG93IHdpbGwgY2hhbmdlIGluIHRoZSBmZWF0dXJlLlxuICAgICAgSWYgc28sIHVzZSB0aGUgbmV4dCBjb2RlOlxuXG4gICAgICByZXR1cm4gdGhpcy5wYWdlLmV2YWx1YXRlKCgpID0+IG5ldyBVdCgpLnhTaXRlSWQpO1xuXG4gICAgICBUbyBnZXQgdGhlIGNsYXNzbmFtZSBzZWFyY2ggZm9yICd4U2l0ZUlkJyBpbiB0aGUgcGFnZSBzb3VyY2VcbiAgICAgIGNsYXNzIFV0IHtcbiAgICAgICAgY29uc3RydWN0b3IoX2UsIG9uLCB5bikge1xuICAgICAgICAgICAgdGhpcy5zdG9yZSA9IF9lLFxuICAgICAgICAgICAgdGhpcy5jb25maWcgPSBvbixcbiAgICAgICAgICAgIHRoaXMuZXZlbnRCdXNTZXJ2aWNlID0geW4sXG4gICAgICAgICAgICB0aGlzLnhTaXRlSWQgPSBcIjA5MDMxOTg3LTI3M0UtMjMxMS05MDZDLThBRjg1QjE3QzhEOVwiLFxuICAgICovXG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgnMDkwMzE5ODctMjczRS0yMzExLTkwNkMtOEFGODVCMTdDOEQ5Jyk7XG4gIH1cblxuICBnZXRMb2dpbk9wdGlvbnMoY3JlZGVudGlhbHM6IFNjcmFwZXJTcGVjaWZpY0NyZWRlbnRpYWxzKTogTG9naW5PcHRpb25zIHtcbiAgICB0aGlzLmF1dGhSZXF1ZXN0UHJvbWlzZSA9IHRoaXMucGFnZVxuICAgICAgLndhaXRGb3JSZXF1ZXN0KFNTT19BVVRIT1JJWkFUSU9OX1JFUVVFU1RfRU5EUE9JTlQsIHsgdGltZW91dDogMTBfMDAwIH0pXG4gICAgICAuY2F0Y2goZSA9PiB7XG4gICAgICAgIGRlYnVnKCdlcnJvciB3aGlsZSB3YWl0aW5nIGZvciB0aGUgdG9rZW4gcmVxdWVzdCcsIGUpO1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgfSk7XG4gICAgcmV0dXJuIHtcbiAgICAgIGxvZ2luVXJsOiBgJHtMT0dJTl9VUkx9YCxcbiAgICAgIGZpZWxkczogY3JlYXRlTG9naW5GaWVsZHMoY3JlZGVudGlhbHMpLFxuICAgICAgc3VibWl0QnV0dG9uU2VsZWN0b3I6ICdidXR0b25bdHlwZT1cInN1Ym1pdFwiXScsXG4gICAgICBwb3NzaWJsZVJlc3VsdHM6IGdldFBvc3NpYmxlTG9naW5SZXN1bHRzKCksXG4gICAgICBjaGVja1JlYWRpbmVzczogYXN5bmMgKCkgPT4gd2FpdFVudGlsRWxlbWVudEZvdW5kKHRoaXMucGFnZSwgJyNjY0xvZ2luRGVza3RvcEJ0bicpLFxuICAgICAgcHJlQWN0aW9uOiB0aGlzLm9wZW5Mb2dpblBvcHVwLFxuICAgICAgcG9zdEFjdGlvbjogYXN5bmMgKCkgPT4ge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGF3YWl0IHdhaXRGb3JOYXZpZ2F0aW9uKHRoaXMucGFnZSk7XG4gICAgICAgICAgY29uc3QgY3VycmVudFVybCA9IGF3YWl0IGdldEN1cnJlbnRVcmwodGhpcy5wYWdlKTtcbiAgICAgICAgICBpZiAoY3VycmVudFVybC5lbmRzV2l0aCgnc2l0ZS10dXRvcmlhbCcpKSB7XG4gICAgICAgICAgICBhd2FpdCBjbGlja0J1dHRvbih0aGlzLnBhZ2UsICdidXR0b24uYnRuLWNsb3NlJyk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGNvbnN0IHJlcXVlc3QgPSBhd2FpdCB0aGlzLmF1dGhSZXF1ZXN0UHJvbWlzZTtcbiAgICAgICAgICB0aGlzLmF1dGhvcml6YXRpb24gPSBTdHJpbmcocmVxdWVzdD8uaGVhZGVycygpLmF1dGhvcml6YXRpb24gfHwgJycpLnRyaW0oKTtcbiAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgIGNvbnN0IGN1cnJlbnRVcmwgPSBhd2FpdCBnZXRDdXJyZW50VXJsKHRoaXMucGFnZSk7XG4gICAgICAgICAgaWYgKGN1cnJlbnRVcmwuZW5kc1dpdGgoJ2Rhc2hib2FyZCcpKSByZXR1cm47XG4gICAgICAgICAgY29uc3QgcmVxdWlyZXNDaGFuZ2VQYXNzd29yZCA9IGF3YWl0IGhhc0NoYW5nZVBhc3N3b3JkRm9ybSh0aGlzLnBhZ2UpO1xuICAgICAgICAgIGlmIChyZXF1aXJlc0NoYW5nZVBhc3N3b3JkKSByZXR1cm47XG4gICAgICAgICAgdGhyb3cgZTtcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICAgIHVzZXJBZ2VudDogYXBpSGVhZGVyc1snVXNlci1BZ2VudCddLFxuICAgICAgcHJlcGFyZVBhZ2U6IGFzeW5jICgpID0+IHtcbiAgICAgICAgLy8gQnlwYXNzIENhbCdzIGFudGktYm90IGRldGVjdGlvbiBieSBkb2luZyBhIGRpcmVjdCBBUEkgbG9naW5cbiAgICAgICAgLy8gYW5kIGluamVjdGluZyB0aGUgU1NPIHRva2VuIGludG8gdGhlIGJyb3dzZXIncyBsb2dpbiBmbG93LlxuICAgICAgICAvLyBUaGUgYnJvd3Nlci1iYXNlZCBsb2dpbiBmb3JtIHN1Ym1pc3Npb24gaXMgYmxvY2tlZCBieSBDYWwncyBXQUZcbiAgICAgICAgLy8gd2hlbiBkZXRlY3RlZCBhcyBhdXRvbWF0aW9uLCBzbyB3ZSBwcmUtYXV0aGVudGljYXRlIHZpYSBkaXJlY3QgQVBJIGNhbGwuXG4gICAgICAgIGRlYnVnKCd2aXNhQ2FsOiBkb2luZyBkaXJlY3QgQVBJIGxvZ2luIHRvIGJ5cGFzcyBXQUYgYW50aS1ib3QgZGV0ZWN0aW9uJyk7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgY29uc3QgbG9naW5SZXNwb25zZSA9IGF3YWl0IGZldGNoKFxuICAgICAgICAgICAgJ2h0dHBzOi8vY29ubmVjdC5jYWwtb25saW5lLmNvLmlsL2NvbC1yZXN0L2NhbGNvbm5lY3QvYXV0aGVudGljYXRpb24vbG9naW4nLFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBtZXRob2Q6ICdQT1NUJyxcbiAgICAgICAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgICAgICAgIGFjY2VwdDogJ2FwcGxpY2F0aW9uL2pzb24sIHRleHQvcGxhaW4sICovKicsXG4gICAgICAgICAgICAgICAgJ2NvbnRlbnQtdHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgICAgICAgICAgICBvcmlnaW46ICdodHRwczovL2RpZ2l0YWwtd2ViLmNhbC1vbmxpbmUuY28uaWwnLFxuICAgICAgICAgICAgICAgIHJlZmVyZXI6ICdodHRwczovL2RpZ2l0YWwtd2ViLmNhbC1vbmxpbmUuY28uaWwvJyxcbiAgICAgICAgICAgICAgICAneC1zaXRlLWlkJzogJzA5MDMxOTg3LTI3M0UtMjMxMS05MDZDLThBRjg1QjE3QzhEOScsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICAgICAgICB1c2VybmFtZTogY3JlZGVudGlhbHMudXNlcm5hbWUsXG4gICAgICAgICAgICAgICAgcGFzc3dvcmQ6IGNyZWRlbnRpYWxzLnBhc3N3b3JkLFxuICAgICAgICAgICAgICAgIHJlY2FwdGNoYTogJycsXG4gICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICApO1xuXG4gICAgICAgICAgaWYgKCFsb2dpblJlc3BvbnNlLm9rKSB7XG4gICAgICAgICAgICBkZWJ1ZyhgdmlzYUNhbDogZGlyZWN0IGxvZ2luIGZhaWxlZCB3aXRoIHN0YXR1cyAke2xvZ2luUmVzcG9uc2Uuc3RhdHVzfWApO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGNvbnN0IGxvZ2luRGF0YSA9IGF3YWl0IGxvZ2luUmVzcG9uc2UuanNvbigpO1xuICAgICAgICAgIGlmICghbG9naW5EYXRhLnRva2VuKSB7XG4gICAgICAgICAgICBkZWJ1ZygndmlzYUNhbDogZGlyZWN0IGxvZ2luIGRpZCBub3QgcmV0dXJuIGEgdG9rZW4nKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBkZWJ1ZygndmlzYUNhbDogZGlyZWN0IGxvZ2luIHN1Y2Nlc3NmdWwsIHNldHRpbmcgdXAgcmVxdWVzdCBpbnRlcmNlcHRpb24nKTtcbiAgICAgICAgICAodGhpcyBhcyBhbnkpLl9fdmlzYUNhbFRva2VuID0gbG9naW5EYXRhLnRva2VuO1xuXG4gICAgICAgICAgYXdhaXQgdGhpcy5wYWdlLnNldFJlcXVlc3RJbnRlcmNlcHRpb24odHJ1ZSk7XG4gICAgICAgICAgdGhpcy5wYWdlLm9uKCdyZXF1ZXN0JywgYXN5bmMgKHJlcXVlc3Q6IEhUVFBSZXF1ZXN0KSA9PiB7XG4gICAgICAgICAgICBjb25zdCB1cmwgPSByZXF1ZXN0LnVybCgpO1xuICAgICAgICAgICAgaWYgKFxuICAgICAgICAgICAgICB1cmwuaW5jbHVkZXMoJy9jb2wtcmVzdC9jYWxjb25uZWN0L2F1dGhlbnRpY2F0aW9uL2xvZ2luJykgJiZcbiAgICAgICAgICAgICAgcmVxdWVzdC5tZXRob2QoKSA9PT0gJ1BPU1QnXG4gICAgICAgICAgICApIHtcbiAgICAgICAgICAgICAgZGVidWcoJ3Zpc2FDYWw6IGludGVyY2VwdGluZyBsb2dpbiBQT1NULCBpbmplY3RpbmcgZGlyZWN0IEFQSSB0b2tlbicpO1xuICAgICAgICAgICAgICByZXF1ZXN0LnJlc3BvbmQoe1xuICAgICAgICAgICAgICAgIHN0YXR1czogMjAwLFxuICAgICAgICAgICAgICAgIGNvbnRlbnRUeXBlOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICAgICAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgICAgICAgICAgJ2FjY2Vzcy1jb250cm9sLWFsbG93LW9yaWdpbic6ICdodHRwczovL2RpZ2l0YWwtd2ViLmNhbC1vbmxpbmUuY28uaWwnLFxuICAgICAgICAgICAgICAgICAgJ2FjY2Vzcy1jb250cm9sLWFsbG93LWNyZWRlbnRpYWxzJzogJ3RydWUnLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyB0b2tlbjogbG9naW5EYXRhLnRva2VuLCBoYXNoOiBudWxsLCBpbm5lckxvZ2luVHlwZTogMCB9KSxcbiAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJlcXVlc3QuY29udGludWUoKTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgICAgZGVidWcoYHZpc2FDYWw6IGRpcmVjdCBBUEkgbG9naW4gZXJyb3I6ICR7KGVyciBhcyBFcnJvcikubWVzc2FnZX1gKTtcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICB9O1xuICB9XG5cbiAgYXN5bmMgZmV0Y2hEYXRhKCk6IFByb21pc2U8U2NyYXBlclNjcmFwaW5nUmVzdWx0PiB7XG4gICAgY29uc3QgZGVmYXVsdFN0YXJ0TW9tZW50ID0gbW9tZW50KCkuc3VidHJhY3QoMSwgJ3llYXJzJykuc3VidHJhY3QoNiwgJ21vbnRocycpLmFkZCgxLCAnZGF5Jyk7XG4gICAgY29uc3Qgc3RhcnREYXRlID0gdGhpcy5vcHRpb25zLnN0YXJ0RGF0ZSB8fCBkZWZhdWx0U3RhcnRNb21lbnQudG9EYXRlKCk7XG4gICAgY29uc3Qgc3RhcnRNb21lbnQgPSBtb21lbnQubWF4KGRlZmF1bHRTdGFydE1vbWVudCwgbW9tZW50KHN0YXJ0RGF0ZSkpO1xuICAgIGRlYnVnKGBmZXRjaCB0cmFuc2FjdGlvbnMgc3RhcnRpbmcgJHtzdGFydE1vbWVudC5mb3JtYXQoKX1gKTtcblxuICAgIGNvbnN0IFtjYXJkcywgeFNpdGVJZCwgQXV0aG9yaXphdGlvbl0gPSBhd2FpdCBQcm9taXNlLmFsbChbXG4gICAgICB0aGlzLmdldENhcmRzKCksXG4gICAgICB0aGlzLmdldFhTaXRlSWQoKSxcbiAgICAgIHRoaXMuZ2V0QXV0aG9yaXphdGlvbkhlYWRlcigpLFxuICAgIF0pO1xuXG4gICAgY29uc3QgZnV0dXJlTW9udGhzVG9TY3JhcGUgPSB0aGlzLm9wdGlvbnMuZnV0dXJlTW9udGhzVG9TY3JhcGUgPz8gMTtcblxuICAgIGRlYnVnKCdmZXRjaCBmcmFtZXMgKG1pc2dhcm90KSBvZiBjYXJkcycpO1xuICAgIGNvbnN0IGZyYW1lcyA9IGF3YWl0IGZldGNoUG9zdDxGcmFtZXNSZXNwb25zZT4oXG4gICAgICBGUkFNRVNfUkVRVUVTVF9FTkRQT0lOVCxcbiAgICAgIHsgY2FyZHNGb3JGcmFtZURhdGE6IGNhcmRzLm1hcCgoeyBjYXJkVW5pcXVlSWQgfSkgPT4gKHsgY2FyZFVuaXF1ZUlkIH0pKSB9LFxuICAgICAge1xuICAgICAgICBBdXRob3JpemF0aW9uLFxuICAgICAgICAnWC1TaXRlLUlkJzogeFNpdGVJZCxcbiAgICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgICAgLi4uYXBpSGVhZGVycyxcbiAgICAgIH0sXG4gICAgKTtcblxuICAgIGNvbnN0IGFjY291bnRzID0gYXdhaXQgUHJvbWlzZS5hbGwoXG4gICAgICBjYXJkcy5tYXAoYXN5bmMgY2FyZCA9PiB7XG4gICAgICAgIGNvbnN0IGZpbmFsTW9udGhUb0ZldGNoTW9tZW50ID0gbW9tZW50KCkuYWRkKGZ1dHVyZU1vbnRoc1RvU2NyYXBlLCAnbW9udGgnKTtcbiAgICAgICAgY29uc3QgbW9udGhzID0gZmluYWxNb250aFRvRmV0Y2hNb21lbnQuZGlmZihzdGFydE1vbWVudCwgJ21vbnRocycpO1xuICAgICAgICBjb25zdCBhbGxNb250aHNEYXRhOiBDYXJkVHJhbnNhY3Rpb25EZXRhaWxzW10gPSBbXTtcbiAgICAgICAgY29uc3QgZnJhbWUgPSBmcmFtZXMucmVzdWx0Py5iYW5rSXNzdWVkQ2FyZHM/LmNhcmRMZXZlbEZyYW1lcz8uZmluZChcbiAgICAgICAgICAoZjogQ2FyZExldmVsRnJhbWUpID0+IGYuY2FyZFVuaXF1ZUlkID09PSBjYXJkLmNhcmRVbmlxdWVJZCxcbiAgICAgICAgKTtcblxuICAgICAgICBkZWJ1ZyhgZmV0Y2ggcGVuZGluZyB0cmFuc2FjdGlvbnMgZm9yIGNhcmQgJHtjYXJkLmNhcmRVbmlxdWVJZH1gKTtcbiAgICAgICAgbGV0IHBlbmRpbmdEYXRhID0gYXdhaXQgZmV0Y2hQb3N0KFxuICAgICAgICAgIFBFTkRJTkdfVFJBTlNBQ1RJT05TX1JFUVVFU1RfRU5EUE9JTlQsXG4gICAgICAgICAgeyBjYXJkVW5pcXVlSURBcnJheTogW2NhcmQuY2FyZFVuaXF1ZUlkXSB9LFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIEF1dGhvcml6YXRpb24sXG4gICAgICAgICAgICAnWC1TaXRlLUlkJzogeFNpdGVJZCxcbiAgICAgICAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICAgICAgICAuLi5hcGlIZWFkZXJzLFxuICAgICAgICAgIH0sXG4gICAgICAgICk7XG5cbiAgICAgICAgZGVidWcoYGZldGNoIGNvbXBsZXRlZCB0cmFuc2FjdGlvbnMgZm9yIGNhcmQgJHtjYXJkLmNhcmRVbmlxdWVJZH1gKTtcbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPD0gbW9udGhzOyBpKyspIHtcbiAgICAgICAgICBjb25zdCBtb250aCA9IGZpbmFsTW9udGhUb0ZldGNoTW9tZW50LmNsb25lKCkuc3VidHJhY3QoaSwgJ21vbnRocycpO1xuICAgICAgICAgIGNvbnN0IG1vbnRoRGF0YSA9IGF3YWl0IGZldGNoUG9zdChcbiAgICAgICAgICAgIFRSQU5TQUNUSU9OU19SRVFVRVNUX0VORFBPSU5ULFxuICAgICAgICAgICAgeyBjYXJkVW5pcXVlSWQ6IGNhcmQuY2FyZFVuaXF1ZUlkLCBtb250aDogbW9udGguZm9ybWF0KCdNJyksIHllYXI6IG1vbnRoLmZvcm1hdCgnWVlZWScpIH0sXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIEF1dGhvcml6YXRpb24sXG4gICAgICAgICAgICAgICdYLVNpdGUtSWQnOiB4U2l0ZUlkLFxuICAgICAgICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgICAgICAgICAuLi5hcGlIZWFkZXJzLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICApO1xuXG4gICAgICAgICAgaWYgKG1vbnRoRGF0YT8uc3RhdHVzQ29kZSAhPT0gMSlcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgICAgICAgYGZhaWxlZCB0byBmZXRjaCB0cmFuc2FjdGlvbnMgZm9yIGNhcmQgJHtjYXJkLmxhc3Q0RGlnaXRzfS4gTWVzc2FnZTogJHttb250aERhdGE/LnRpdGxlIHx8ICcnfWAsXG4gICAgICAgICAgICApO1xuXG4gICAgICAgICAgaWYgKCFpc0NhcmRUcmFuc2FjdGlvbkRldGFpbHMobW9udGhEYXRhKSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdtb250aERhdGEgaXMgbm90IG9mIHR5cGUgQ2FyZFRyYW5zYWN0aW9uRGV0YWlscycpO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGFsbE1vbnRoc0RhdGEucHVzaChtb250aERhdGEpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHBlbmRpbmdEYXRhPy5zdGF0dXNDb2RlICE9PSAxICYmIHBlbmRpbmdEYXRhPy5zdGF0dXNDb2RlICE9PSA5Nikge1xuICAgICAgICAgIGRlYnVnKFxuICAgICAgICAgICAgYGZhaWxlZCB0byBmZXRjaCBwZW5kaW5nIHRyYW5zYWN0aW9ucyBmb3IgY2FyZCAke2NhcmQubGFzdDREaWdpdHN9LiBNZXNzYWdlOiAke3BlbmRpbmdEYXRhPy50aXRsZSB8fCAnJ31gLFxuICAgICAgICAgICk7XG4gICAgICAgICAgcGVuZGluZ0RhdGEgPSBudWxsO1xuICAgICAgICB9IGVsc2UgaWYgKCFpc0NhcmRQZW5kaW5nVHJhbnNhY3Rpb25EZXRhaWxzKHBlbmRpbmdEYXRhKSkge1xuICAgICAgICAgIGRlYnVnKCdwZW5kaW5nRGF0YSBpcyBub3Qgb2YgdHlwZSBDYXJkVHJhbnNhY3Rpb25EZXRhaWxzJyk7XG4gICAgICAgICAgcGVuZGluZ0RhdGEgPSBudWxsO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgdHJhbnNhY3Rpb25zID0gY29udmVydFBhcnNlZERhdGFUb1RyYW5zYWN0aW9ucyhhbGxNb250aHNEYXRhLCBwZW5kaW5nRGF0YSwgdGhpcy5vcHRpb25zKTtcblxuICAgICAgICBkZWJ1ZygnZmlsdGVyIG91dCBvbGQgdHJhbnNhY3Rpb25zJyk7XG4gICAgICAgIGNvbnN0IHR4bnMgPVxuICAgICAgICAgICh0aGlzLm9wdGlvbnMub3V0cHV0RGF0YT8uZW5hYmxlVHJhbnNhY3Rpb25zRmlsdGVyQnlEYXRlID8/IHRydWUpXG4gICAgICAgICAgICA/IGZpbHRlck9sZFRyYW5zYWN0aW9ucyh0cmFuc2FjdGlvbnMsIG1vbWVudChzdGFydERhdGUpLCB0aGlzLm9wdGlvbnMuY29tYmluZUluc3RhbGxtZW50cyB8fCBmYWxzZSlcbiAgICAgICAgICAgIDogdHJhbnNhY3Rpb25zO1xuXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgdHhucyxcbiAgICAgICAgICBiYWxhbmNlOiBmcmFtZT8ubmV4dFRvdGFsRGViaXQgIT0gbnVsbCA/IC1mcmFtZS5uZXh0VG90YWxEZWJpdCA6IHVuZGVmaW5lZCxcbiAgICAgICAgICBhY2NvdW50TnVtYmVyOiBjYXJkLmxhc3Q0RGlnaXRzLFxuICAgICAgICB9IGFzIFRyYW5zYWN0aW9uc0FjY291bnQ7XG4gICAgICB9KSxcbiAgICApO1xuXG4gICAgZGVidWcoJ3JldHVybiB0aGUgc2NyYXBlZCBhY2NvdW50cycpO1xuXG4gICAgZGVidWcoSlNPTi5zdHJpbmdpZnkoYWNjb3VudHMsIG51bGwsIDIpKTtcbiAgICByZXR1cm4ge1xuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIGFjY291bnRzLFxuICAgIH07XG4gIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgVmlzYUNhbFNjcmFwZXI7XG4iXSwibWFwcGluZ3MiOiI7Ozs7OztBQUFBLElBQUFBLE9BQUEsR0FBQUMsc0JBQUEsQ0FBQUMsT0FBQTtBQUVBLElBQUFDLE1BQUEsR0FBQUQsT0FBQTtBQUNBLElBQUFFLHFCQUFBLEdBQUFGLE9BQUE7QUFDQSxJQUFBRyxNQUFBLEdBQUFILE9BQUE7QUFDQSxJQUFBSSxXQUFBLEdBQUFKLE9BQUE7QUFDQSxJQUFBSyxRQUFBLEdBQUFMLE9BQUE7QUFDQSxJQUFBTSxhQUFBLEdBQUFOLE9BQUE7QUFDQSxJQUFBTyxRQUFBLEdBQUFQLE9BQUE7QUFDQSxJQUFBUSxjQUFBLEdBQUFSLE9BQUE7QUFDQSxJQUFBUyx1QkFBQSxHQUFBVCxPQUFBO0FBQXNHLFNBQUFELHVCQUFBVyxDQUFBLFdBQUFBLENBQUEsSUFBQUEsQ0FBQSxDQUFBQyxVQUFBLEdBQUFELENBQUEsS0FBQUUsT0FBQSxFQUFBRixDQUFBO0FBR3RHLE1BQU1HLFVBQVUsR0FBRztFQUNqQixZQUFZLEVBQ1YsdUhBQXVIO0VBQ3pIQyxNQUFNLEVBQUUsc0NBQXNDO0VBQzlDQyxPQUFPLEVBQUUsc0NBQXNDO0VBQy9DLGlCQUFpQixFQUFFLHFDQUFxQztFQUN4RCxnQkFBZ0IsRUFBRSxXQUFXO0VBQzdCLGdCQUFnQixFQUFFLE1BQU07RUFDeEIsZ0JBQWdCLEVBQUU7QUFDcEIsQ0FBQztBQUNELE1BQU1DLFNBQVMsR0FBRywrQkFBK0I7QUFDakQsTUFBTUMsNkJBQTZCLEdBQ2pDLDhGQUE4RjtBQUNoRyxNQUFNQyx1QkFBdUIsR0FBRywrREFBK0Q7QUFDL0YsTUFBTUMscUNBQXFDLEdBQ3pDLDhFQUE4RTtBQUNoRixNQUFNQyxrQ0FBa0MsR0FBRyx5RUFBeUU7QUFFcEgsTUFBTUMsc0JBQXNCLEdBQUcsbUNBQW1DO0FBQ2xFLE1BQU1DLHFCQUFxQixHQUFHLGNBQWM7QUFFNUMsTUFBTUMsS0FBSyxHQUFHLElBQUFDLGVBQVEsRUFBQyxVQUFVLENBQUM7QUFBQyxJQUU5QkMsV0FBVywwQkFBWEEsV0FBVztFQUFYQSxXQUFXO0VBQVhBLFdBQVc7RUFBWEEsV0FBVztFQUFYQSxXQUFXO0VBQUEsT0FBWEEsV0FBVztBQUFBLEVBQVhBLFdBQVc7QUFpSmhCLFNBQVNDLFlBQVlBLENBQUNDLE1BQVcsRUFBd0I7RUFDdkQsT0FBT0MsT0FBTyxDQUFDRCxNQUFNLEVBQUVFLElBQUksRUFBRUMsZUFBZSxJQUFJQyxNQUFNLENBQUNKLE1BQU0sQ0FBQ0UsSUFBSSxDQUFDQyxlQUFlLENBQUMsQ0FBQ0UsSUFBSSxDQUFDLENBQUMsQ0FBQztBQUM3RjtBQUVBLFNBQVNDLHFCQUFxQkEsQ0FBQ04sTUFBVyxFQUEwQjtFQUNsRSxPQUFPRCxZQUFZLENBQUNDLE1BQU0sQ0FBQyxHQUFHQSxNQUFNLEdBQUdPLFNBQVM7QUFDbEQ7QUFFQSxTQUFTQyxTQUFTQSxDQUNoQkMsV0FBMkQsRUFDakI7RUFDMUMsT0FBUUEsV0FBVyxDQUF3QkMsVUFBVSxLQUFLSCxTQUFTLENBQUMsQ0FBQztBQUN2RTtBQUVBLFNBQVNJLHdCQUF3QkEsQ0FDL0JYLE1BQTRELEVBQzFCO0VBQ2xDLE9BQVFBLE1BQU0sQ0FBNEJBLE1BQU0sS0FBS08sU0FBUztBQUNoRTtBQUVBLFNBQVNLLCtCQUErQkEsQ0FDdENaLE1BQW1FLEVBQzFCO0VBQ3pDLE9BQVFBLE1BQU0sQ0FBbUNBLE1BQU0sS0FBS08sU0FBUztBQUN2RTtBQUVBLGVBQWVNLGFBQWFBLENBQUNDLElBQVUsRUFBRTtFQUN2QyxJQUFJQyxLQUFtQixHQUFHLElBQUk7RUFDOUJuQixLQUFLLENBQUMsOEJBQThCLENBQUM7RUFDckMsTUFBTSxJQUFBb0Isa0JBQVMsRUFDYixNQUFNO0lBQ0pELEtBQUssR0FBR0QsSUFBSSxDQUFDRyxNQUFNLENBQUMsQ0FBQyxDQUFDQyxJQUFJLENBQUNDLENBQUMsSUFBSUEsQ0FBQyxDQUFDQyxHQUFHLENBQUMsQ0FBQyxDQUFDQyxRQUFRLENBQUMsU0FBUyxDQUFDLENBQUMsSUFBSSxJQUFJO0lBQ3BFLE9BQU9DLE9BQU8sQ0FBQ0MsT0FBTyxDQUFDLENBQUMsQ0FBQ1IsS0FBSyxDQUFDO0VBQ2pDLENBQUMsRUFDRCxpQ0FBaUMsRUFDakMsS0FBSyxFQUNMLElBQ0YsQ0FBQztFQUVELElBQUksQ0FBQ0EsS0FBSyxFQUFFO0lBQ1ZuQixLQUFLLENBQUMsMkNBQTJDLENBQUM7SUFDbEQsTUFBTSxJQUFJNEIsS0FBSyxDQUFDLGdDQUFnQyxDQUFDO0VBQ25EO0VBRUEsT0FBT1QsS0FBSztBQUNkO0FBRUEsZUFBZVUsdUJBQXVCQSxDQUFDWCxJQUFVLEVBQUU7RUFDakQsTUFBTUMsS0FBSyxHQUFHLE1BQU1GLGFBQWEsQ0FBQ0MsSUFBSSxDQUFDO0VBQ3ZDLE1BQU1ZLFVBQVUsR0FBRyxNQUFNLElBQUFDLDBDQUFvQixFQUFDWixLQUFLLEVBQUUseUJBQXlCLENBQUM7RUFDL0UsTUFBTWEsWUFBWSxHQUFHRixVQUFVLEdBQzNCLE1BQU0sSUFBQUcsOEJBQVEsRUFBQ2QsS0FBSyxFQUFFLHlCQUF5QixFQUFFLEVBQUUsRUFBRWUsSUFBSSxJQUFJO0lBQzNELE9BQVFBLElBQUksQ0FBb0JDLFNBQVM7RUFDM0MsQ0FBQyxDQUFDLEdBQ0YsRUFBRTtFQUNOLE9BQU9ILFlBQVksS0FBS2xDLHNCQUFzQjtBQUNoRDtBQUVBLGVBQWVzQyxxQkFBcUJBLENBQUNsQixJQUFVLEVBQUU7RUFDL0MsTUFBTUMsS0FBSyxHQUFHLE1BQU1GLGFBQWEsQ0FBQ0MsSUFBSSxDQUFDO0VBQ3ZDO0VBQ0EsTUFBTVksVUFBVSxHQUFHLE1BQU0sSUFBQUMsMENBQW9CLEVBQUNaLEtBQUssRUFBRSxXQUFXLENBQUM7RUFDakUsSUFBSVcsVUFBVSxFQUFFO0lBQ2QsTUFBTU8sT0FBTyxHQUFHLE1BQU0sSUFBQUosOEJBQVEsRUFBQ2QsS0FBSyxFQUFFLFdBQVcsRUFBRSxFQUFFLEVBQUVlLElBQUksSUFBSTtNQUM3RCxPQUFRQSxJQUFJLENBQWlCQyxTQUFTLENBQUMxQixJQUFJLENBQUMsQ0FBQztJQUMvQyxDQUFDLENBQUM7SUFDRixPQUFPNEIsT0FBTyxDQUFDWixRQUFRLENBQUMxQixxQkFBcUIsQ0FBQztFQUNoRDtFQUNBLE9BQU8sS0FBSztBQUNkO0FBRUEsU0FBU3VDLHVCQUF1QkEsQ0FBQSxFQUFHO0VBQ2pDdEMsS0FBSyxDQUFDLCtCQUErQixDQUFDO0VBQ3RDLE1BQU11QyxJQUFxQyxHQUFHO0lBQzVDLENBQUNDLG9DQUFZLENBQUNDLE9BQU8sR0FBRyxDQUFDLFlBQVksQ0FBQztJQUN0QyxDQUFDRCxvQ0FBWSxDQUFDRSxlQUFlLEdBQUcsQ0FDOUIsTUFBT0MsT0FBeUIsSUFBSztNQUNuQyxNQUFNekIsSUFBSSxHQUFHeUIsT0FBTyxFQUFFekIsSUFBSTtNQUMxQixJQUFJLENBQUNBLElBQUksRUFBRTtRQUNULE9BQU8sS0FBSztNQUNkO01BQ0EsT0FBT1csdUJBQXVCLENBQUNYLElBQUksQ0FBQztJQUN0QyxDQUFDLENBQ0Y7SUFDRDtJQUNBLENBQUNzQixvQ0FBWSxDQUFDSSxjQUFjLEdBQUcsQ0FDN0IsTUFBT0QsT0FBeUIsSUFBSztNQUNuQyxNQUFNekIsSUFBSSxHQUFHeUIsT0FBTyxFQUFFekIsSUFBSTtNQUMxQixJQUFJLENBQUNBLElBQUksRUFBRTtRQUNULE9BQU8sS0FBSztNQUNkO01BQ0EsT0FBT2tCLHFCQUFxQixDQUFDbEIsSUFBSSxDQUFDO0lBQ3BDLENBQUM7RUFFTCxDQUFDO0VBQ0QsT0FBT3FCLElBQUk7QUFDYjtBQUVBLFNBQVNNLGlCQUFpQkEsQ0FBQ0MsV0FBdUMsRUFBRTtFQUNsRTlDLEtBQUssQ0FBQywrQ0FBK0MsQ0FBQztFQUN0RCxPQUFPLENBQ0w7SUFBRStDLFFBQVEsRUFBRSw4QkFBOEI7SUFBRUMsS0FBSyxFQUFFRixXQUFXLENBQUNHO0VBQVMsQ0FBQyxFQUN6RTtJQUFFRixRQUFRLEVBQUUsOEJBQThCO0lBQUVDLEtBQUssRUFBRUYsV0FBVyxDQUFDSTtFQUFTLENBQUMsQ0FDMUU7QUFDSDtBQUVBLFNBQVNDLCtCQUErQkEsQ0FDdENDLElBQThCLEVBQzlCQyxXQUFrRCxFQUNsRFYsT0FBd0IsRUFDVDtFQUNmLE1BQU1XLG1CQUFtQixHQUFHRCxXQUFXLEVBQUVqRCxNQUFNLEdBQzNDaUQsV0FBVyxDQUFDakQsTUFBTSxDQUFDbUQsU0FBUyxDQUFDQyxPQUFPLENBQUNDLElBQUksSUFBSUEsSUFBSSxDQUFDQyxlQUFlLENBQUMsR0FDbEUsRUFBRTtFQUVOLE1BQU1DLFlBQVksR0FBR1AsSUFBSSxDQUFDSSxPQUFPLENBQUNJLFNBQVMsSUFBSUEsU0FBUyxDQUFDeEQsTUFBTSxDQUFDdUQsWUFBWSxDQUFDO0VBQzdFLE1BQU1FLGdCQUFnQixHQUFHRixZQUFZLENBQUNILE9BQU8sQ0FBQ00sUUFBUSxJQUFJQSxRQUFRLENBQUNDLFVBQVUsQ0FBQztFQUM5RSxNQUFNQyxrQkFBa0IsR0FBR0wsWUFBWSxDQUFDSCxPQUFPLENBQUNNLFFBQVEsSUFBSUEsUUFBUSxDQUFDRyxlQUFlLENBQUNDLFNBQVMsQ0FBQztFQUMvRixNQUFNQyxxQkFBcUIsR0FBRyxDQUFDLEdBQUdOLGdCQUFnQixFQUFFLEdBQUdHLGtCQUFrQixDQUFDLENBQUNSLE9BQU8sQ0FDaEZZLFNBQVMsSUFBSUEsU0FBUyxDQUFDQyxZQUN6QixDQUFDO0VBRUQsTUFBTUMsR0FBdUQsR0FBRyxDQUFDLEdBQUdoQixtQkFBbUIsRUFBRSxHQUFHYSxxQkFBcUIsQ0FBQztFQUVsSCxPQUFPRyxHQUFHLENBQUNDLEdBQUcsQ0FBQzFELFdBQVcsSUFBSTtJQUM1QixNQUFNMkQsYUFBYSxHQUFHNUQsU0FBUyxDQUFDQyxXQUFXLENBQUMsR0FBR0EsV0FBVyxDQUFDNEQsZ0JBQWdCLEdBQUc1RCxXQUFXLENBQUMyRCxhQUFhO0lBQ3ZHLE1BQU1FLFlBQVksR0FBR0YsYUFBYSxHQUM5QjtNQUNFRyxNQUFNLEVBQUUvRCxTQUFTLENBQUNDLFdBQVcsQ0FBQyxHQUFHLENBQUMsR0FBR0EsV0FBVyxDQUFDK0QsYUFBYTtNQUM5REMsS0FBSyxFQUFFTDtJQUNULENBQUMsR0FDRDdELFNBQVM7SUFFYixNQUFNbUUsSUFBSSxHQUFHLElBQUFDLGVBQU0sRUFBQ2xFLFdBQVcsQ0FBQ21FLGVBQWUsQ0FBQztJQUVoRCxNQUFNQyxhQUFhLEdBQUcsQ0FBQ3JFLFNBQVMsQ0FBQ0MsV0FBVyxDQUFDLEdBQUdBLFdBQVcsQ0FBQ3FFLE1BQU0sR0FBR3JFLFdBQVcsQ0FBQ3NFLHFCQUFxQixJQUFJLENBQUMsQ0FBQztJQUM1RyxNQUFNQyxjQUFjLEdBQUd2RSxXQUFXLENBQUNxRSxNQUFNLElBQUlyRSxXQUFXLENBQUN3RSxXQUFXLEtBQUtuRixXQUFXLENBQUNvRixNQUFNLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDO0lBRXJHLE1BQU1sRixNQUFtQixHQUFHO01BQzFCbUYsVUFBVSxFQUFFLENBQUMzRSxTQUFTLENBQUNDLFdBQVcsQ0FBQyxHQUFHQSxXQUFXLENBQUMyRSxRQUFRLEdBQUc3RSxTQUFTO01BQ3RFOEUsSUFBSSxFQUFFLENBQUN2RixXQUFXLENBQUN3RixPQUFPLEVBQUV4RixXQUFXLENBQUN5RixhQUFhLENBQUMsQ0FBQ2xFLFFBQVEsQ0FBQ1osV0FBVyxDQUFDd0UsV0FBVyxDQUFDLEdBQ3BGTywrQkFBZ0IsQ0FBQ0MsTUFBTSxHQUN2QkQsK0JBQWdCLENBQUNFLFlBQVk7TUFDakNDLE1BQU0sRUFBRW5GLFNBQVMsQ0FBQ0MsV0FBVyxDQUFDLEdBQUdtRixrQ0FBbUIsQ0FBQ0MsT0FBTyxHQUFHRCxrQ0FBbUIsQ0FBQ0UsU0FBUztNQUM1RnBCLElBQUksRUFBRUosWUFBWSxHQUFHSSxJQUFJLENBQUNxQixHQUFHLENBQUN6QixZQUFZLENBQUNDLE1BQU0sR0FBRyxDQUFDLEVBQUUsT0FBTyxDQUFDLENBQUN5QixXQUFXLENBQUMsQ0FBQyxHQUFHdEIsSUFBSSxDQUFDc0IsV0FBVyxDQUFDLENBQUM7TUFDbEdDLGFBQWEsRUFBRXpGLFNBQVMsQ0FBQ0MsV0FBVyxDQUFDLEdBQUdpRSxJQUFJLENBQUNzQixXQUFXLENBQUMsQ0FBQyxHQUFHLElBQUlFLElBQUksQ0FBQ3pGLFdBQVcsQ0FBQ0MsVUFBVSxDQUFDLENBQUNzRixXQUFXLENBQUMsQ0FBQztNQUMzR2hCLGNBQWM7TUFDZG1CLGdCQUFnQixFQUFFMUYsV0FBVyxDQUFDMkYsaUJBQWlCO01BQy9DdkIsYUFBYTtNQUNid0IsZUFBZSxFQUFFLENBQUM3RixTQUFTLENBQUNDLFdBQVcsQ0FBQyxHQUFHQSxXQUFXLENBQUM2RixvQkFBb0IsR0FBRy9GLFNBQVM7TUFDdkZnRyxXQUFXLEVBQUU5RixXQUFXLENBQUMrRixZQUFZO01BQ3JDQyxJQUFJLEVBQUVoRyxXQUFXLENBQUNpRyx1QkFBdUIsQ0FBQ0MsUUFBUSxDQUFDLENBQUM7TUFDcERDLFFBQVEsRUFBRW5HLFdBQVcsQ0FBQ29HO0lBQ3hCLENBQUM7SUFFRCxJQUFJdkMsWUFBWSxFQUFFO01BQ2hCdEUsTUFBTSxDQUFDc0UsWUFBWSxHQUFHQSxZQUFZO0lBQ3BDO0lBRUEsSUFBSS9CLE9BQU8sRUFBRXVFLHFCQUFxQixFQUFFO01BQ2xDOUcsTUFBTSxDQUFDK0csY0FBYyxHQUFHLElBQUFDLCtCQUFpQixFQUFDdkcsV0FBVyxDQUFDO0lBQ3hEO0lBRUEsT0FBT1QsTUFBTTtFQUNmLENBQUMsQ0FBQztBQUNKO0FBSUEsTUFBTWlILGNBQWMsU0FBU0MsOENBQXNCLENBQTZCO0VBQ3RFQyxhQUFhLEdBQXVCNUcsU0FBUztFQUlyRDZHLGNBQWMsR0FBRyxNQUFBQSxDQUFBLEtBQVk7SUFDM0J4SCxLQUFLLENBQUMscURBQXFELENBQUM7SUFDNUQsTUFBTSxJQUFBeUgsMkNBQXFCLEVBQUMsSUFBSSxDQUFDdkcsSUFBSSxFQUFFLG9CQUFvQixFQUFFLElBQUksQ0FBQztJQUNsRWxCLEtBQUssQ0FBQywyQkFBMkIsQ0FBQztJQUNsQyxNQUFNLElBQUEwSCxpQ0FBVyxFQUFDLElBQUksQ0FBQ3hHLElBQUksRUFBRSxvQkFBb0IsQ0FBQztJQUNsRGxCLEtBQUssQ0FBQyxvQ0FBb0MsQ0FBQztJQUMzQyxNQUFNbUIsS0FBSyxHQUFHLE1BQU1GLGFBQWEsQ0FBQyxJQUFJLENBQUNDLElBQUksQ0FBQztJQUM1Q2xCLEtBQUssQ0FBQyx1REFBdUQsQ0FBQztJQUM5RCxNQUFNLElBQUF5SCwyQ0FBcUIsRUFBQ3RHLEtBQUssRUFBRSxnQkFBZ0IsQ0FBQztJQUNwRG5CLEtBQUssQ0FBQyxvQ0FBb0MsQ0FBQztJQUMzQyxNQUFNLElBQUEwSCxpQ0FBVyxFQUFDdkcsS0FBSyxFQUFFLGdCQUFnQixDQUFDO0lBQzFDbkIsS0FBSyxDQUFDLDZDQUE2QyxDQUFDO0lBQ3BELE1BQU0sSUFBQXlILDJDQUFxQixFQUFDdEcsS0FBSyxFQUFFLGVBQWUsQ0FBQztJQUVuRCxPQUFPQSxLQUFLO0VBQ2QsQ0FBQztFQUVELE1BQU13RyxRQUFRQSxDQUFBLEVBQUc7SUFDZixNQUFNQyxRQUFRLEdBQUcsTUFBTSxJQUFBeEcsa0JBQVMsRUFDOUIsTUFBTSxJQUFBeUcsOEJBQXFCLEVBQWUsSUFBSSxDQUFDM0csSUFBSSxFQUFFLE1BQU0sQ0FBQyxFQUM1RCxrQ0FBa0MsRUFDbEMsS0FBSyxFQUNMLElBQ0YsQ0FBQztJQUNELElBQUksQ0FBQzBHLFFBQVEsRUFBRTtNQUNiLE1BQU0sSUFBSWhHLEtBQUssQ0FBQywrQ0FBK0MsQ0FBQztJQUNsRTtJQUNBLE9BQU9nRyxRQUFRLEVBQUV4SCxNQUFNLENBQUMwSCxLQUFLLENBQUN2RCxHQUFHLENBQUMsQ0FBQztNQUFFd0QsWUFBWTtNQUFFQztJQUFZLENBQUMsTUFBTTtNQUFFRCxZQUFZO01BQUVDO0lBQVksQ0FBQyxDQUFDLENBQUM7RUFDdkc7RUFFQSxNQUFNQyxzQkFBc0JBLENBQUEsRUFBRztJQUM3QixJQUFJLENBQUMsSUFBSSxDQUFDVixhQUFhLEVBQUU7TUFDdkJ2SCxLQUFLLENBQUMsK0JBQStCLENBQUM7TUFDdEMsTUFBTWtJLFVBQVUsR0FBRyxNQUFNLElBQUE5RyxrQkFBUyxFQUNoQyxZQUFZVixxQkFBcUIsQ0FBQyxNQUFNLElBQUFtSCw4QkFBcUIsRUFBYSxJQUFJLENBQUMzRyxJQUFJLEVBQUUsYUFBYSxDQUFDLENBQUMsRUFDcEcsOERBQThELEVBQzlELE1BQU0sRUFDTixFQUNGLENBQUM7TUFDRCxPQUFPLGlCQUFpQmdILFVBQVUsQ0FBQzVILElBQUksQ0FBQ0MsZUFBZSxFQUFFO0lBQzNEO0lBQ0EsT0FBTyxJQUFJLENBQUNnSCxhQUFhO0VBQzNCO0VBRUEsTUFBTVksVUFBVUEsQ0FBQSxFQUFHO0lBQ2pCO0FBQ0o7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtJQUdJLE9BQU96RyxPQUFPLENBQUNDLE9BQU8sQ0FBQyxzQ0FBc0MsQ0FBQztFQUNoRTtFQUVBeUcsZUFBZUEsQ0FBQ3RGLFdBQXVDLEVBQWdCO0lBQ3JFLElBQUksQ0FBQ3VGLGtCQUFrQixHQUFHLElBQUksQ0FBQ25ILElBQUksQ0FDaENvSCxjQUFjLENBQUN6SSxrQ0FBa0MsRUFBRTtNQUFFMEksT0FBTyxFQUFFO0lBQU8sQ0FBQyxDQUFDLENBQ3ZFQyxLQUFLLENBQUNySixDQUFDLElBQUk7TUFDVmEsS0FBSyxDQUFDLDJDQUEyQyxFQUFFYixDQUFDLENBQUM7TUFDckQsT0FBT3dCLFNBQVM7SUFDbEIsQ0FBQyxDQUFDO0lBQ0osT0FBTztNQUNMOEgsUUFBUSxFQUFFLEdBQUdoSixTQUFTLEVBQUU7TUFDeEJpSixNQUFNLEVBQUU3RixpQkFBaUIsQ0FBQ0MsV0FBVyxDQUFDO01BQ3RDNkYsb0JBQW9CLEVBQUUsdUJBQXVCO01BQzdDQyxlQUFlLEVBQUV0Ryx1QkFBdUIsQ0FBQyxDQUFDO01BQzFDdUcsY0FBYyxFQUFFLE1BQUFBLENBQUEsS0FBWSxJQUFBcEIsMkNBQXFCLEVBQUMsSUFBSSxDQUFDdkcsSUFBSSxFQUFFLG9CQUFvQixDQUFDO01BQ2xGNEgsU0FBUyxFQUFFLElBQUksQ0FBQ3RCLGNBQWM7TUFDOUJ1QixVQUFVLEVBQUUsTUFBQUEsQ0FBQSxLQUFZO1FBQ3RCLElBQUk7VUFDRixNQUFNLElBQUFDLDZCQUFpQixFQUFDLElBQUksQ0FBQzlILElBQUksQ0FBQztVQUNsQyxNQUFNK0gsVUFBVSxHQUFHLE1BQU0sSUFBQUMseUJBQWEsRUFBQyxJQUFJLENBQUNoSSxJQUFJLENBQUM7VUFDakQsSUFBSStILFVBQVUsQ0FBQ0UsUUFBUSxDQUFDLGVBQWUsQ0FBQyxFQUFFO1lBQ3hDLE1BQU0sSUFBQXpCLGlDQUFXLEVBQUMsSUFBSSxDQUFDeEcsSUFBSSxFQUFFLGtCQUFrQixDQUFDO1VBQ2xEO1VBQ0EsTUFBTWtJLE9BQU8sR0FBRyxNQUFNLElBQUksQ0FBQ2Ysa0JBQWtCO1VBQzdDLElBQUksQ0FBQ2QsYUFBYSxHQUFHL0csTUFBTSxDQUFDNEksT0FBTyxFQUFFQyxPQUFPLENBQUMsQ0FBQyxDQUFDOUIsYUFBYSxJQUFJLEVBQUUsQ0FBQyxDQUFDOUcsSUFBSSxDQUFDLENBQUM7UUFDNUUsQ0FBQyxDQUFDLE9BQU90QixDQUFDLEVBQUU7VUFDVixNQUFNOEosVUFBVSxHQUFHLE1BQU0sSUFBQUMseUJBQWEsRUFBQyxJQUFJLENBQUNoSSxJQUFJLENBQUM7VUFDakQsSUFBSStILFVBQVUsQ0FBQ0UsUUFBUSxDQUFDLFdBQVcsQ0FBQyxFQUFFO1VBQ3RDLE1BQU1HLHNCQUFzQixHQUFHLE1BQU1sSCxxQkFBcUIsQ0FBQyxJQUFJLENBQUNsQixJQUFJLENBQUM7VUFDckUsSUFBSW9JLHNCQUFzQixFQUFFO1VBQzVCLE1BQU1uSyxDQUFDO1FBQ1Q7TUFDRixDQUFDO01BQ0RvSyxTQUFTLEVBQUVqSyxVQUFVLENBQUMsWUFBWSxDQUFDO01BQ25Da0ssV0FBVyxFQUFFLE1BQUFBLENBQUEsS0FBWTtRQUN2QjtRQUNBO1FBQ0E7UUFDQTtRQUNBeEosS0FBSyxDQUFDLGtFQUFrRSxDQUFDO1FBQ3pFLElBQUk7VUFDRixNQUFNeUosYUFBYSxHQUFHLE1BQU1DLEtBQUssQ0FDL0IsMkVBQTJFLEVBQzNFO1lBQ0VDLE1BQU0sRUFBRSxNQUFNO1lBQ2ROLE9BQU8sRUFBRTtjQUNQTyxNQUFNLEVBQUUsbUNBQW1DO2NBQzNDLGNBQWMsRUFBRSxrQkFBa0I7Y0FDbENDLE1BQU0sRUFBRSxzQ0FBc0M7Y0FDOUNDLE9BQU8sRUFBRSx1Q0FBdUM7Y0FDaEQsV0FBVyxFQUFFO1lBQ2YsQ0FBQztZQUNEQyxJQUFJLEVBQUVDLElBQUksQ0FBQ0MsU0FBUyxDQUFDO2NBQ25CaEgsUUFBUSxFQUFFSCxXQUFXLENBQUNHLFFBQVE7Y0FDOUJDLFFBQVEsRUFBRUosV0FBVyxDQUFDSSxRQUFRO2NBQzlCZ0gsU0FBUyxFQUFFO1lBQ2IsQ0FBQztVQUNILENBQ0YsQ0FBQztVQUVELElBQUksQ0FBQ1QsYUFBYSxDQUFDVSxFQUFFLEVBQUU7WUFDckJuSyxLQUFLLENBQUMsNENBQTRDeUosYUFBYSxDQUFDMUQsTUFBTSxFQUFFLENBQUM7WUFDekU7VUFDRjtVQUVBLE1BQU1xRSxTQUFTLEdBQUcsTUFBTVgsYUFBYSxDQUFDWSxJQUFJLENBQUMsQ0FBQztVQUM1QyxJQUFJLENBQUNELFNBQVMsQ0FBQ0UsS0FBSyxFQUFFO1lBQ3BCdEssS0FBSyxDQUFDLDhDQUE4QyxDQUFDO1lBQ3JEO1VBQ0Y7VUFFQUEsS0FBSyxDQUFDLG1FQUFtRSxDQUFDO1VBQ3pFLElBQUksQ0FBU3VLLGNBQWMsR0FBR0gsU0FBUyxDQUFDRSxLQUFLO1VBRTlDLE1BQU0sSUFBSSxDQUFDcEosSUFBSSxDQUFDc0osc0JBQXNCLENBQUMsSUFBSSxDQUFDO1VBQzVDLElBQUksQ0FBQ3RKLElBQUksQ0FBQ3VKLEVBQUUsQ0FBQyxTQUFTLEVBQUUsTUFBT3JCLE9BQW9CLElBQUs7WUFDdEQsTUFBTTVILEdBQUcsR0FBRzRILE9BQU8sQ0FBQzVILEdBQUcsQ0FBQyxDQUFDO1lBQ3pCLElBQ0VBLEdBQUcsQ0FBQ0MsUUFBUSxDQUFDLDJDQUEyQyxDQUFDLElBQ3pEMkgsT0FBTyxDQUFDTyxNQUFNLENBQUMsQ0FBQyxLQUFLLE1BQU0sRUFDM0I7Y0FDQTNKLEtBQUssQ0FBQyw4REFBOEQsQ0FBQztjQUNyRW9KLE9BQU8sQ0FBQ3NCLE9BQU8sQ0FBQztnQkFDZDNFLE1BQU0sRUFBRSxHQUFHO2dCQUNYNEUsV0FBVyxFQUFFLGtCQUFrQjtnQkFDL0J0QixPQUFPLEVBQUU7a0JBQ1AsNkJBQTZCLEVBQUUsc0NBQXNDO2tCQUNyRSxrQ0FBa0MsRUFBRTtnQkFDdEMsQ0FBQztnQkFDRFUsSUFBSSxFQUFFQyxJQUFJLENBQUNDLFNBQVMsQ0FBQztrQkFBRUssS0FBSyxFQUFFRixTQUFTLENBQUNFLEtBQUs7a0JBQUVNLElBQUksRUFBRSxJQUFJO2tCQUFFQyxjQUFjLEVBQUU7Z0JBQUUsQ0FBQztjQUNoRixDQUFDLENBQUM7Y0FDRjtZQUNGO1lBQ0F6QixPQUFPLENBQUMwQixRQUFRLENBQUMsQ0FBQztVQUNwQixDQUFDLENBQUM7UUFDSixDQUFDLENBQUMsT0FBT0MsR0FBRyxFQUFFO1VBQ1ovSyxLQUFLLENBQUMsb0NBQXFDK0ssR0FBRyxDQUFXQyxPQUFPLEVBQUUsQ0FBQztRQUNyRTtNQUNGO0lBQ0YsQ0FBQztFQUNIO0VBRUEsTUFBTUMsU0FBU0EsQ0FBQSxFQUFtQztJQUNoRCxNQUFNQyxrQkFBa0IsR0FBRyxJQUFBbkcsZUFBTSxFQUFDLENBQUMsQ0FBQ29HLFFBQVEsQ0FBQyxDQUFDLEVBQUUsT0FBTyxDQUFDLENBQUNBLFFBQVEsQ0FBQyxDQUFDLEVBQUUsUUFBUSxDQUFDLENBQUNoRixHQUFHLENBQUMsQ0FBQyxFQUFFLEtBQUssQ0FBQztJQUM1RixNQUFNaUYsU0FBUyxHQUFHLElBQUksQ0FBQ3pJLE9BQU8sQ0FBQ3lJLFNBQVMsSUFBSUYsa0JBQWtCLENBQUNHLE1BQU0sQ0FBQyxDQUFDO0lBQ3ZFLE1BQU1DLFdBQVcsR0FBR3ZHLGVBQU0sQ0FBQ3dHLEdBQUcsQ0FBQ0wsa0JBQWtCLEVBQUUsSUFBQW5HLGVBQU0sRUFBQ3FHLFNBQVMsQ0FBQyxDQUFDO0lBQ3JFcEwsS0FBSyxDQUFDLCtCQUErQnNMLFdBQVcsQ0FBQ0UsTUFBTSxDQUFDLENBQUMsRUFBRSxDQUFDO0lBRTVELE1BQU0sQ0FBQzFELEtBQUssRUFBRTJELE9BQU8sRUFBRUMsYUFBYSxDQUFDLEdBQUcsTUFBTWhLLE9BQU8sQ0FBQzRDLEdBQUcsQ0FBQyxDQUN4RCxJQUFJLENBQUNxRCxRQUFRLENBQUMsQ0FBQyxFQUNmLElBQUksQ0FBQ1EsVUFBVSxDQUFDLENBQUMsRUFDakIsSUFBSSxDQUFDRixzQkFBc0IsQ0FBQyxDQUFDLENBQzlCLENBQUM7SUFFRixNQUFNMEQsb0JBQW9CLEdBQUcsSUFBSSxDQUFDaEosT0FBTyxDQUFDZ0osb0JBQW9CLElBQUksQ0FBQztJQUVuRTNMLEtBQUssQ0FBQyxrQ0FBa0MsQ0FBQztJQUN6QyxNQUFNcUIsTUFBTSxHQUFHLE1BQU0sSUFBQXVLLGdCQUFTLEVBQzVCak0sdUJBQXVCLEVBQ3ZCO01BQUVrTSxpQkFBaUIsRUFBRS9ELEtBQUssQ0FBQ3ZELEdBQUcsQ0FBQyxDQUFDO1FBQUV3RDtNQUFhLENBQUMsTUFBTTtRQUFFQTtNQUFhLENBQUMsQ0FBQztJQUFFLENBQUMsRUFDMUU7TUFDRTJELGFBQWE7TUFDYixXQUFXLEVBQUVELE9BQU87TUFDcEIsY0FBYyxFQUFFLGtCQUFrQjtNQUNsQyxHQUFHbk07SUFDTCxDQUNGLENBQUM7SUFFRCxNQUFNd0UsUUFBUSxHQUFHLE1BQU1wQyxPQUFPLENBQUM0QyxHQUFHLENBQ2hDd0QsS0FBSyxDQUFDdkQsR0FBRyxDQUFDLE1BQU1kLElBQUksSUFBSTtNQUN0QixNQUFNcUksdUJBQXVCLEdBQUcsSUFBQS9HLGVBQU0sRUFBQyxDQUFDLENBQUNvQixHQUFHLENBQUN3RixvQkFBb0IsRUFBRSxPQUFPLENBQUM7TUFDM0UsTUFBTUksTUFBTSxHQUFHRCx1QkFBdUIsQ0FBQ0UsSUFBSSxDQUFDVixXQUFXLEVBQUUsUUFBUSxDQUFDO01BQ2xFLE1BQU1XLGFBQXVDLEdBQUcsRUFBRTtNQUNsRCxNQUFNOUssS0FBSyxHQUFHRSxNQUFNLENBQUNqQixNQUFNLEVBQUU4TCxlQUFlLEVBQUVDLGVBQWUsRUFBRTdLLElBQUksQ0FDaEVDLENBQWlCLElBQUtBLENBQUMsQ0FBQ3dHLFlBQVksS0FBS3RFLElBQUksQ0FBQ3NFLFlBQ2pELENBQUM7TUFFRC9ILEtBQUssQ0FBQyx1Q0FBdUN5RCxJQUFJLENBQUNzRSxZQUFZLEVBQUUsQ0FBQztNQUNqRSxJQUFJMUUsV0FBVyxHQUFHLE1BQU0sSUFBQXVJLGdCQUFTLEVBQy9CaE0scUNBQXFDLEVBQ3JDO1FBQUV3TSxpQkFBaUIsRUFBRSxDQUFDM0ksSUFBSSxDQUFDc0UsWUFBWTtNQUFFLENBQUMsRUFDMUM7UUFDRTJELGFBQWE7UUFDYixXQUFXLEVBQUVELE9BQU87UUFDcEIsY0FBYyxFQUFFLGtCQUFrQjtRQUNsQyxHQUFHbk07TUFDTCxDQUNGLENBQUM7TUFFRFUsS0FBSyxDQUFDLHlDQUF5Q3lELElBQUksQ0FBQ3NFLFlBQVksRUFBRSxDQUFDO01BQ25FLEtBQUssSUFBSXNFLENBQUMsR0FBRyxDQUFDLEVBQUVBLENBQUMsSUFBSU4sTUFBTSxFQUFFTSxDQUFDLEVBQUUsRUFBRTtRQUNoQyxNQUFNQyxLQUFLLEdBQUdSLHVCQUF1QixDQUFDUyxLQUFLLENBQUMsQ0FBQyxDQUFDcEIsUUFBUSxDQUFDa0IsQ0FBQyxFQUFFLFFBQVEsQ0FBQztRQUNuRSxNQUFNekksU0FBUyxHQUFHLE1BQU0sSUFBQWdJLGdCQUFTLEVBQy9CbE0sNkJBQTZCLEVBQzdCO1VBQUVxSSxZQUFZLEVBQUV0RSxJQUFJLENBQUNzRSxZQUFZO1VBQUV1RSxLQUFLLEVBQUVBLEtBQUssQ0FBQ2QsTUFBTSxDQUFDLEdBQUcsQ0FBQztVQUFFZ0IsSUFBSSxFQUFFRixLQUFLLENBQUNkLE1BQU0sQ0FBQyxNQUFNO1FBQUUsQ0FBQyxFQUN6RjtVQUNFRSxhQUFhO1VBQ2IsV0FBVyxFQUFFRCxPQUFPO1VBQ3BCLGNBQWMsRUFBRSxrQkFBa0I7VUFDbEMsR0FBR25NO1FBQ0wsQ0FDRixDQUFDO1FBRUQsSUFBSXNFLFNBQVMsRUFBRTZJLFVBQVUsS0FBSyxDQUFDLEVBQzdCLE1BQU0sSUFBSTdLLEtBQUssQ0FDYix5Q0FBeUM2QixJQUFJLENBQUN1RSxXQUFXLGNBQWNwRSxTQUFTLEVBQUU4SSxLQUFLLElBQUksRUFBRSxFQUMvRixDQUFDO1FBRUgsSUFBSSxDQUFDM0wsd0JBQXdCLENBQUM2QyxTQUFTLENBQUMsRUFBRTtVQUN4QyxNQUFNLElBQUloQyxLQUFLLENBQUMsaURBQWlELENBQUM7UUFDcEU7UUFFQXFLLGFBQWEsQ0FBQ1UsSUFBSSxDQUFDL0ksU0FBUyxDQUFDO01BQy9CO01BRUEsSUFBSVAsV0FBVyxFQUFFb0osVUFBVSxLQUFLLENBQUMsSUFBSXBKLFdBQVcsRUFBRW9KLFVBQVUsS0FBSyxFQUFFLEVBQUU7UUFDbkV6TSxLQUFLLENBQ0gsaURBQWlEeUQsSUFBSSxDQUFDdUUsV0FBVyxjQUFjM0UsV0FBVyxFQUFFcUosS0FBSyxJQUFJLEVBQUUsRUFDekcsQ0FBQztRQUNEckosV0FBVyxHQUFHLElBQUk7TUFDcEIsQ0FBQyxNQUFNLElBQUksQ0FBQ3JDLCtCQUErQixDQUFDcUMsV0FBVyxDQUFDLEVBQUU7UUFDeERyRCxLQUFLLENBQUMsbURBQW1ELENBQUM7UUFDMURxRCxXQUFXLEdBQUcsSUFBSTtNQUNwQjtNQUVBLE1BQU1nQixZQUFZLEdBQUdsQiwrQkFBK0IsQ0FBQzhJLGFBQWEsRUFBRTVJLFdBQVcsRUFBRSxJQUFJLENBQUNWLE9BQU8sQ0FBQztNQUU5RjNDLEtBQUssQ0FBQyw2QkFBNkIsQ0FBQztNQUNwQyxNQUFNNE0sSUFBSSxHQUNQLElBQUksQ0FBQ2pLLE9BQU8sQ0FBQ2tLLFVBQVUsRUFBRUMsOEJBQThCLElBQUksSUFBSSxHQUM1RCxJQUFBQyxtQ0FBcUIsRUFBQzFJLFlBQVksRUFBRSxJQUFBVSxlQUFNLEVBQUNxRyxTQUFTLENBQUMsRUFBRSxJQUFJLENBQUN6SSxPQUFPLENBQUNxSyxtQkFBbUIsSUFBSSxLQUFLLENBQUMsR0FDakczSSxZQUFZO01BRWxCLE9BQU87UUFDTHVJLElBQUk7UUFDSkssT0FBTyxFQUFFOUwsS0FBSyxFQUFFK0wsY0FBYyxJQUFJLElBQUksR0FBRyxDQUFDL0wsS0FBSyxDQUFDK0wsY0FBYyxHQUFHdk0sU0FBUztRQUMxRXdNLGFBQWEsRUFBRTFKLElBQUksQ0FBQ3VFO01BQ3RCLENBQUM7SUFDSCxDQUFDLENBQ0gsQ0FBQztJQUVEaEksS0FBSyxDQUFDLDZCQUE2QixDQUFDO0lBRXBDQSxLQUFLLENBQUNnSyxJQUFJLENBQUNDLFNBQVMsQ0FBQ25HLFFBQVEsRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDLENBQUM7SUFDeEMsT0FBTztNQUNMc0osT0FBTyxFQUFFLElBQUk7TUFDYnRKO0lBQ0YsQ0FBQztFQUNIO0FBQ0Y7QUFBQyxJQUFBdUosUUFBQSxHQUFBQyxPQUFBLENBQUFqTyxPQUFBLEdBRWNnSSxjQUFjIiwiaWdub3JlTGlzdCI6W119