"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.clickAccountSelectorGetAccountIds = clickAccountSelectorGetAccountIds;
exports.createLoginFields = createLoginFields;
exports.default = void 0;
exports.getPossibleLoginResults = getPossibleLoginResults;
exports.selectAccountFromDropdown = selectAccountFromDropdown;
exports.waitForPostLogin = waitForPostLogin;
var _moment = _interopRequireDefault(require("moment"));
var _constants = require("../constants");
var _elementsInteractions = require("../helpers/elements-interactions");
var _navigation = require("../helpers/navigation");
var _transactions = require("../helpers/transactions");
var _waiting = require("../helpers/waiting");
var _transactions2 = require("../transactions");
var _baseScraperWithBrowser = require("./base-scraper-with-browser");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
const DATE_FORMAT = 'DD/MM/YYYY';
const NO_TRANSACTION_IN_DATE_RANGE_TEXT = 'לא נמצאו נתונים בנושא המבוקש';
const DATE_COLUMN_CLASS_COMPLETED = 'date first';
const DATE_COLUMN_CLASS_PENDING = 'first date';
const DESCRIPTION_COLUMN_CLASS_COMPLETED = 'reference wrap_normal';
const DESCRIPTION_COLUMN_CLASS_PENDING = 'details wrap_normal';
const REFERENCE_COLUMN_CLASS = 'details';
const DEBIT_COLUMN_CLASS = 'debit';
const CREDIT_COLUMN_CLASS = 'credit';
const ERROR_MESSAGE_CLASS = 'NO_DATA';
const ACCOUNTS_NUMBER = 'div.fibi_account span.acc_num';
const CLOSE_SEARCH_BY_DATES_BUTTON_CLASS = 'ui-datepicker-close';
const SHOW_SEARCH_BY_DATES_BUTTON_VALUE = 'הצג';
const COMPLETED_TRANSACTIONS_TABLE = 'table#dataTable077';
const PENDING_TRANSACTIONS_TABLE = 'table#dataTable023';
const NEXT_PAGE_LINK = 'a#Npage.paging';
const CURRENT_BALANCE = '.main_balance';
const IFRAME_NAME = 'iframe-old-pages';
const ELEMENT_RENDER_TIMEOUT_MS = 10000;
function getPossibleLoginResults() {
  const urls = {};
  urls[_baseScraperWithBrowser.LoginResults.Success] = [/fibi.*accountSummary/,
  // New UI pattern
  /Resources\/PortalNG\/shell/,
  // New UI pattern
  /FibiMenu\/Online/ // Old UI pattern
  ];
  urls[_baseScraperWithBrowser.LoginResults.InvalidPassword] = [/FibiMenu\/Marketing\/Private\/Home/];
  return urls;
}
function createLoginFields(credentials) {
  return [{
    selector: '#username',
    value: credentials.username
  }, {
    selector: '#password',
    value: credentials.password
  }];
}
function getAmountData(amountStr) {
  let amountStrCopy = amountStr.replace(_constants.SHEKEL_CURRENCY_SYMBOL, '');
  amountStrCopy = amountStrCopy.replaceAll(',', '');
  return parseFloat(amountStrCopy);
}
function getTxnAmount(txn) {
  const credit = getAmountData(txn.credit);
  const debit = getAmountData(txn.debit);
  return (Number.isNaN(credit) ? 0 : credit) - (Number.isNaN(debit) ? 0 : debit);
}
function convertTransactions(txns, options) {
  return txns.map(txn => {
    const convertedDate = (0, _moment.default)(txn.date, DATE_FORMAT).toISOString();
    const convertedAmount = getTxnAmount(txn);
    const result = {
      type: _transactions2.TransactionTypes.Normal,
      identifier: txn.reference ? parseInt(txn.reference, 10) : undefined,
      date: convertedDate,
      processedDate: convertedDate,
      originalAmount: convertedAmount,
      originalCurrency: _constants.SHEKEL_CURRENCY,
      chargedAmount: convertedAmount,
      status: txn.status,
      description: txn.description,
      memo: txn.memo
    };
    if (options?.includeRawTransaction) {
      result.rawTransaction = (0, _transactions.getRawTransaction)(txn);
    }
    return result;
  });
}
function getTransactionDate(tds, transactionType, transactionsColsTypes) {
  if (transactionType === 'completed') {
    return (tds[transactionsColsTypes[DATE_COLUMN_CLASS_COMPLETED]] || '').trim();
  }
  return (tds[transactionsColsTypes[DATE_COLUMN_CLASS_PENDING]] || '').trim();
}
function getTransactionDescription(tds, transactionType, transactionsColsTypes) {
  if (transactionType === 'completed') {
    return (tds[transactionsColsTypes[DESCRIPTION_COLUMN_CLASS_COMPLETED]] || '').trim();
  }
  return (tds[transactionsColsTypes[DESCRIPTION_COLUMN_CLASS_PENDING]] || '').trim();
}
function getTransactionReference(tds, transactionsColsTypes) {
  return (tds[transactionsColsTypes[REFERENCE_COLUMN_CLASS]] || '').trim();
}
function getTransactionDebit(tds, transactionsColsTypes) {
  return (tds[transactionsColsTypes[DEBIT_COLUMN_CLASS]] || '').trim();
}
function getTransactionCredit(tds, transactionsColsTypes) {
  return (tds[transactionsColsTypes[CREDIT_COLUMN_CLASS]] || '').trim();
}
function extractTransactionDetails(txnRow, transactionStatus, transactionsColsTypes) {
  const tds = txnRow.innerTds;
  const item = {
    status: transactionStatus,
    date: getTransactionDate(tds, transactionStatus, transactionsColsTypes),
    description: getTransactionDescription(tds, transactionStatus, transactionsColsTypes),
    reference: getTransactionReference(tds, transactionsColsTypes),
    debit: getTransactionDebit(tds, transactionsColsTypes),
    credit: getTransactionCredit(tds, transactionsColsTypes)
  };
  return item;
}
async function getTransactionsColsTypeClasses(page, tableLocator) {
  const result = {};
  const typeClassesObjs = await (0, _elementsInteractions.pageEvalAll)(page, `${tableLocator} tbody tr:first-of-type td`, null, tds => {
    return tds.map((td, index) => ({
      colClass: td.getAttribute('class'),
      index
    }));
  });
  for (const typeClassObj of typeClassesObjs) {
    if (typeClassObj.colClass) {
      result[typeClassObj.colClass] = typeClassObj.index;
    }
  }
  return result;
}
function extractTransaction(txns, transactionStatus, txnRow, transactionsColsTypes) {
  const txn = extractTransactionDetails(txnRow, transactionStatus, transactionsColsTypes);
  if (txn.date !== '') {
    txns.push(txn);
  }
}
async function extractTransactions(page, tableLocator, transactionStatus) {
  const txns = [];
  const transactionsColsTypes = await getTransactionsColsTypeClasses(page, tableLocator);
  const transactionsRows = await (0, _elementsInteractions.pageEvalAll)(page, `${tableLocator} tbody tr`, [], trs => {
    return trs.map(tr => ({
      innerTds: Array.from(tr.getElementsByTagName('td')).map(td => td.innerText)
    }));
  });
  for (const txnRow of transactionsRows) {
    extractTransaction(txns, transactionStatus, txnRow, transactionsColsTypes);
  }
  return txns;
}
async function isNoTransactionInDateRangeError(page) {
  const hasErrorInfoElement = await (0, _elementsInteractions.elementPresentOnPage)(page, `.${ERROR_MESSAGE_CLASS}`);
  if (hasErrorInfoElement) {
    const errorText = await page.$eval(`.${ERROR_MESSAGE_CLASS}`, errorElement => {
      return errorElement.innerText;
    });
    return errorText.trim() === NO_TRANSACTION_IN_DATE_RANGE_TEXT;
  }
  return false;
}
async function searchByDates(page, startDate) {
  await (0, _elementsInteractions.clickButton)(page, 'a#tabHeader4');
  await (0, _elementsInteractions.waitUntilElementFound)(page, 'div#fibi_dates');
  await (0, _elementsInteractions.fillInput)(page, 'input#fromDate', startDate.format(DATE_FORMAT));
  await (0, _elementsInteractions.clickButton)(page, `button[class*=${CLOSE_SEARCH_BY_DATES_BUTTON_CLASS}]`);
  await (0, _elementsInteractions.clickButton)(page, `input[value=${SHOW_SEARCH_BY_DATES_BUTTON_VALUE}]`);
  await (0, _navigation.waitForNavigation)(page);
}
async function getAccountNumber(page) {
  // Wait until the account number element is present in the DOM
  await (0, _elementsInteractions.waitUntilElementFound)(page, ACCOUNTS_NUMBER, true, ELEMENT_RENDER_TIMEOUT_MS);
  const selectedSnifAccount = await page.$eval(ACCOUNTS_NUMBER, option => {
    return option.innerText;
  });
  return selectedSnifAccount.replace('/', '_').trim();
}
async function checkIfHasNextPage(page) {
  return (0, _elementsInteractions.elementPresentOnPage)(page, NEXT_PAGE_LINK);
}
async function navigateToNextPage(page) {
  await (0, _elementsInteractions.clickButton)(page, NEXT_PAGE_LINK);
  await (0, _navigation.waitForNavigation)(page);
}

/* Couldn't reproduce scenario with multiple pages of pending transactions - Should support if exists such case.
   needToPaginate is false if scraping pending transactions */
async function scrapeTransactions(page, tableLocator, transactionStatus, needToPaginate, options) {
  const txns = [];
  let hasNextPage = false;
  do {
    const currentPageTxns = await extractTransactions(page, tableLocator, transactionStatus);
    txns.push(...currentPageTxns);
    if (needToPaginate) {
      hasNextPage = await checkIfHasNextPage(page);
      if (hasNextPage) {
        await navigateToNextPage(page);
      }
    }
  } while (hasNextPage);
  return convertTransactions(txns, options);
}
async function getAccountTransactions(page, options) {
  await Promise.race([(0, _elementsInteractions.waitUntilElementFound)(page, "div[id*='divTable']", false), (0, _elementsInteractions.waitUntilElementFound)(page, `.${ERROR_MESSAGE_CLASS}`, false)]);
  const noTransactionInRangeError = await isNoTransactionInDateRangeError(page);
  if (noTransactionInRangeError) {
    return [];
  }
  const pendingTxns = await scrapeTransactions(page, PENDING_TRANSACTIONS_TABLE, _transactions2.TransactionStatuses.Pending, false, options);
  const completedTxns = await scrapeTransactions(page, COMPLETED_TRANSACTIONS_TABLE, _transactions2.TransactionStatuses.Completed, true, options);
  const txns = [...pendingTxns, ...completedTxns];
  return txns;
}
async function getCurrentBalance(page) {
  // Wait for the balance element to appear and be visible
  await (0, _elementsInteractions.waitUntilElementFound)(page, CURRENT_BALANCE, true, ELEMENT_RENDER_TIMEOUT_MS);

  // Extract text content
  const balanceStr = await page.$eval(CURRENT_BALANCE, el => {
    return el.innerText;
  });
  return getAmountData(balanceStr);
}
async function waitForPostLogin(page) {
  return Promise.race([(0, _elementsInteractions.waitUntilElementFound)(page, '#card-header', false),
  // New UI
  (0, _elementsInteractions.waitUntilElementFound)(page, '#account_num', true),
  // New UI
  (0, _elementsInteractions.waitUntilElementFound)(page, '#matafLogoutLink', true),
  // Old UI
  (0, _elementsInteractions.waitUntilElementFound)(page, '#validationMsg', true) // Old UI
  ]);
}
async function fetchAccountData(page, startDate, options) {
  const accountNumber = await getAccountNumber(page);
  const balance = await getCurrentBalance(page);
  await searchByDates(page, startDate);
  const txns = await getAccountTransactions(page, options);
  return {
    accountNumber,
    txns,
    balance
  };
}
async function getAccountIdsOldUI(page) {
  return page.evaluate(() => {
    const selectElement = document.getElementById('account_num_select');
    const options = selectElement ? selectElement.querySelectorAll('option') : [];
    if (!options) return [];
    return Array.from(options, option => option.value);
  });
}

/**
 * Ensures the account dropdown is open, then returns the available account labels.
 *
 * This method:
 * - Checks if the dropdown is already open.
 * - If not open, clicks the account selector to open it.
 * - Waits for the dropdown to render.
 * - Extracts and returns the list of available account labels.
 *
 * Graceful handling:
 * - If any error occurs (e.g., selectors not found, timing issues, UI version changes),
 *   the function returns an empty list.
 *
 * @param page Puppeteer Page object.
 * @returns An array of available account labels (e.g., ["127 | XXXX1", "127 | XXXX2"]),
 *          or an empty array if something goes wrong.
 */
async function clickAccountSelectorGetAccountIds(page) {
  try {
    const accountSelector = 'div.current-account'; // Direct selector to clickable element
    const dropdownPanelSelector = 'div.mat-mdc-autocomplete-panel.account-select-dd'; // The dropdown list box
    const optionSelector = 'mat-option .mdc-list-item__primary-text'; // Account option labels

    // Check if dropdown is already open
    const dropdownVisible = await page.$eval(dropdownPanelSelector, el => {
      return el && window.getComputedStyle(el).display !== 'none' && el.offsetParent !== null;
    }).catch(() => false); // catch if dropdown is not in the DOM yet

    if (!dropdownVisible) {
      await (0, _elementsInteractions.waitUntilElementFound)(page, accountSelector, true, ELEMENT_RENDER_TIMEOUT_MS);

      // Click the account selector to open the dropdown
      await (0, _elementsInteractions.clickButton)(page, accountSelector);

      // Wait for the dropdown to open
      await (0, _elementsInteractions.waitUntilElementFound)(page, dropdownPanelSelector, true, ELEMENT_RENDER_TIMEOUT_MS);
    }

    // Extract account labels from the dropdown options
    const accountLabels = await page.$$eval(optionSelector, options => {
      return options.map(option => option.textContent?.trim() || '').filter(label => label !== '');
    });
    return accountLabels;
  } catch (error) {
    return []; // Graceful fallback
  }
}
async function getAccountIdsBothUIs(page) {
  let accountsIds = await clickAccountSelectorGetAccountIds(page);
  if (accountsIds.length === 0) {
    accountsIds = await getAccountIdsOldUI(page);
  }
  return accountsIds;
}

/**
 * Selects an account from the dropdown based on the provided account label.
 *
 * This method:
 * - Clicks the account selector button to open the dropdown.
 * - Retrieves the list of available account labels.
 * - Checks if the provided account label exists in the list.
 * - Finds and clicks the matching account option if found.
 *
 * @param page Puppeteer Page object.
 * @param accountLabel The text of the account to select (e.g., "127 | XXXXX").
 * @returns True if the account option was found and clicked; false otherwise.
 */
async function selectAccountFromDropdown(page, accountLabel) {
  // Call clickAccountSelector to get the available accounts and open the dropdown
  const availableAccounts = await clickAccountSelectorGetAccountIds(page);

  // Check if the account label exists in the available accounts
  if (!availableAccounts.includes(accountLabel)) {
    return false;
  }

  // Wait for the dropdown options to be rendered
  const optionSelector = 'mat-option .mdc-list-item__primary-text';
  await (0, _elementsInteractions.waitUntilElementFound)(page, optionSelector, true, ELEMENT_RENDER_TIMEOUT_MS);

  // Query all matching options
  const accountOptions = await page.$$(optionSelector);

  // Find and click the option matching the accountLabel
  for (const option of accountOptions) {
    const text = await page.evaluate(el => el.textContent?.trim(), option);
    if (text === accountLabel) {
      const optionHandle = await option.evaluateHandle(el => el);
      await page.evaluate(el => el.click(), optionHandle);
      return true;
    }
  }
  return false;
}
async function getTransactionsFrame(page) {
  // Try a few times to find the iframe, as it might not be immediately available
  for (let attempt = 0; attempt < 3; attempt++) {
    await (0, _waiting.sleep)(2000);
    const frames = page.frames();
    const targetFrame = frames.find(f => f.name() === IFRAME_NAME);
    if (targetFrame) {
      return targetFrame;
    }
  }
  return null;
}
async function selectAccountBothUIs(page, accountId) {
  const accountSelected = await selectAccountFromDropdown(page, accountId);
  if (!accountSelected) {
    // Old UI format
    await page.select('#account_num_select', accountId);
    await (0, _elementsInteractions.waitUntilElementFound)(page, '#account_num_select', true);
  }
}
async function fetchAccountDataBothUIs(page, startDate, options) {
  // Try to get the iframe for the new UI
  const frame = await getTransactionsFrame(page);

  // Use the frame if available (new UI), otherwise use the page directly (old UI)
  const targetPage = frame || page;
  return fetchAccountData(targetPage, startDate, options);
}
async function fetchAccounts(page, startDate, options) {
  const accountsIds = await getAccountIdsBothUIs(page);
  if (accountsIds.length === 0) {
    // In case accountsIds could no be parsed just return the transactions of the currently selected account
    const accountData = await fetchAccountDataBothUIs(page, startDate, options);
    return [accountData];
  }
  const accounts = [];
  for (const accountId of accountsIds) {
    await selectAccountBothUIs(page, accountId);
    const accountData = await fetchAccountDataBothUIs(page, startDate, options);
    accounts.push(accountData);
  }
  return accounts;
}
class BeinleumiGroupBaseScraper extends _baseScraperWithBrowser.BaseScraperWithBrowser {
  BASE_URL = '';
  LOGIN_URL = '';
  TRANSACTIONS_URL = '';
  getLoginOptions(credentials) {
    return {
      loginUrl: `${this.LOGIN_URL}`,
      fields: createLoginFields(credentials),
      submitButtonSelector: '#continueBtn',
      postAction: async () => waitForPostLogin(this.page),
      possibleResults: getPossibleLoginResults(),
      // HACK: For some reason, though the login button (#continueBtn) is present and visible, the click action does not perform.
      // Adding this delay fixes the issue.
      preAction: async () => {
        await (0, _waiting.sleep)(1000);
      }
    };
  }
  async fetchData() {
    const defaultStartMoment = (0, _moment.default)().subtract(1, 'years').add(1, 'day');
    const startMomentLimit = (0, _moment.default)({
      year: 1600
    });
    const startDate = this.options.startDate || defaultStartMoment.toDate();
    const startMoment = _moment.default.max(startMomentLimit, (0, _moment.default)(startDate));
    await this.navigateTo(this.TRANSACTIONS_URL);
    const accounts = await fetchAccounts(this.page, startMoment, this.options);
    return {
      success: true,
      accounts
    };
  }
}
var _default = exports.default = BeinleumiGroupBaseScraper;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfbW9tZW50IiwiX2ludGVyb3BSZXF1aXJlRGVmYXVsdCIsInJlcXVpcmUiLCJfY29uc3RhbnRzIiwiX2VsZW1lbnRzSW50ZXJhY3Rpb25zIiwiX25hdmlnYXRpb24iLCJfdHJhbnNhY3Rpb25zIiwiX3dhaXRpbmciLCJfdHJhbnNhY3Rpb25zMiIsIl9iYXNlU2NyYXBlcldpdGhCcm93c2VyIiwiZSIsIl9fZXNNb2R1bGUiLCJkZWZhdWx0IiwiREFURV9GT1JNQVQiLCJOT19UUkFOU0FDVElPTl9JTl9EQVRFX1JBTkdFX1RFWFQiLCJEQVRFX0NPTFVNTl9DTEFTU19DT01QTEVURUQiLCJEQVRFX0NPTFVNTl9DTEFTU19QRU5ESU5HIiwiREVTQ1JJUFRJT05fQ09MVU1OX0NMQVNTX0NPTVBMRVRFRCIsIkRFU0NSSVBUSU9OX0NPTFVNTl9DTEFTU19QRU5ESU5HIiwiUkVGRVJFTkNFX0NPTFVNTl9DTEFTUyIsIkRFQklUX0NPTFVNTl9DTEFTUyIsIkNSRURJVF9DT0xVTU5fQ0xBU1MiLCJFUlJPUl9NRVNTQUdFX0NMQVNTIiwiQUNDT1VOVFNfTlVNQkVSIiwiQ0xPU0VfU0VBUkNIX0JZX0RBVEVTX0JVVFRPTl9DTEFTUyIsIlNIT1dfU0VBUkNIX0JZX0RBVEVTX0JVVFRPTl9WQUxVRSIsIkNPTVBMRVRFRF9UUkFOU0FDVElPTlNfVEFCTEUiLCJQRU5ESU5HX1RSQU5TQUNUSU9OU19UQUJMRSIsIk5FWFRfUEFHRV9MSU5LIiwiQ1VSUkVOVF9CQUxBTkNFIiwiSUZSQU1FX05BTUUiLCJFTEVNRU5UX1JFTkRFUl9USU1FT1VUX01TIiwiZ2V0UG9zc2libGVMb2dpblJlc3VsdHMiLCJ1cmxzIiwiTG9naW5SZXN1bHRzIiwiU3VjY2VzcyIsIkludmFsaWRQYXNzd29yZCIsImNyZWF0ZUxvZ2luRmllbGRzIiwiY3JlZGVudGlhbHMiLCJzZWxlY3RvciIsInZhbHVlIiwidXNlcm5hbWUiLCJwYXNzd29yZCIsImdldEFtb3VudERhdGEiLCJhbW91bnRTdHIiLCJhbW91bnRTdHJDb3B5IiwicmVwbGFjZSIsIlNIRUtFTF9DVVJSRU5DWV9TWU1CT0wiLCJyZXBsYWNlQWxsIiwicGFyc2VGbG9hdCIsImdldFR4bkFtb3VudCIsInR4biIsImNyZWRpdCIsImRlYml0IiwiTnVtYmVyIiwiaXNOYU4iLCJjb252ZXJ0VHJhbnNhY3Rpb25zIiwidHhucyIsIm9wdGlvbnMiLCJtYXAiLCJjb252ZXJ0ZWREYXRlIiwibW9tZW50IiwiZGF0ZSIsInRvSVNPU3RyaW5nIiwiY29udmVydGVkQW1vdW50IiwicmVzdWx0IiwidHlwZSIsIlRyYW5zYWN0aW9uVHlwZXMiLCJOb3JtYWwiLCJpZGVudGlmaWVyIiwicmVmZXJlbmNlIiwicGFyc2VJbnQiLCJ1bmRlZmluZWQiLCJwcm9jZXNzZWREYXRlIiwib3JpZ2luYWxBbW91bnQiLCJvcmlnaW5hbEN1cnJlbmN5IiwiU0hFS0VMX0NVUlJFTkNZIiwiY2hhcmdlZEFtb3VudCIsInN0YXR1cyIsImRlc2NyaXB0aW9uIiwibWVtbyIsImluY2x1ZGVSYXdUcmFuc2FjdGlvbiIsInJhd1RyYW5zYWN0aW9uIiwiZ2V0UmF3VHJhbnNhY3Rpb24iLCJnZXRUcmFuc2FjdGlvbkRhdGUiLCJ0ZHMiLCJ0cmFuc2FjdGlvblR5cGUiLCJ0cmFuc2FjdGlvbnNDb2xzVHlwZXMiLCJ0cmltIiwiZ2V0VHJhbnNhY3Rpb25EZXNjcmlwdGlvbiIsImdldFRyYW5zYWN0aW9uUmVmZXJlbmNlIiwiZ2V0VHJhbnNhY3Rpb25EZWJpdCIsImdldFRyYW5zYWN0aW9uQ3JlZGl0IiwiZXh0cmFjdFRyYW5zYWN0aW9uRGV0YWlscyIsInR4blJvdyIsInRyYW5zYWN0aW9uU3RhdHVzIiwiaW5uZXJUZHMiLCJpdGVtIiwiZ2V0VHJhbnNhY3Rpb25zQ29sc1R5cGVDbGFzc2VzIiwicGFnZSIsInRhYmxlTG9jYXRvciIsInR5cGVDbGFzc2VzT2JqcyIsInBhZ2VFdmFsQWxsIiwidGQiLCJpbmRleCIsImNvbENsYXNzIiwiZ2V0QXR0cmlidXRlIiwidHlwZUNsYXNzT2JqIiwiZXh0cmFjdFRyYW5zYWN0aW9uIiwicHVzaCIsImV4dHJhY3RUcmFuc2FjdGlvbnMiLCJ0cmFuc2FjdGlvbnNSb3dzIiwidHJzIiwidHIiLCJBcnJheSIsImZyb20iLCJnZXRFbGVtZW50c0J5VGFnTmFtZSIsImlubmVyVGV4dCIsImlzTm9UcmFuc2FjdGlvbkluRGF0ZVJhbmdlRXJyb3IiLCJoYXNFcnJvckluZm9FbGVtZW50IiwiZWxlbWVudFByZXNlbnRPblBhZ2UiLCJlcnJvclRleHQiLCIkZXZhbCIsImVycm9yRWxlbWVudCIsInNlYXJjaEJ5RGF0ZXMiLCJzdGFydERhdGUiLCJjbGlja0J1dHRvbiIsIndhaXRVbnRpbEVsZW1lbnRGb3VuZCIsImZpbGxJbnB1dCIsImZvcm1hdCIsIndhaXRGb3JOYXZpZ2F0aW9uIiwiZ2V0QWNjb3VudE51bWJlciIsInNlbGVjdGVkU25pZkFjY291bnQiLCJvcHRpb24iLCJjaGVja0lmSGFzTmV4dFBhZ2UiLCJuYXZpZ2F0ZVRvTmV4dFBhZ2UiLCJzY3JhcGVUcmFuc2FjdGlvbnMiLCJuZWVkVG9QYWdpbmF0ZSIsImhhc05leHRQYWdlIiwiY3VycmVudFBhZ2VUeG5zIiwiZ2V0QWNjb3VudFRyYW5zYWN0aW9ucyIsIlByb21pc2UiLCJyYWNlIiwibm9UcmFuc2FjdGlvbkluUmFuZ2VFcnJvciIsInBlbmRpbmdUeG5zIiwiVHJhbnNhY3Rpb25TdGF0dXNlcyIsIlBlbmRpbmciLCJjb21wbGV0ZWRUeG5zIiwiQ29tcGxldGVkIiwiZ2V0Q3VycmVudEJhbGFuY2UiLCJiYWxhbmNlU3RyIiwiZWwiLCJ3YWl0Rm9yUG9zdExvZ2luIiwiZmV0Y2hBY2NvdW50RGF0YSIsImFjY291bnROdW1iZXIiLCJiYWxhbmNlIiwiZ2V0QWNjb3VudElkc09sZFVJIiwiZXZhbHVhdGUiLCJzZWxlY3RFbGVtZW50IiwiZG9jdW1lbnQiLCJnZXRFbGVtZW50QnlJZCIsInF1ZXJ5U2VsZWN0b3JBbGwiLCJjbGlja0FjY291bnRTZWxlY3RvckdldEFjY291bnRJZHMiLCJhY2NvdW50U2VsZWN0b3IiLCJkcm9wZG93blBhbmVsU2VsZWN0b3IiLCJvcHRpb25TZWxlY3RvciIsImRyb3Bkb3duVmlzaWJsZSIsIndpbmRvdyIsImdldENvbXB1dGVkU3R5bGUiLCJkaXNwbGF5Iiwib2Zmc2V0UGFyZW50IiwiY2F0Y2giLCJhY2NvdW50TGFiZWxzIiwiJCRldmFsIiwidGV4dENvbnRlbnQiLCJmaWx0ZXIiLCJsYWJlbCIsImVycm9yIiwiZ2V0QWNjb3VudElkc0JvdGhVSXMiLCJhY2NvdW50c0lkcyIsImxlbmd0aCIsInNlbGVjdEFjY291bnRGcm9tRHJvcGRvd24iLCJhY2NvdW50TGFiZWwiLCJhdmFpbGFibGVBY2NvdW50cyIsImluY2x1ZGVzIiwiYWNjb3VudE9wdGlvbnMiLCIkJCIsInRleHQiLCJvcHRpb25IYW5kbGUiLCJldmFsdWF0ZUhhbmRsZSIsImNsaWNrIiwiZ2V0VHJhbnNhY3Rpb25zRnJhbWUiLCJhdHRlbXB0Iiwic2xlZXAiLCJmcmFtZXMiLCJ0YXJnZXRGcmFtZSIsImZpbmQiLCJmIiwibmFtZSIsInNlbGVjdEFjY291bnRCb3RoVUlzIiwiYWNjb3VudElkIiwiYWNjb3VudFNlbGVjdGVkIiwic2VsZWN0IiwiZmV0Y2hBY2NvdW50RGF0YUJvdGhVSXMiLCJmcmFtZSIsInRhcmdldFBhZ2UiLCJmZXRjaEFjY291bnRzIiwiYWNjb3VudERhdGEiLCJhY2NvdW50cyIsIkJlaW5sZXVtaUdyb3VwQmFzZVNjcmFwZXIiLCJCYXNlU2NyYXBlcldpdGhCcm93c2VyIiwiQkFTRV9VUkwiLCJMT0dJTl9VUkwiLCJUUkFOU0FDVElPTlNfVVJMIiwiZ2V0TG9naW5PcHRpb25zIiwibG9naW5VcmwiLCJmaWVsZHMiLCJzdWJtaXRCdXR0b25TZWxlY3RvciIsInBvc3RBY3Rpb24iLCJwb3NzaWJsZVJlc3VsdHMiLCJwcmVBY3Rpb24iLCJmZXRjaERhdGEiLCJkZWZhdWx0U3RhcnRNb21lbnQiLCJzdWJ0cmFjdCIsImFkZCIsInN0YXJ0TW9tZW50TGltaXQiLCJ5ZWFyIiwidG9EYXRlIiwic3RhcnRNb21lbnQiLCJtYXgiLCJuYXZpZ2F0ZVRvIiwic3VjY2VzcyIsIl9kZWZhdWx0IiwiZXhwb3J0cyJdLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9zY3JhcGVycy9iYXNlLWJlaW5sZXVtaS1ncm91cC50cyJdLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgbW9tZW50LCB7IHR5cGUgTW9tZW50IH0gZnJvbSAnbW9tZW50JztcbmltcG9ydCB7IHR5cGUgRnJhbWUsIHR5cGUgUGFnZSB9IGZyb20gJ3B1cHBldGVlcic7XG5pbXBvcnQgeyBTSEVLRUxfQ1VSUkVOQ1ksIFNIRUtFTF9DVVJSRU5DWV9TWU1CT0wgfSBmcm9tICcuLi9jb25zdGFudHMnO1xuaW1wb3J0IHtcbiAgY2xpY2tCdXR0b24sXG4gIGVsZW1lbnRQcmVzZW50T25QYWdlLFxuICBmaWxsSW5wdXQsXG4gIHBhZ2VFdmFsQWxsLFxuICB3YWl0VW50aWxFbGVtZW50Rm91bmQsXG59IGZyb20gJy4uL2hlbHBlcnMvZWxlbWVudHMtaW50ZXJhY3Rpb25zJztcbmltcG9ydCB7IHdhaXRGb3JOYXZpZ2F0aW9uIH0gZnJvbSAnLi4vaGVscGVycy9uYXZpZ2F0aW9uJztcbmltcG9ydCB7IGdldFJhd1RyYW5zYWN0aW9uIH0gZnJvbSAnLi4vaGVscGVycy90cmFuc2FjdGlvbnMnO1xuaW1wb3J0IHsgc2xlZXAgfSBmcm9tICcuLi9oZWxwZXJzL3dhaXRpbmcnO1xuaW1wb3J0IHsgVHJhbnNhY3Rpb25TdGF0dXNlcywgVHJhbnNhY3Rpb25UeXBlcywgdHlwZSBUcmFuc2FjdGlvbiwgdHlwZSBUcmFuc2FjdGlvbnNBY2NvdW50IH0gZnJvbSAnLi4vdHJhbnNhY3Rpb25zJztcbmltcG9ydCB7IEJhc2VTY3JhcGVyV2l0aEJyb3dzZXIsIExvZ2luUmVzdWx0cywgdHlwZSBQb3NzaWJsZUxvZ2luUmVzdWx0cyB9IGZyb20gJy4vYmFzZS1zY3JhcGVyLXdpdGgtYnJvd3Nlcic7XG5pbXBvcnQgeyB0eXBlIFNjcmFwZXJPcHRpb25zIH0gZnJvbSAnLi9pbnRlcmZhY2UnO1xuXG5jb25zdCBEQVRFX0ZPUk1BVCA9ICdERC9NTS9ZWVlZJztcbmNvbnN0IE5PX1RSQU5TQUNUSU9OX0lOX0RBVEVfUkFOR0VfVEVYVCA9ICfXnNeQINeg157XpteQ15Ug16DXqteV16DXmdedINeR16DXldep15Ag15TXnteR15XXp9epJztcbmNvbnN0IERBVEVfQ09MVU1OX0NMQVNTX0NPTVBMRVRFRCA9ICdkYXRlIGZpcnN0JztcbmNvbnN0IERBVEVfQ09MVU1OX0NMQVNTX1BFTkRJTkcgPSAnZmlyc3QgZGF0ZSc7XG5jb25zdCBERVNDUklQVElPTl9DT0xVTU5fQ0xBU1NfQ09NUExFVEVEID0gJ3JlZmVyZW5jZSB3cmFwX25vcm1hbCc7XG5jb25zdCBERVNDUklQVElPTl9DT0xVTU5fQ0xBU1NfUEVORElORyA9ICdkZXRhaWxzIHdyYXBfbm9ybWFsJztcbmNvbnN0IFJFRkVSRU5DRV9DT0xVTU5fQ0xBU1MgPSAnZGV0YWlscyc7XG5jb25zdCBERUJJVF9DT0xVTU5fQ0xBU1MgPSAnZGViaXQnO1xuY29uc3QgQ1JFRElUX0NPTFVNTl9DTEFTUyA9ICdjcmVkaXQnO1xuY29uc3QgRVJST1JfTUVTU0FHRV9DTEFTUyA9ICdOT19EQVRBJztcbmNvbnN0IEFDQ09VTlRTX05VTUJFUiA9ICdkaXYuZmliaV9hY2NvdW50IHNwYW4uYWNjX251bSc7XG5jb25zdCBDTE9TRV9TRUFSQ0hfQllfREFURVNfQlVUVE9OX0NMQVNTID0gJ3VpLWRhdGVwaWNrZXItY2xvc2UnO1xuY29uc3QgU0hPV19TRUFSQ0hfQllfREFURVNfQlVUVE9OX1ZBTFVFID0gJ9eU16bXkic7XG5jb25zdCBDT01QTEVURURfVFJBTlNBQ1RJT05TX1RBQkxFID0gJ3RhYmxlI2RhdGFUYWJsZTA3Nyc7XG5jb25zdCBQRU5ESU5HX1RSQU5TQUNUSU9OU19UQUJMRSA9ICd0YWJsZSNkYXRhVGFibGUwMjMnO1xuY29uc3QgTkVYVF9QQUdFX0xJTksgPSAnYSNOcGFnZS5wYWdpbmcnO1xuY29uc3QgQ1VSUkVOVF9CQUxBTkNFID0gJy5tYWluX2JhbGFuY2UnO1xuY29uc3QgSUZSQU1FX05BTUUgPSAnaWZyYW1lLW9sZC1wYWdlcyc7XG5jb25zdCBFTEVNRU5UX1JFTkRFUl9USU1FT1VUX01TID0gMTAwMDA7XG5cbnR5cGUgVHJhbnNhY3Rpb25zQ29sc1R5cGVzID0gUmVjb3JkPHN0cmluZywgbnVtYmVyPjtcbnR5cGUgVHJhbnNhY3Rpb25zVHJUZHMgPSBzdHJpbmdbXTtcbnR5cGUgVHJhbnNhY3Rpb25zVHIgPSB7IGlubmVyVGRzOiBUcmFuc2FjdGlvbnNUclRkcyB9O1xuXG5pbnRlcmZhY2UgU2NyYXBlZFRyYW5zYWN0aW9uIHtcbiAgcmVmZXJlbmNlOiBzdHJpbmc7XG4gIGRhdGU6IHN0cmluZztcbiAgY3JlZGl0OiBzdHJpbmc7XG4gIGRlYml0OiBzdHJpbmc7XG4gIG1lbW8/OiBzdHJpbmc7XG4gIGRlc2NyaXB0aW9uOiBzdHJpbmc7XG4gIHN0YXR1czogVHJhbnNhY3Rpb25TdGF0dXNlcztcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGdldFBvc3NpYmxlTG9naW5SZXN1bHRzKCk6IFBvc3NpYmxlTG9naW5SZXN1bHRzIHtcbiAgY29uc3QgdXJsczogUG9zc2libGVMb2dpblJlc3VsdHMgPSB7fTtcbiAgdXJsc1tMb2dpblJlc3VsdHMuU3VjY2Vzc10gPSBbXG4gICAgL2ZpYmkuKmFjY291bnRTdW1tYXJ5LywgLy8gTmV3IFVJIHBhdHRlcm5cbiAgICAvUmVzb3VyY2VzXFwvUG9ydGFsTkdcXC9zaGVsbC8sIC8vIE5ldyBVSSBwYXR0ZXJuXG4gICAgL0ZpYmlNZW51XFwvT25saW5lLywgLy8gT2xkIFVJIHBhdHRlcm5cbiAgXTtcbiAgdXJsc1tMb2dpblJlc3VsdHMuSW52YWxpZFBhc3N3b3JkXSA9IFsvRmliaU1lbnVcXC9NYXJrZXRpbmdcXC9Qcml2YXRlXFwvSG9tZS9dO1xuICByZXR1cm4gdXJscztcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZUxvZ2luRmllbGRzKGNyZWRlbnRpYWxzOiBTY3JhcGVyU3BlY2lmaWNDcmVkZW50aWFscykge1xuICByZXR1cm4gW1xuICAgIHsgc2VsZWN0b3I6ICcjdXNlcm5hbWUnLCB2YWx1ZTogY3JlZGVudGlhbHMudXNlcm5hbWUgfSxcbiAgICB7IHNlbGVjdG9yOiAnI3Bhc3N3b3JkJywgdmFsdWU6IGNyZWRlbnRpYWxzLnBhc3N3b3JkIH0sXG4gIF07XG59XG5cbmZ1bmN0aW9uIGdldEFtb3VudERhdGEoYW1vdW50U3RyOiBzdHJpbmcpIHtcbiAgbGV0IGFtb3VudFN0ckNvcHkgPSBhbW91bnRTdHIucmVwbGFjZShTSEVLRUxfQ1VSUkVOQ1lfU1lNQk9MLCAnJyk7XG4gIGFtb3VudFN0ckNvcHkgPSBhbW91bnRTdHJDb3B5LnJlcGxhY2VBbGwoJywnLCAnJyk7XG4gIHJldHVybiBwYXJzZUZsb2F0KGFtb3VudFN0ckNvcHkpO1xufVxuXG5mdW5jdGlvbiBnZXRUeG5BbW91bnQodHhuOiBTY3JhcGVkVHJhbnNhY3Rpb24pIHtcbiAgY29uc3QgY3JlZGl0ID0gZ2V0QW1vdW50RGF0YSh0eG4uY3JlZGl0KTtcbiAgY29uc3QgZGViaXQgPSBnZXRBbW91bnREYXRhKHR4bi5kZWJpdCk7XG4gIHJldHVybiAoTnVtYmVyLmlzTmFOKGNyZWRpdCkgPyAwIDogY3JlZGl0KSAtIChOdW1iZXIuaXNOYU4oZGViaXQpID8gMCA6IGRlYml0KTtcbn1cblxuZnVuY3Rpb24gY29udmVydFRyYW5zYWN0aW9ucyh0eG5zOiBTY3JhcGVkVHJhbnNhY3Rpb25bXSwgb3B0aW9ucz86IFNjcmFwZXJPcHRpb25zKTogVHJhbnNhY3Rpb25bXSB7XG4gIHJldHVybiB0eG5zLm1hcCgodHhuKTogVHJhbnNhY3Rpb24gPT4ge1xuICAgIGNvbnN0IGNvbnZlcnRlZERhdGUgPSBtb21lbnQodHhuLmRhdGUsIERBVEVfRk9STUFUKS50b0lTT1N0cmluZygpO1xuICAgIGNvbnN0IGNvbnZlcnRlZEFtb3VudCA9IGdldFR4bkFtb3VudCh0eG4pO1xuICAgIGNvbnN0IHJlc3VsdDogVHJhbnNhY3Rpb24gPSB7XG4gICAgICB0eXBlOiBUcmFuc2FjdGlvblR5cGVzLk5vcm1hbCxcbiAgICAgIGlkZW50aWZpZXI6IHR4bi5yZWZlcmVuY2UgPyBwYXJzZUludCh0eG4ucmVmZXJlbmNlLCAxMCkgOiB1bmRlZmluZWQsXG4gICAgICBkYXRlOiBjb252ZXJ0ZWREYXRlLFxuICAgICAgcHJvY2Vzc2VkRGF0ZTogY29udmVydGVkRGF0ZSxcbiAgICAgIG9yaWdpbmFsQW1vdW50OiBjb252ZXJ0ZWRBbW91bnQsXG4gICAgICBvcmlnaW5hbEN1cnJlbmN5OiBTSEVLRUxfQ1VSUkVOQ1ksXG4gICAgICBjaGFyZ2VkQW1vdW50OiBjb252ZXJ0ZWRBbW91bnQsXG4gICAgICBzdGF0dXM6IHR4bi5zdGF0dXMsXG4gICAgICBkZXNjcmlwdGlvbjogdHhuLmRlc2NyaXB0aW9uLFxuICAgICAgbWVtbzogdHhuLm1lbW8sXG4gICAgfTtcblxuICAgIGlmIChvcHRpb25zPy5pbmNsdWRlUmF3VHJhbnNhY3Rpb24pIHtcbiAgICAgIHJlc3VsdC5yYXdUcmFuc2FjdGlvbiA9IGdldFJhd1RyYW5zYWN0aW9uKHR4bik7XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfSk7XG59XG5cbmZ1bmN0aW9uIGdldFRyYW5zYWN0aW9uRGF0ZShcbiAgdGRzOiBUcmFuc2FjdGlvbnNUclRkcyxcbiAgdHJhbnNhY3Rpb25UeXBlOiBzdHJpbmcsXG4gIHRyYW5zYWN0aW9uc0NvbHNUeXBlczogVHJhbnNhY3Rpb25zQ29sc1R5cGVzLFxuKSB7XG4gIGlmICh0cmFuc2FjdGlvblR5cGUgPT09ICdjb21wbGV0ZWQnKSB7XG4gICAgcmV0dXJuICh0ZHNbdHJhbnNhY3Rpb25zQ29sc1R5cGVzW0RBVEVfQ09MVU1OX0NMQVNTX0NPTVBMRVRFRF1dIHx8ICcnKS50cmltKCk7XG4gIH1cbiAgcmV0dXJuICh0ZHNbdHJhbnNhY3Rpb25zQ29sc1R5cGVzW0RBVEVfQ09MVU1OX0NMQVNTX1BFTkRJTkddXSB8fCAnJykudHJpbSgpO1xufVxuXG5mdW5jdGlvbiBnZXRUcmFuc2FjdGlvbkRlc2NyaXB0aW9uKFxuICB0ZHM6IFRyYW5zYWN0aW9uc1RyVGRzLFxuICB0cmFuc2FjdGlvblR5cGU6IHN0cmluZyxcbiAgdHJhbnNhY3Rpb25zQ29sc1R5cGVzOiBUcmFuc2FjdGlvbnNDb2xzVHlwZXMsXG4pIHtcbiAgaWYgKHRyYW5zYWN0aW9uVHlwZSA9PT0gJ2NvbXBsZXRlZCcpIHtcbiAgICByZXR1cm4gKHRkc1t0cmFuc2FjdGlvbnNDb2xzVHlwZXNbREVTQ1JJUFRJT05fQ09MVU1OX0NMQVNTX0NPTVBMRVRFRF1dIHx8ICcnKS50cmltKCk7XG4gIH1cbiAgcmV0dXJuICh0ZHNbdHJhbnNhY3Rpb25zQ29sc1R5cGVzW0RFU0NSSVBUSU9OX0NPTFVNTl9DTEFTU19QRU5ESU5HXV0gfHwgJycpLnRyaW0oKTtcbn1cblxuZnVuY3Rpb24gZ2V0VHJhbnNhY3Rpb25SZWZlcmVuY2UodGRzOiBUcmFuc2FjdGlvbnNUclRkcywgdHJhbnNhY3Rpb25zQ29sc1R5cGVzOiBUcmFuc2FjdGlvbnNDb2xzVHlwZXMpIHtcbiAgcmV0dXJuICh0ZHNbdHJhbnNhY3Rpb25zQ29sc1R5cGVzW1JFRkVSRU5DRV9DT0xVTU5fQ0xBU1NdXSB8fCAnJykudHJpbSgpO1xufVxuXG5mdW5jdGlvbiBnZXRUcmFuc2FjdGlvbkRlYml0KHRkczogVHJhbnNhY3Rpb25zVHJUZHMsIHRyYW5zYWN0aW9uc0NvbHNUeXBlczogVHJhbnNhY3Rpb25zQ29sc1R5cGVzKSB7XG4gIHJldHVybiAodGRzW3RyYW5zYWN0aW9uc0NvbHNUeXBlc1tERUJJVF9DT0xVTU5fQ0xBU1NdXSB8fCAnJykudHJpbSgpO1xufVxuXG5mdW5jdGlvbiBnZXRUcmFuc2FjdGlvbkNyZWRpdCh0ZHM6IFRyYW5zYWN0aW9uc1RyVGRzLCB0cmFuc2FjdGlvbnNDb2xzVHlwZXM6IFRyYW5zYWN0aW9uc0NvbHNUeXBlcykge1xuICByZXR1cm4gKHRkc1t0cmFuc2FjdGlvbnNDb2xzVHlwZXNbQ1JFRElUX0NPTFVNTl9DTEFTU11dIHx8ICcnKS50cmltKCk7XG59XG5cbmZ1bmN0aW9uIGV4dHJhY3RUcmFuc2FjdGlvbkRldGFpbHMoXG4gIHR4blJvdzogVHJhbnNhY3Rpb25zVHIsXG4gIHRyYW5zYWN0aW9uU3RhdHVzOiBUcmFuc2FjdGlvblN0YXR1c2VzLFxuICB0cmFuc2FjdGlvbnNDb2xzVHlwZXM6IFRyYW5zYWN0aW9uc0NvbHNUeXBlcyxcbik6IFNjcmFwZWRUcmFuc2FjdGlvbiB7XG4gIGNvbnN0IHRkcyA9IHR4blJvdy5pbm5lclRkcztcbiAgY29uc3QgaXRlbSA9IHtcbiAgICBzdGF0dXM6IHRyYW5zYWN0aW9uU3RhdHVzLFxuICAgIGRhdGU6IGdldFRyYW5zYWN0aW9uRGF0ZSh0ZHMsIHRyYW5zYWN0aW9uU3RhdHVzLCB0cmFuc2FjdGlvbnNDb2xzVHlwZXMpLFxuICAgIGRlc2NyaXB0aW9uOiBnZXRUcmFuc2FjdGlvbkRlc2NyaXB0aW9uKHRkcywgdHJhbnNhY3Rpb25TdGF0dXMsIHRyYW5zYWN0aW9uc0NvbHNUeXBlcyksXG4gICAgcmVmZXJlbmNlOiBnZXRUcmFuc2FjdGlvblJlZmVyZW5jZSh0ZHMsIHRyYW5zYWN0aW9uc0NvbHNUeXBlcyksXG4gICAgZGViaXQ6IGdldFRyYW5zYWN0aW9uRGViaXQodGRzLCB0cmFuc2FjdGlvbnNDb2xzVHlwZXMpLFxuICAgIGNyZWRpdDogZ2V0VHJhbnNhY3Rpb25DcmVkaXQodGRzLCB0cmFuc2FjdGlvbnNDb2xzVHlwZXMpLFxuICB9O1xuXG4gIHJldHVybiBpdGVtO1xufVxuXG5hc3luYyBmdW5jdGlvbiBnZXRUcmFuc2FjdGlvbnNDb2xzVHlwZUNsYXNzZXMoXG4gIHBhZ2U6IFBhZ2UgfCBGcmFtZSxcbiAgdGFibGVMb2NhdG9yOiBzdHJpbmcsXG4pOiBQcm9taXNlPFRyYW5zYWN0aW9uc0NvbHNUeXBlcz4ge1xuICBjb25zdCByZXN1bHQ6IFRyYW5zYWN0aW9uc0NvbHNUeXBlcyA9IHt9O1xuICBjb25zdCB0eXBlQ2xhc3Nlc09ianMgPSBhd2FpdCBwYWdlRXZhbEFsbChwYWdlLCBgJHt0YWJsZUxvY2F0b3J9IHRib2R5IHRyOmZpcnN0LW9mLXR5cGUgdGRgLCBudWxsLCB0ZHMgPT4ge1xuICAgIHJldHVybiB0ZHMubWFwKCh0ZCwgaW5kZXgpID0+ICh7XG4gICAgICBjb2xDbGFzczogdGQuZ2V0QXR0cmlidXRlKCdjbGFzcycpLFxuICAgICAgaW5kZXgsXG4gICAgfSkpO1xuICB9KTtcblxuICBmb3IgKGNvbnN0IHR5cGVDbGFzc09iaiBvZiB0eXBlQ2xhc3Nlc09ianMpIHtcbiAgICBpZiAodHlwZUNsYXNzT2JqLmNvbENsYXNzKSB7XG4gICAgICByZXN1bHRbdHlwZUNsYXNzT2JqLmNvbENsYXNzXSA9IHR5cGVDbGFzc09iai5pbmRleDtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHJlc3VsdDtcbn1cblxuZnVuY3Rpb24gZXh0cmFjdFRyYW5zYWN0aW9uKFxuICB0eG5zOiBTY3JhcGVkVHJhbnNhY3Rpb25bXSxcbiAgdHJhbnNhY3Rpb25TdGF0dXM6IFRyYW5zYWN0aW9uU3RhdHVzZXMsXG4gIHR4blJvdzogVHJhbnNhY3Rpb25zVHIsXG4gIHRyYW5zYWN0aW9uc0NvbHNUeXBlczogVHJhbnNhY3Rpb25zQ29sc1R5cGVzLFxuKSB7XG4gIGNvbnN0IHR4biA9IGV4dHJhY3RUcmFuc2FjdGlvbkRldGFpbHModHhuUm93LCB0cmFuc2FjdGlvblN0YXR1cywgdHJhbnNhY3Rpb25zQ29sc1R5cGVzKTtcbiAgaWYgKHR4bi5kYXRlICE9PSAnJykge1xuICAgIHR4bnMucHVzaCh0eG4pO1xuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGV4dHJhY3RUcmFuc2FjdGlvbnMocGFnZTogUGFnZSB8IEZyYW1lLCB0YWJsZUxvY2F0b3I6IHN0cmluZywgdHJhbnNhY3Rpb25TdGF0dXM6IFRyYW5zYWN0aW9uU3RhdHVzZXMpIHtcbiAgY29uc3QgdHhuczogU2NyYXBlZFRyYW5zYWN0aW9uW10gPSBbXTtcbiAgY29uc3QgdHJhbnNhY3Rpb25zQ29sc1R5cGVzID0gYXdhaXQgZ2V0VHJhbnNhY3Rpb25zQ29sc1R5cGVDbGFzc2VzKHBhZ2UsIHRhYmxlTG9jYXRvcik7XG5cbiAgY29uc3QgdHJhbnNhY3Rpb25zUm93cyA9IGF3YWl0IHBhZ2VFdmFsQWxsPFRyYW5zYWN0aW9uc1RyW10+KHBhZ2UsIGAke3RhYmxlTG9jYXRvcn0gdGJvZHkgdHJgLCBbXSwgdHJzID0+IHtcbiAgICByZXR1cm4gdHJzLm1hcCh0ciA9PiAoe1xuICAgICAgaW5uZXJUZHM6IEFycmF5LmZyb20odHIuZ2V0RWxlbWVudHNCeVRhZ05hbWUoJ3RkJykpLm1hcCh0ZCA9PiB0ZC5pbm5lclRleHQpLFxuICAgIH0pKTtcbiAgfSk7XG5cbiAgZm9yIChjb25zdCB0eG5Sb3cgb2YgdHJhbnNhY3Rpb25zUm93cykge1xuICAgIGV4dHJhY3RUcmFuc2FjdGlvbih0eG5zLCB0cmFuc2FjdGlvblN0YXR1cywgdHhuUm93LCB0cmFuc2FjdGlvbnNDb2xzVHlwZXMpO1xuICB9XG4gIHJldHVybiB0eG5zO1xufVxuXG5hc3luYyBmdW5jdGlvbiBpc05vVHJhbnNhY3Rpb25JbkRhdGVSYW5nZUVycm9yKHBhZ2U6IFBhZ2UgfCBGcmFtZSkge1xuICBjb25zdCBoYXNFcnJvckluZm9FbGVtZW50ID0gYXdhaXQgZWxlbWVudFByZXNlbnRPblBhZ2UocGFnZSwgYC4ke0VSUk9SX01FU1NBR0VfQ0xBU1N9YCk7XG4gIGlmIChoYXNFcnJvckluZm9FbGVtZW50KSB7XG4gICAgY29uc3QgZXJyb3JUZXh0ID0gYXdhaXQgcGFnZS4kZXZhbChgLiR7RVJST1JfTUVTU0FHRV9DTEFTU31gLCBlcnJvckVsZW1lbnQgPT4ge1xuICAgICAgcmV0dXJuIChlcnJvckVsZW1lbnQgYXMgSFRNTEVsZW1lbnQpLmlubmVyVGV4dDtcbiAgICB9KTtcbiAgICByZXR1cm4gZXJyb3JUZXh0LnRyaW0oKSA9PT0gTk9fVFJBTlNBQ1RJT05fSU5fREFURV9SQU5HRV9URVhUO1xuICB9XG4gIHJldHVybiBmYWxzZTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gc2VhcmNoQnlEYXRlcyhwYWdlOiBQYWdlIHwgRnJhbWUsIHN0YXJ0RGF0ZTogTW9tZW50KSB7XG4gIGF3YWl0IGNsaWNrQnV0dG9uKHBhZ2UsICdhI3RhYkhlYWRlcjQnKTtcbiAgYXdhaXQgd2FpdFVudGlsRWxlbWVudEZvdW5kKHBhZ2UsICdkaXYjZmliaV9kYXRlcycpO1xuICBhd2FpdCBmaWxsSW5wdXQocGFnZSwgJ2lucHV0I2Zyb21EYXRlJywgc3RhcnREYXRlLmZvcm1hdChEQVRFX0ZPUk1BVCkpO1xuICBhd2FpdCBjbGlja0J1dHRvbihwYWdlLCBgYnV0dG9uW2NsYXNzKj0ke0NMT1NFX1NFQVJDSF9CWV9EQVRFU19CVVRUT05fQ0xBU1N9XWApO1xuICBhd2FpdCBjbGlja0J1dHRvbihwYWdlLCBgaW5wdXRbdmFsdWU9JHtTSE9XX1NFQVJDSF9CWV9EQVRFU19CVVRUT05fVkFMVUV9XWApO1xuICBhd2FpdCB3YWl0Rm9yTmF2aWdhdGlvbihwYWdlKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZ2V0QWNjb3VudE51bWJlcihwYWdlOiBQYWdlIHwgRnJhbWUpOiBQcm9taXNlPHN0cmluZz4ge1xuICAvLyBXYWl0IHVudGlsIHRoZSBhY2NvdW50IG51bWJlciBlbGVtZW50IGlzIHByZXNlbnQgaW4gdGhlIERPTVxuICBhd2FpdCB3YWl0VW50aWxFbGVtZW50Rm91bmQocGFnZSwgQUNDT1VOVFNfTlVNQkVSLCB0cnVlLCBFTEVNRU5UX1JFTkRFUl9USU1FT1VUX01TKTtcblxuICBjb25zdCBzZWxlY3RlZFNuaWZBY2NvdW50ID0gYXdhaXQgcGFnZS4kZXZhbChBQ0NPVU5UU19OVU1CRVIsIG9wdGlvbiA9PiB7XG4gICAgcmV0dXJuIChvcHRpb24gYXMgSFRNTEVsZW1lbnQpLmlubmVyVGV4dDtcbiAgfSk7XG5cbiAgcmV0dXJuIHNlbGVjdGVkU25pZkFjY291bnQucmVwbGFjZSgnLycsICdfJykudHJpbSgpO1xufVxuXG5hc3luYyBmdW5jdGlvbiBjaGVja0lmSGFzTmV4dFBhZ2UocGFnZTogUGFnZSB8IEZyYW1lKSB7XG4gIHJldHVybiBlbGVtZW50UHJlc2VudE9uUGFnZShwYWdlLCBORVhUX1BBR0VfTElOSyk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIG5hdmlnYXRlVG9OZXh0UGFnZShwYWdlOiBQYWdlIHwgRnJhbWUpIHtcbiAgYXdhaXQgY2xpY2tCdXR0b24ocGFnZSwgTkVYVF9QQUdFX0xJTkspO1xuICBhd2FpdCB3YWl0Rm9yTmF2aWdhdGlvbihwYWdlKTtcbn1cblxuLyogQ291bGRuJ3QgcmVwcm9kdWNlIHNjZW5hcmlvIHdpdGggbXVsdGlwbGUgcGFnZXMgb2YgcGVuZGluZyB0cmFuc2FjdGlvbnMgLSBTaG91bGQgc3VwcG9ydCBpZiBleGlzdHMgc3VjaCBjYXNlLlxuICAgbmVlZFRvUGFnaW5hdGUgaXMgZmFsc2UgaWYgc2NyYXBpbmcgcGVuZGluZyB0cmFuc2FjdGlvbnMgKi9cbmFzeW5jIGZ1bmN0aW9uIHNjcmFwZVRyYW5zYWN0aW9ucyhcbiAgcGFnZTogUGFnZSB8IEZyYW1lLFxuICB0YWJsZUxvY2F0b3I6IHN0cmluZyxcbiAgdHJhbnNhY3Rpb25TdGF0dXM6IFRyYW5zYWN0aW9uU3RhdHVzZXMsXG4gIG5lZWRUb1BhZ2luYXRlOiBib29sZWFuLFxuICBvcHRpb25zPzogU2NyYXBlck9wdGlvbnMsXG4pIHtcbiAgY29uc3QgdHhucyA9IFtdO1xuICBsZXQgaGFzTmV4dFBhZ2UgPSBmYWxzZTtcblxuICBkbyB7XG4gICAgY29uc3QgY3VycmVudFBhZ2VUeG5zID0gYXdhaXQgZXh0cmFjdFRyYW5zYWN0aW9ucyhwYWdlLCB0YWJsZUxvY2F0b3IsIHRyYW5zYWN0aW9uU3RhdHVzKTtcbiAgICB0eG5zLnB1c2goLi4uY3VycmVudFBhZ2VUeG5zKTtcbiAgICBpZiAobmVlZFRvUGFnaW5hdGUpIHtcbiAgICAgIGhhc05leHRQYWdlID0gYXdhaXQgY2hlY2tJZkhhc05leHRQYWdlKHBhZ2UpO1xuICAgICAgaWYgKGhhc05leHRQYWdlKSB7XG4gICAgICAgIGF3YWl0IG5hdmlnYXRlVG9OZXh0UGFnZShwYWdlKTtcbiAgICAgIH1cbiAgICB9XG4gIH0gd2hpbGUgKGhhc05leHRQYWdlKTtcblxuICByZXR1cm4gY29udmVydFRyYW5zYWN0aW9ucyh0eG5zLCBvcHRpb25zKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZ2V0QWNjb3VudFRyYW5zYWN0aW9ucyhwYWdlOiBQYWdlIHwgRnJhbWUsIG9wdGlvbnM/OiBTY3JhcGVyT3B0aW9ucykge1xuICBhd2FpdCBQcm9taXNlLnJhY2UoW1xuICAgIHdhaXRVbnRpbEVsZW1lbnRGb3VuZChwYWdlLCBcImRpdltpZCo9J2RpdlRhYmxlJ11cIiwgZmFsc2UpLFxuICAgIHdhaXRVbnRpbEVsZW1lbnRGb3VuZChwYWdlLCBgLiR7RVJST1JfTUVTU0FHRV9DTEFTU31gLCBmYWxzZSksXG4gIF0pO1xuXG4gIGNvbnN0IG5vVHJhbnNhY3Rpb25JblJhbmdlRXJyb3IgPSBhd2FpdCBpc05vVHJhbnNhY3Rpb25JbkRhdGVSYW5nZUVycm9yKHBhZ2UpO1xuICBpZiAobm9UcmFuc2FjdGlvbkluUmFuZ2VFcnJvcikge1xuICAgIHJldHVybiBbXTtcbiAgfVxuXG4gIGNvbnN0IHBlbmRpbmdUeG5zID0gYXdhaXQgc2NyYXBlVHJhbnNhY3Rpb25zKFxuICAgIHBhZ2UsXG4gICAgUEVORElOR19UUkFOU0FDVElPTlNfVEFCTEUsXG4gICAgVHJhbnNhY3Rpb25TdGF0dXNlcy5QZW5kaW5nLFxuICAgIGZhbHNlLFxuICAgIG9wdGlvbnMsXG4gICk7XG4gIGNvbnN0IGNvbXBsZXRlZFR4bnMgPSBhd2FpdCBzY3JhcGVUcmFuc2FjdGlvbnMoXG4gICAgcGFnZSxcbiAgICBDT01QTEVURURfVFJBTlNBQ1RJT05TX1RBQkxFLFxuICAgIFRyYW5zYWN0aW9uU3RhdHVzZXMuQ29tcGxldGVkLFxuICAgIHRydWUsXG4gICAgb3B0aW9ucyxcbiAgKTtcbiAgY29uc3QgdHhucyA9IFsuLi5wZW5kaW5nVHhucywgLi4uY29tcGxldGVkVHhuc107XG4gIHJldHVybiB0eG5zO1xufVxuXG5hc3luYyBmdW5jdGlvbiBnZXRDdXJyZW50QmFsYW5jZShwYWdlOiBQYWdlIHwgRnJhbWUpOiBQcm9taXNlPG51bWJlcj4ge1xuICAvLyBXYWl0IGZvciB0aGUgYmFsYW5jZSBlbGVtZW50IHRvIGFwcGVhciBhbmQgYmUgdmlzaWJsZVxuICBhd2FpdCB3YWl0VW50aWxFbGVtZW50Rm91bmQocGFnZSwgQ1VSUkVOVF9CQUxBTkNFLCB0cnVlLCBFTEVNRU5UX1JFTkRFUl9USU1FT1VUX01TKTtcblxuICAvLyBFeHRyYWN0IHRleHQgY29udGVudFxuICBjb25zdCBiYWxhbmNlU3RyID0gYXdhaXQgcGFnZS4kZXZhbChDVVJSRU5UX0JBTEFOQ0UsIGVsID0+IHtcbiAgICByZXR1cm4gKGVsIGFzIEhUTUxFbGVtZW50KS5pbm5lclRleHQ7XG4gIH0pO1xuXG4gIHJldHVybiBnZXRBbW91bnREYXRhKGJhbGFuY2VTdHIpO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gd2FpdEZvclBvc3RMb2dpbihwYWdlOiBQYWdlKSB7XG4gIHJldHVybiBQcm9taXNlLnJhY2UoW1xuICAgIHdhaXRVbnRpbEVsZW1lbnRGb3VuZChwYWdlLCAnI2NhcmQtaGVhZGVyJywgZmFsc2UpLCAvLyBOZXcgVUlcbiAgICB3YWl0VW50aWxFbGVtZW50Rm91bmQocGFnZSwgJyNhY2NvdW50X251bScsIHRydWUpLCAvLyBOZXcgVUlcbiAgICB3YWl0VW50aWxFbGVtZW50Rm91bmQocGFnZSwgJyNtYXRhZkxvZ291dExpbmsnLCB0cnVlKSwgLy8gT2xkIFVJXG4gICAgd2FpdFVudGlsRWxlbWVudEZvdW5kKHBhZ2UsICcjdmFsaWRhdGlvbk1zZycsIHRydWUpLCAvLyBPbGQgVUlcbiAgXSk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGZldGNoQWNjb3VudERhdGEocGFnZTogUGFnZSB8IEZyYW1lLCBzdGFydERhdGU6IE1vbWVudCwgb3B0aW9ucz86IFNjcmFwZXJPcHRpb25zKSB7XG4gIGNvbnN0IGFjY291bnROdW1iZXIgPSBhd2FpdCBnZXRBY2NvdW50TnVtYmVyKHBhZ2UpO1xuICBjb25zdCBiYWxhbmNlID0gYXdhaXQgZ2V0Q3VycmVudEJhbGFuY2UocGFnZSk7XG4gIGF3YWl0IHNlYXJjaEJ5RGF0ZXMocGFnZSwgc3RhcnREYXRlKTtcbiAgY29uc3QgdHhucyA9IGF3YWl0IGdldEFjY291bnRUcmFuc2FjdGlvbnMocGFnZSwgb3B0aW9ucyk7XG5cbiAgcmV0dXJuIHtcbiAgICBhY2NvdW50TnVtYmVyLFxuICAgIHR4bnMsXG4gICAgYmFsYW5jZSxcbiAgfTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZ2V0QWNjb3VudElkc09sZFVJKHBhZ2U6IFBhZ2UpOiBQcm9taXNlPHN0cmluZ1tdPiB7XG4gIHJldHVybiBwYWdlLmV2YWx1YXRlKCgpID0+IHtcbiAgICBjb25zdCBzZWxlY3RFbGVtZW50ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2FjY291bnRfbnVtX3NlbGVjdCcpO1xuICAgIGNvbnN0IG9wdGlvbnMgPSBzZWxlY3RFbGVtZW50ID8gc2VsZWN0RWxlbWVudC5xdWVyeVNlbGVjdG9yQWxsKCdvcHRpb24nKSA6IFtdO1xuICAgIGlmICghb3B0aW9ucykgcmV0dXJuIFtdO1xuICAgIHJldHVybiBBcnJheS5mcm9tKG9wdGlvbnMsIG9wdGlvbiA9PiBvcHRpb24udmFsdWUpO1xuICB9KTtcbn1cblxuLyoqXG4gKiBFbnN1cmVzIHRoZSBhY2NvdW50IGRyb3Bkb3duIGlzIG9wZW4sIHRoZW4gcmV0dXJucyB0aGUgYXZhaWxhYmxlIGFjY291bnQgbGFiZWxzLlxuICpcbiAqIFRoaXMgbWV0aG9kOlxuICogLSBDaGVja3MgaWYgdGhlIGRyb3Bkb3duIGlzIGFscmVhZHkgb3Blbi5cbiAqIC0gSWYgbm90IG9wZW4sIGNsaWNrcyB0aGUgYWNjb3VudCBzZWxlY3RvciB0byBvcGVuIGl0LlxuICogLSBXYWl0cyBmb3IgdGhlIGRyb3Bkb3duIHRvIHJlbmRlci5cbiAqIC0gRXh0cmFjdHMgYW5kIHJldHVybnMgdGhlIGxpc3Qgb2YgYXZhaWxhYmxlIGFjY291bnQgbGFiZWxzLlxuICpcbiAqIEdyYWNlZnVsIGhhbmRsaW5nOlxuICogLSBJZiBhbnkgZXJyb3Igb2NjdXJzIChlLmcuLCBzZWxlY3RvcnMgbm90IGZvdW5kLCB0aW1pbmcgaXNzdWVzLCBVSSB2ZXJzaW9uIGNoYW5nZXMpLFxuICogICB0aGUgZnVuY3Rpb24gcmV0dXJucyBhbiBlbXB0eSBsaXN0LlxuICpcbiAqIEBwYXJhbSBwYWdlIFB1cHBldGVlciBQYWdlIG9iamVjdC5cbiAqIEByZXR1cm5zIEFuIGFycmF5IG9mIGF2YWlsYWJsZSBhY2NvdW50IGxhYmVscyAoZS5nLiwgW1wiMTI3IHwgWFhYWDFcIiwgXCIxMjcgfCBYWFhYMlwiXSksXG4gKiAgICAgICAgICBvciBhbiBlbXB0eSBhcnJheSBpZiBzb21ldGhpbmcgZ29lcyB3cm9uZy5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGNsaWNrQWNjb3VudFNlbGVjdG9yR2V0QWNjb3VudElkcyhwYWdlOiBQYWdlKTogUHJvbWlzZTxzdHJpbmdbXT4ge1xuICB0cnkge1xuICAgIGNvbnN0IGFjY291bnRTZWxlY3RvciA9ICdkaXYuY3VycmVudC1hY2NvdW50JzsgLy8gRGlyZWN0IHNlbGVjdG9yIHRvIGNsaWNrYWJsZSBlbGVtZW50XG4gICAgY29uc3QgZHJvcGRvd25QYW5lbFNlbGVjdG9yID0gJ2Rpdi5tYXQtbWRjLWF1dG9jb21wbGV0ZS1wYW5lbC5hY2NvdW50LXNlbGVjdC1kZCc7IC8vIFRoZSBkcm9wZG93biBsaXN0IGJveFxuICAgIGNvbnN0IG9wdGlvblNlbGVjdG9yID0gJ21hdC1vcHRpb24gLm1kYy1saXN0LWl0ZW1fX3ByaW1hcnktdGV4dCc7IC8vIEFjY291bnQgb3B0aW9uIGxhYmVsc1xuXG4gICAgLy8gQ2hlY2sgaWYgZHJvcGRvd24gaXMgYWxyZWFkeSBvcGVuXG4gICAgY29uc3QgZHJvcGRvd25WaXNpYmxlID0gYXdhaXQgcGFnZVxuICAgICAgLiRldmFsKGRyb3Bkb3duUGFuZWxTZWxlY3RvciwgZWwgPT4ge1xuICAgICAgICByZXR1cm4gZWwgJiYgd2luZG93LmdldENvbXB1dGVkU3R5bGUoZWwpLmRpc3BsYXkgIT09ICdub25lJyAmJiBlbC5vZmZzZXRQYXJlbnQgIT09IG51bGw7XG4gICAgICB9KVxuICAgICAgLmNhdGNoKCgpID0+IGZhbHNlKTsgLy8gY2F0Y2ggaWYgZHJvcGRvd24gaXMgbm90IGluIHRoZSBET00geWV0XG5cbiAgICBpZiAoIWRyb3Bkb3duVmlzaWJsZSkge1xuICAgICAgYXdhaXQgd2FpdFVudGlsRWxlbWVudEZvdW5kKHBhZ2UsIGFjY291bnRTZWxlY3RvciwgdHJ1ZSwgRUxFTUVOVF9SRU5ERVJfVElNRU9VVF9NUyk7XG5cbiAgICAgIC8vIENsaWNrIHRoZSBhY2NvdW50IHNlbGVjdG9yIHRvIG9wZW4gdGhlIGRyb3Bkb3duXG4gICAgICBhd2FpdCBjbGlja0J1dHRvbihwYWdlLCBhY2NvdW50U2VsZWN0b3IpO1xuXG4gICAgICAvLyBXYWl0IGZvciB0aGUgZHJvcGRvd24gdG8gb3BlblxuICAgICAgYXdhaXQgd2FpdFVudGlsRWxlbWVudEZvdW5kKHBhZ2UsIGRyb3Bkb3duUGFuZWxTZWxlY3RvciwgdHJ1ZSwgRUxFTUVOVF9SRU5ERVJfVElNRU9VVF9NUyk7XG4gICAgfVxuXG4gICAgLy8gRXh0cmFjdCBhY2NvdW50IGxhYmVscyBmcm9tIHRoZSBkcm9wZG93biBvcHRpb25zXG4gICAgY29uc3QgYWNjb3VudExhYmVscyA9IGF3YWl0IHBhZ2UuJCRldmFsKG9wdGlvblNlbGVjdG9yLCBvcHRpb25zID0+IHtcbiAgICAgIHJldHVybiBvcHRpb25zLm1hcChvcHRpb24gPT4gb3B0aW9uLnRleHRDb250ZW50Py50cmltKCkgfHwgJycpLmZpbHRlcihsYWJlbCA9PiBsYWJlbCAhPT0gJycpO1xuICAgIH0pO1xuXG4gICAgcmV0dXJuIGFjY291bnRMYWJlbHM7XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgcmV0dXJuIFtdOyAvLyBHcmFjZWZ1bCBmYWxsYmFja1xuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGdldEFjY291bnRJZHNCb3RoVUlzKHBhZ2U6IFBhZ2UpOiBQcm9taXNlPHN0cmluZ1tdPiB7XG4gIGxldCBhY2NvdW50c0lkczogc3RyaW5nW10gPSBhd2FpdCBjbGlja0FjY291bnRTZWxlY3RvckdldEFjY291bnRJZHMocGFnZSk7XG4gIGlmIChhY2NvdW50c0lkcy5sZW5ndGggPT09IDApIHtcbiAgICBhY2NvdW50c0lkcyA9IGF3YWl0IGdldEFjY291bnRJZHNPbGRVSShwYWdlKTtcbiAgfVxuICByZXR1cm4gYWNjb3VudHNJZHM7XG59XG5cbi8qKlxuICogU2VsZWN0cyBhbiBhY2NvdW50IGZyb20gdGhlIGRyb3Bkb3duIGJhc2VkIG9uIHRoZSBwcm92aWRlZCBhY2NvdW50IGxhYmVsLlxuICpcbiAqIFRoaXMgbWV0aG9kOlxuICogLSBDbGlja3MgdGhlIGFjY291bnQgc2VsZWN0b3IgYnV0dG9uIHRvIG9wZW4gdGhlIGRyb3Bkb3duLlxuICogLSBSZXRyaWV2ZXMgdGhlIGxpc3Qgb2YgYXZhaWxhYmxlIGFjY291bnQgbGFiZWxzLlxuICogLSBDaGVja3MgaWYgdGhlIHByb3ZpZGVkIGFjY291bnQgbGFiZWwgZXhpc3RzIGluIHRoZSBsaXN0LlxuICogLSBGaW5kcyBhbmQgY2xpY2tzIHRoZSBtYXRjaGluZyBhY2NvdW50IG9wdGlvbiBpZiBmb3VuZC5cbiAqXG4gKiBAcGFyYW0gcGFnZSBQdXBwZXRlZXIgUGFnZSBvYmplY3QuXG4gKiBAcGFyYW0gYWNjb3VudExhYmVsIFRoZSB0ZXh0IG9mIHRoZSBhY2NvdW50IHRvIHNlbGVjdCAoZS5nLiwgXCIxMjcgfCBYWFhYWFwiKS5cbiAqIEByZXR1cm5zIFRydWUgaWYgdGhlIGFjY291bnQgb3B0aW9uIHdhcyBmb3VuZCBhbmQgY2xpY2tlZDsgZmFsc2Ugb3RoZXJ3aXNlLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gc2VsZWN0QWNjb3VudEZyb21Ecm9wZG93bihwYWdlOiBQYWdlLCBhY2NvdW50TGFiZWw6IHN0cmluZyk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAvLyBDYWxsIGNsaWNrQWNjb3VudFNlbGVjdG9yIHRvIGdldCB0aGUgYXZhaWxhYmxlIGFjY291bnRzIGFuZCBvcGVuIHRoZSBkcm9wZG93blxuICBjb25zdCBhdmFpbGFibGVBY2NvdW50cyA9IGF3YWl0IGNsaWNrQWNjb3VudFNlbGVjdG9yR2V0QWNjb3VudElkcyhwYWdlKTtcblxuICAvLyBDaGVjayBpZiB0aGUgYWNjb3VudCBsYWJlbCBleGlzdHMgaW4gdGhlIGF2YWlsYWJsZSBhY2NvdW50c1xuICBpZiAoIWF2YWlsYWJsZUFjY291bnRzLmluY2x1ZGVzKGFjY291bnRMYWJlbCkpIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICAvLyBXYWl0IGZvciB0aGUgZHJvcGRvd24gb3B0aW9ucyB0byBiZSByZW5kZXJlZFxuICBjb25zdCBvcHRpb25TZWxlY3RvciA9ICdtYXQtb3B0aW9uIC5tZGMtbGlzdC1pdGVtX19wcmltYXJ5LXRleHQnO1xuICBhd2FpdCB3YWl0VW50aWxFbGVtZW50Rm91bmQocGFnZSwgb3B0aW9uU2VsZWN0b3IsIHRydWUsIEVMRU1FTlRfUkVOREVSX1RJTUVPVVRfTVMpO1xuXG4gIC8vIFF1ZXJ5IGFsbCBtYXRjaGluZyBvcHRpb25zXG4gIGNvbnN0IGFjY291bnRPcHRpb25zID0gYXdhaXQgcGFnZS4kJChvcHRpb25TZWxlY3Rvcik7XG5cbiAgLy8gRmluZCBhbmQgY2xpY2sgdGhlIG9wdGlvbiBtYXRjaGluZyB0aGUgYWNjb3VudExhYmVsXG4gIGZvciAoY29uc3Qgb3B0aW9uIG9mIGFjY291bnRPcHRpb25zKSB7XG4gICAgY29uc3QgdGV4dCA9IGF3YWl0IHBhZ2UuZXZhbHVhdGUoZWwgPT4gZWwudGV4dENvbnRlbnQ/LnRyaW0oKSwgb3B0aW9uKTtcblxuICAgIGlmICh0ZXh0ID09PSBhY2NvdW50TGFiZWwpIHtcbiAgICAgIGNvbnN0IG9wdGlvbkhhbmRsZSA9IGF3YWl0IG9wdGlvbi5ldmFsdWF0ZUhhbmRsZShlbCA9PiBlbCBhcyBIVE1MRWxlbWVudCk7XG4gICAgICBhd2FpdCBwYWdlLmV2YWx1YXRlKChlbDogSFRNTEVsZW1lbnQpID0+IGVsLmNsaWNrKCksIG9wdGlvbkhhbmRsZSk7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gZmFsc2U7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGdldFRyYW5zYWN0aW9uc0ZyYW1lKHBhZ2U6IFBhZ2UpOiBQcm9taXNlPEZyYW1lIHwgbnVsbD4ge1xuICAvLyBUcnkgYSBmZXcgdGltZXMgdG8gZmluZCB0aGUgaWZyYW1lLCBhcyBpdCBtaWdodCBub3QgYmUgaW1tZWRpYXRlbHkgYXZhaWxhYmxlXG4gIGZvciAobGV0IGF0dGVtcHQgPSAwOyBhdHRlbXB0IDwgMzsgYXR0ZW1wdCsrKSB7XG4gICAgYXdhaXQgc2xlZXAoMjAwMCk7XG4gICAgY29uc3QgZnJhbWVzID0gcGFnZS5mcmFtZXMoKTtcbiAgICBjb25zdCB0YXJnZXRGcmFtZSA9IGZyYW1lcy5maW5kKGYgPT4gZi5uYW1lKCkgPT09IElGUkFNRV9OQU1FKTtcblxuICAgIGlmICh0YXJnZXRGcmFtZSkge1xuICAgICAgcmV0dXJuIHRhcmdldEZyYW1lO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBudWxsO1xufVxuXG5hc3luYyBmdW5jdGlvbiBzZWxlY3RBY2NvdW50Qm90aFVJcyhwYWdlOiBQYWdlLCBhY2NvdW50SWQ6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICBjb25zdCBhY2NvdW50U2VsZWN0ZWQgPSBhd2FpdCBzZWxlY3RBY2NvdW50RnJvbURyb3Bkb3duKHBhZ2UsIGFjY291bnRJZCk7XG4gIGlmICghYWNjb3VudFNlbGVjdGVkKSB7XG4gICAgLy8gT2xkIFVJIGZvcm1hdFxuICAgIGF3YWl0IHBhZ2Uuc2VsZWN0KCcjYWNjb3VudF9udW1fc2VsZWN0JywgYWNjb3VudElkKTtcbiAgICBhd2FpdCB3YWl0VW50aWxFbGVtZW50Rm91bmQocGFnZSwgJyNhY2NvdW50X251bV9zZWxlY3QnLCB0cnVlKTtcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBmZXRjaEFjY291bnREYXRhQm90aFVJcyhcbiAgcGFnZTogUGFnZSxcbiAgc3RhcnREYXRlOiBNb21lbnQsXG4gIG9wdGlvbnM/OiBTY3JhcGVyT3B0aW9ucyxcbik6IFByb21pc2U8VHJhbnNhY3Rpb25zQWNjb3VudD4ge1xuICAvLyBUcnkgdG8gZ2V0IHRoZSBpZnJhbWUgZm9yIHRoZSBuZXcgVUlcbiAgY29uc3QgZnJhbWUgPSBhd2FpdCBnZXRUcmFuc2FjdGlvbnNGcmFtZShwYWdlKTtcblxuICAvLyBVc2UgdGhlIGZyYW1lIGlmIGF2YWlsYWJsZSAobmV3IFVJKSwgb3RoZXJ3aXNlIHVzZSB0aGUgcGFnZSBkaXJlY3RseSAob2xkIFVJKVxuICBjb25zdCB0YXJnZXRQYWdlID0gZnJhbWUgfHwgcGFnZTtcbiAgcmV0dXJuIGZldGNoQWNjb3VudERhdGEodGFyZ2V0UGFnZSwgc3RhcnREYXRlLCBvcHRpb25zKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZmV0Y2hBY2NvdW50cyhwYWdlOiBQYWdlLCBzdGFydERhdGU6IE1vbWVudCwgb3B0aW9ucz86IFNjcmFwZXJPcHRpb25zKTogUHJvbWlzZTxUcmFuc2FjdGlvbnNBY2NvdW50W10+IHtcbiAgY29uc3QgYWNjb3VudHNJZHMgPSBhd2FpdCBnZXRBY2NvdW50SWRzQm90aFVJcyhwYWdlKTtcblxuICBpZiAoYWNjb3VudHNJZHMubGVuZ3RoID09PSAwKSB7XG4gICAgLy8gSW4gY2FzZSBhY2NvdW50c0lkcyBjb3VsZCBubyBiZSBwYXJzZWQganVzdCByZXR1cm4gdGhlIHRyYW5zYWN0aW9ucyBvZiB0aGUgY3VycmVudGx5IHNlbGVjdGVkIGFjY291bnRcbiAgICBjb25zdCBhY2NvdW50RGF0YSA9IGF3YWl0IGZldGNoQWNjb3VudERhdGFCb3RoVUlzKHBhZ2UsIHN0YXJ0RGF0ZSwgb3B0aW9ucyk7XG4gICAgcmV0dXJuIFthY2NvdW50RGF0YV07XG4gIH1cblxuICBjb25zdCBhY2NvdW50czogVHJhbnNhY3Rpb25zQWNjb3VudFtdID0gW107XG4gIGZvciAoY29uc3QgYWNjb3VudElkIG9mIGFjY291bnRzSWRzKSB7XG4gICAgYXdhaXQgc2VsZWN0QWNjb3VudEJvdGhVSXMocGFnZSwgYWNjb3VudElkKTtcbiAgICBjb25zdCBhY2NvdW50RGF0YSA9IGF3YWl0IGZldGNoQWNjb3VudERhdGFCb3RoVUlzKHBhZ2UsIHN0YXJ0RGF0ZSwgb3B0aW9ucyk7XG4gICAgYWNjb3VudHMucHVzaChhY2NvdW50RGF0YSk7XG4gIH1cblxuICByZXR1cm4gYWNjb3VudHM7XG59XG5cbnR5cGUgU2NyYXBlclNwZWNpZmljQ3JlZGVudGlhbHMgPSB7IHVzZXJuYW1lOiBzdHJpbmc7IHBhc3N3b3JkOiBzdHJpbmcgfTtcblxuY2xhc3MgQmVpbmxldW1pR3JvdXBCYXNlU2NyYXBlciBleHRlbmRzIEJhc2VTY3JhcGVyV2l0aEJyb3dzZXI8U2NyYXBlclNwZWNpZmljQ3JlZGVudGlhbHM+IHtcbiAgQkFTRV9VUkwgPSAnJztcblxuICBMT0dJTl9VUkwgPSAnJztcblxuICBUUkFOU0FDVElPTlNfVVJMID0gJyc7XG5cbiAgZ2V0TG9naW5PcHRpb25zKGNyZWRlbnRpYWxzOiBTY3JhcGVyU3BlY2lmaWNDcmVkZW50aWFscykge1xuICAgIHJldHVybiB7XG4gICAgICBsb2dpblVybDogYCR7dGhpcy5MT0dJTl9VUkx9YCxcbiAgICAgIGZpZWxkczogY3JlYXRlTG9naW5GaWVsZHMoY3JlZGVudGlhbHMpLFxuICAgICAgc3VibWl0QnV0dG9uU2VsZWN0b3I6ICcjY29udGludWVCdG4nLFxuICAgICAgcG9zdEFjdGlvbjogYXN5bmMgKCkgPT4gd2FpdEZvclBvc3RMb2dpbih0aGlzLnBhZ2UpLFxuICAgICAgcG9zc2libGVSZXN1bHRzOiBnZXRQb3NzaWJsZUxvZ2luUmVzdWx0cygpLFxuICAgICAgLy8gSEFDSzogRm9yIHNvbWUgcmVhc29uLCB0aG91Z2ggdGhlIGxvZ2luIGJ1dHRvbiAoI2NvbnRpbnVlQnRuKSBpcyBwcmVzZW50IGFuZCB2aXNpYmxlLCB0aGUgY2xpY2sgYWN0aW9uIGRvZXMgbm90IHBlcmZvcm0uXG4gICAgICAvLyBBZGRpbmcgdGhpcyBkZWxheSBmaXhlcyB0aGUgaXNzdWUuXG4gICAgICBwcmVBY3Rpb246IGFzeW5jICgpID0+IHtcbiAgICAgICAgYXdhaXQgc2xlZXAoMTAwMCk7XG4gICAgICB9LFxuICAgIH07XG4gIH1cblxuICBhc3luYyBmZXRjaERhdGEoKSB7XG4gICAgY29uc3QgZGVmYXVsdFN0YXJ0TW9tZW50ID0gbW9tZW50KCkuc3VidHJhY3QoMSwgJ3llYXJzJykuYWRkKDEsICdkYXknKTtcbiAgICBjb25zdCBzdGFydE1vbWVudExpbWl0ID0gbW9tZW50KHsgeWVhcjogMTYwMCB9KTtcbiAgICBjb25zdCBzdGFydERhdGUgPSB0aGlzLm9wdGlvbnMuc3RhcnREYXRlIHx8IGRlZmF1bHRTdGFydE1vbWVudC50b0RhdGUoKTtcbiAgICBjb25zdCBzdGFydE1vbWVudCA9IG1vbWVudC5tYXgoc3RhcnRNb21lbnRMaW1pdCwgbW9tZW50KHN0YXJ0RGF0ZSkpO1xuXG4gICAgYXdhaXQgdGhpcy5uYXZpZ2F0ZVRvKHRoaXMuVFJBTlNBQ1RJT05TX1VSTCk7XG5cbiAgICBjb25zdCBhY2NvdW50cyA9IGF3YWl0IGZldGNoQWNjb3VudHModGhpcy5wYWdlLCBzdGFydE1vbWVudCwgdGhpcy5vcHRpb25zKTtcblxuICAgIHJldHVybiB7XG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgYWNjb3VudHMsXG4gICAgfTtcbiAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBCZWlubGV1bWlHcm91cEJhc2VTY3JhcGVyO1xuIl0sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7OztBQUFBLElBQUFBLE9BQUEsR0FBQUMsc0JBQUEsQ0FBQUMsT0FBQTtBQUVBLElBQUFDLFVBQUEsR0FBQUQsT0FBQTtBQUNBLElBQUFFLHFCQUFBLEdBQUFGLE9BQUE7QUFPQSxJQUFBRyxXQUFBLEdBQUFILE9BQUE7QUFDQSxJQUFB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