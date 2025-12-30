import moment from 'moment';
import { type Page } from 'puppeteer';
import { v4 as uuid4 } from 'uuid';
import { SHEKEL_CURRENCY } from '../constants';
import { getDebug } from '../helpers/debug';
import { fetchGetWithinPage, fetchPostWithinPage } from '../helpers/fetch';
import { waitForRedirect } from '../helpers/navigation';
import { waitUntil } from '../helpers/waiting';
import {
  type Transaction,
  TransactionStatuses,
  TransactionTypes,
  type TransactionsAccount,
  type Security,
} from '../transactions';
import { BaseScraperWithBrowser, LoginResults, type PossibleLoginResults } from './base-scraper-with-browser';
import { type ScraperOptions } from './interface';

const debug = getDebug('hapoalim');

const DATE_FORMAT = 'YYYYMMDD';

// eslint-disable-next-line @typescript-eslint/no-namespace
declare namespace window {
  const bnhpApp: any;
}

interface ScrapedTransaction {
  serialNumber?: number;
  activityDescription?: string;
  eventAmount: number;
  valueDate?: string;
  eventDate?: string;
  referenceNumber?: number;
  ScrapedTransaction?: string;
  eventActivityTypeCode: number;
  currentBalance: number;
  pfmDetails: string;
  beneficiaryDetailsData?: {
    partyHeadline?: string;
    partyName?: string;
    messageHeadline?: string;
    messageDetail?: string;
  };
}

interface ScrapedPfmTransaction {
  transactionNumber: number;
}

type FetchedAccountData = {
  bankNumber: string;
  accountNumber: string;
  branchNumber: string;
  accountClosingReasonCode: number;
}[];

type FetchedAccountTransactionsData = {
  transactions: ScrapedTransaction[];
};

type BalanceAndCreditLimit = {
  creditLimitAmount: number;
  creditLimitDescription: string;
  creditLimitUtilizationAmount: number;
  creditLimitUtilizationExistanceCode: number;
  creditLimitUtilizationPercent: number;
  currentAccountLimitsAmount: number;
  currentBalance: number;
  withdrawalBalance: number;
};

interface ForexTransaction {
  executingDate: number;
  valueDate: number;
  activityDescription: string;
  eventAmount: number;
  currentBalance: number;
  referenceNumber?: number;
  eventDetails?: string;
  eventActivityTypeCode: number;
  currencySwiftCode: string;
  recordSerialNumber?: number;
}

interface ForexCurrencyData {
  currencyCode: number;
  currencySwiftCode: string;
  currencySwiftDescription: string;
  currentBalance: number;
  transactions: ForexTransaction[];
  detailedAccountTypeCode: number;
}

interface ForexAccountData {
  balancesAndLimitsDataList: ForexCurrencyData[];
}

interface SavingsDeposit {
  principalAmount: number;
  revaluedTotalAmount: number;
  depositSerialId: number;
  productFreeText?: string;
  shortProductName?: string;
  formattedAgreementOpeningDate?: string;
  formattedEndExitDate?: string;
  nominalInterest?: number;
  detailedAccountTypeCode: number;
}

interface SavingsWrapper {
  data: SavingsDeposit[];
  amount: number;
  revaluatedAmount: number;
}

interface SavingsAccountData {
  depositsWrapperData: SavingsWrapper[];
}

interface InvestmentSecurityBalance {
  EquityNumber: string;
  BaseRate?: number;
  LastRate?: number;
  BaseRateChangePercentage?: number;
  OnlineNV: number;
  OnlineVL: number;
  OnlineNisVL?: number;
  ProfitLoss?: number;
  CurrencyCode?: string;
}

interface InvestmentSecurityMeta {
  '-Key': string;
  EngName?: string;
  EngSymbol?: string;
  HebName?: string;
  HebSymbol?: string;
  Symbol?: string;
  ItemType?: string;
  StockType?: string;
  IsForeign?: boolean;
  CurrencyCode?: string;
  Exchange?: string;
  EquityType?: number;
  EquitySubType?: number;
}

interface InvestmentAccountData {
  View?: {
    Account?: {
      OnlineValue?: number;
      OnlineCash?: number;
      CurrencyCode?: string;
      AccountPosition?: {
        Balance?: InvestmentSecurityBalance[];
      };
    };
    Meta?: {
      Security?: InvestmentSecurityMeta[];
    };
  };
}

function convertTransactions(txns: ScrapedTransaction[]): Transaction[] {
  return txns.map(txn => {
    const isOutbound = txn.eventActivityTypeCode === 2;

    let memo = '';
    if (txn.beneficiaryDetailsData) {
      const { partyHeadline, partyName, messageHeadline, messageDetail } = txn.beneficiaryDetailsData;
      const memoLines: string[] = [];
      if (partyHeadline) {
        memoLines.push(partyHeadline);
      }

      if (partyName) {
        memoLines.push(`${partyName}.`);
      }

      if (messageHeadline) {
        memoLines.push(messageHeadline);
      }

      if (messageDetail) {
        memoLines.push(`${messageDetail}.`);
      }

      if (memoLines.length) {
        memo = memoLines.join(' ');
      }
    }

    const result: Transaction = {
      type: TransactionTypes.Normal,
      identifier: txn.referenceNumber,
      date: moment(txn.eventDate, DATE_FORMAT).toISOString(),
      processedDate: moment(txn.valueDate, DATE_FORMAT).toISOString(),
      originalAmount: isOutbound ? -txn.eventAmount : txn.eventAmount,
      originalCurrency: SHEKEL_CURRENCY,
      chargedAmount: isOutbound ? -txn.eventAmount : txn.eventAmount,
      description: txn.activityDescription || '',
      status: txn.serialNumber === 0 ? TransactionStatuses.Pending : TransactionStatuses.Completed,
      memo,
    };

    return result;
  });
}

function convertForexTransactions(txns: ForexTransaction[], currency: string): Transaction[] {
  return txns.map(txn => {
    const isOutbound = txn.eventActivityTypeCode === 2;
    const dateStr = txn.executingDate.toString(); // Date transaction was executed
    const valueDateStr = txn.valueDate.toString(); // Date value was actually added to account

    let memo = '';
    if (txn.eventDetails) {
      memo = txn.eventDetails;
    }

    const result: Transaction = {
      type: TransactionTypes.Normal,
      identifier: txn.referenceNumber || txn.recordSerialNumber,
      date: moment(valueDateStr, DATE_FORMAT).toISOString(),
      processedDate: moment(dateStr, DATE_FORMAT).toISOString(),
      originalAmount: isOutbound ? -txn.eventAmount : txn.eventAmount,
      originalCurrency: currency,
      chargedAmount: isOutbound ? -txn.eventAmount : txn.eventAmount,
      description: txn.activityDescription || '',
      status: TransactionStatuses.Completed,
      memo,
    };

    return result;
  });
}

async function getRestContext(page: Page) {
  await waitUntil(() => {
    return page.evaluate(() => !!window.bnhpApp);
  }, 'waiting for app data load');

  const result = await page.evaluate(() => {
    return window.bnhpApp.restContext;
  });

  return result.slice(1);
}

async function fetchPoalimXSRFWithinPage(
  page: Page,
  url: string,
  pageUuid: string,
): Promise<FetchedAccountTransactionsData | null> {
  const cookies = await page.cookies();
  const XSRFCookie = cookies.find(cookie => cookie.name === 'XSRF-TOKEN');
  const headers: Record<string, any> = {};
  if (XSRFCookie != null) {
    headers['X-XSRF-TOKEN'] = XSRFCookie.value;
  }
  headers.pageUuid = pageUuid;
  headers.uuid = uuid4();
  headers['Content-Type'] = 'application/json;charset=UTF-8';
  return fetchPostWithinPage<FetchedAccountTransactionsData>(page, url, [], headers);
}

async function getExtraScrap(
  txnsResult: FetchedAccountTransactionsData,
  baseUrl: string,
  page: Page,
  accountNumber: string,
): Promise<FetchedAccountTransactionsData> {
  const promises = txnsResult.transactions.map(async (transaction: ScrapedTransaction): Promise<ScrapedTransaction> => {
    const { pfmDetails, serialNumber } = transaction;
    if (serialNumber !== 0) {
      const url = `${baseUrl}${pfmDetails}&accountId=${accountNumber}&lang=he`;
      const extraTransactionDetails = (await fetchGetWithinPage<ScrapedPfmTransaction[]>(page, url)) || [];
      if (extraTransactionDetails && extraTransactionDetails.length) {
        const { transactionNumber } = extraTransactionDetails[0];
        if (transactionNumber) {
          return { ...transaction, referenceNumber: transactionNumber };
        }
      }
    }
    return transaction;
  });
  const res = await Promise.all(promises);
  return { transactions: res };
}

async function getAccountTransactions(
  baseUrl: string,
  apiSiteUrl: string,
  page: Page,
  accountNumber: string,
  startDate: string,
  endDate: string,
  additionalTransactionInformation = false,
) {
  const txnsUrl = `${apiSiteUrl}/current-account/transactions?accountId=${accountNumber}&numItemsPerPage=1000&retrievalEndDate=${endDate}&retrievalStartDate=${startDate}&sortCode=1`;
  const txnsResult = await fetchPoalimXSRFWithinPage(page, txnsUrl, '/current-account/transactions');

  const finalResult =
    additionalTransactionInformation && txnsResult?.transactions.length
      ? await getExtraScrap(txnsResult, baseUrl, page, accountNumber)
      : txnsResult;

  return convertTransactions(finalResult?.transactions ?? []);
}

async function getAccountBalance(apiSiteUrl: string, page: Page, accountNumber: string) {
  const balanceAndCreditLimitUrl = `${apiSiteUrl}/current-account/composite/balanceAndCreditLimit?accountId=${accountNumber}&view=details&lang=he`;
  const balanceAndCreditLimit = await fetchGetWithinPage<BalanceAndCreditLimit>(page, balanceAndCreditLimitUrl);

  return balanceAndCreditLimit?.currentBalance;
}

async function getForexAccounts(
  baseUrl: string,
  page: Page,
  accountNumber: string,
  startDate: string,
  endDate: string,
): Promise<TransactionsAccount[]> {
  debug('========== FETCHING FOREX ACCOUNTS ==========');
  debug('Account: %s, Date range: %s to %s', accountNumber, startDate, endDate);

  const accounts: TransactionsAccount[] = [];

  const currency = { code: 19, swift: SHEKEL_CURRENCY };
  try {
    const detailedAccountTypeCode = 142; // For foreign currency accounts
    const forexUrl = `${baseUrl}/ServerServices/foreign-currency/transactions?accountId=${accountNumber}&type=business&retrievalStartDate=${startDate}&retrievalEndDate=${endDate}&currencyCodeList=${currency.code}&detailedAccountTypeCodeList=${detailedAccountTypeCode}&view=details&lang=he`;
    debug('Trying forex %s', forexUrl);

    const forexData = await fetchGetWithinPage<ForexAccountData>(page, forexUrl, true); // ignoreErrors = true

    if (forexData && forexData.balancesAndLimitsDataList && forexData.balancesAndLimitsDataList.length > 0) {
      debug('✓ Found forex data');

      for (const currencyData of forexData.balancesAndLimitsDataList) {
        const currencySwiftCode = currencyData.currencySwiftCode || currency.swift;
        const transactionCount = currencyData.transactions?.length || 0;

        // Get balance from the most recent transaction's currentBalance field
        // If no transactions, fall back to currencyData.currentBalance
        let balance = currencyData.currentBalance;
        if (transactionCount > 0 && currencyData.transactions) {
          balance = currencyData.transactions[0].currentBalance;
          debug('  - Using balance from most recent transaction: %s', balance);
        }

        debug('  - Currency: %s, Balance: %s, Transactions: %d', currencySwiftCode, balance, transactionCount);

        // Log transaction dates for debugging
        if (transactionCount > 0) {
          const txnDates = currencyData.transactions?.map(t => t.executingDate).join(', ') || '';
          debug('    Transaction dates: %s', txnDates);
        }

        // Only add if there's actually a balance or transactions
        if (balance !== 0 || transactionCount > 0) {
          const txns = convertForexTransactions(currencyData.transactions || [], currencySwiftCode);
          const forexAccountNumber = `${accountNumber}-${currencySwiftCode}`;

          accounts.push({
            accountNumber: forexAccountNumber,
            balance,
            currency: currencySwiftCode,
            txns,
          });

          debug('  ✓ Added forex account: %s with %d transactions', forexAccountNumber, txns.length);
        } else {
          debug('  - Skipping %s (zero balance and no transactions)', currencySwiftCode);
        }
      }
    } else {
      debug('  - No forex data found');
    }
  } catch (error) {
    debug('  - Error fetching forex: %s', error);
    // Continue trying other currencies
  }

  debug('Returning %d forex accounts', accounts.length);
  return accounts;
}

async function getSavingsAccounts(baseUrl: string, page: Page, accountNumber: string): Promise<TransactionsAccount[]> {
  const savingsUrl = `${baseUrl}/ServerServices/deposits-and-savings/deposits?accountId=${accountNumber}&view=details&lang=he`;
  const savingsData = await fetchGetWithinPage<SavingsAccountData>(page, savingsUrl);

  if (!savingsData || !savingsData.depositsWrapperData || savingsData.depositsWrapperData.length === 0) {
    debug('No savings accounts found for account %s', accountNumber);
    return [];
  }

  const accounts: TransactionsAccount[] = [];

  for (const wrapper of savingsData.depositsWrapperData) {
    // Create a separate account for each individual deposit
    for (const deposit of wrapper.data) {
      const balance = deposit.revaluedTotalAmount || deposit.principalAmount;
      const savingsAccountNumber = `${accountNumber}-${deposit.depositSerialId}`;

      accounts.push({
        accountNumber: savingsAccountNumber,
        savingsAccount: true,
        balance,
        txns: [], // Savings accounts typically don't have transaction history in the same way
      });

      debug('Added savings account %s with balance %s', savingsAccountNumber, balance);
    }
  }

  return accounts;
}

async function getInvestmentAccounts(
  baseUrl: string,
  page: Page,
  account: { bankNumber: string; branchNumber: string; accountNumber: string },
): Promise<TransactionsAccount[]> {
  debug('========== FETCHING INVESTMENT ACCOUNTS ==========');
  const accounts: TransactionsAccount[] = [];
  const accountNumber = `${account.branchNumber}-${account.accountNumber}`; // Don't include bankNumber here because investment API doesn't use it

  // Set up request interception to capture session headers
  let capturedSession: string | null = null;
  let capturedCsession: string | null = null;

  const requestHandler = (request: any) => {
    try {
      const headers = request.headers();
      if (headers.session && !capturedSession) {
        capturedSession = headers.session;
        debug('  - Captured session from network request');
      }
      if (headers.csession && !capturedCsession) {
        capturedCsession = headers.csession;
        debug('  - Captured csession from network request');
      }
      request.continue();
    } catch (e) {
      debug('  - Error in request handler: %s', e);
      // Try to continue anyway
      try {
        request.continue();
      } catch (continueError) {
        // Ignore if already handled
      }
    }
  };

  try {
    // Navigate to mytrade section to establish session
    const mytradeUrl = `${baseUrl}/mytrade/app`;
    debug('Navigating to mytrade section: %s', mytradeUrl);

    await page.setRequestInterception(true);
    page.on('request', requestHandler);

    // Try to navigate, but if it fails (e.g., MyTrade not enabled), clean up and return empty
    try {
      await page.goto(mytradeUrl, { waitUntil: 'networkidle2', timeout: 60000 });
      // Wait longer for the page to fully load and establish session
      await new Promise(resolve => setTimeout(resolve, 5000));
    } catch (navError) {
      debug('  - Navigation to MyTrade failed (likely not enabled): %s', navError);
      // Clean up request interception
      page.off('request', requestHandler);
      await page.setRequestInterception(false);
      debug('Returning 0 investment accounts (MyTrade not accessible)');
      return accounts;
    }

    // Now turn off request interception before we make API calls
    page.off('request', requestHandler);
    await page.setRequestInterception(false);

    debug('Mytrade page loaded, session established');

    const fields =
      'EngName,EngSymbol,HebName,HebSymbol,Symbol,ExpirationDate,ItemType,StockType,IsEtf,IsForeign,CurrencyCode,Exchange,CreationEquityNum,EquityType,ContractType,AllowedOrderDirection,EquitySubType';
    const investmentUrl = `${baseUrl}/ServerServices/mytrade/api/v2/json2/account/view?account=${accountNumber}&fields=${fields}`;
    debug('Trying investment account URL: %s', investmentUrl);

    // Get XSRF token and session data from cookies
    const cookies = await page.cookies();
    const XSRFCookie = cookies.find(cookie => cookie.name === 'XSRF-TOKEN');

    // Use captured session or fallback to generated ones
    const sessionId = capturedSession || uuid4();
    const csession = capturedCsession || Math.random().toString();

    const headers: Record<string, any> = {
      'Content-Type': 'application/json; charset=utf-8',
      csession,
      session: sessionId,
      Referer: mytradeUrl,
    };
    if (XSRFCookie != null) {
      headers['X-XSRF-TOKEN'] = XSRFCookie.value;
      debug('  - Using XSRF token: %s', XSRFCookie.value.substring(0, 10) + '...');
    }

    debug('  - Request headers: csession=%s, session=%s', csession, sessionId);

    const investmentData = await fetchPostWithinPage<InvestmentAccountData>(page, investmentUrl, {}, headers);

    debug('  - Response received: %s', investmentData ? 'YES' : 'NO');
    if (investmentData) {
      debug('  - Response has View: %s', investmentData.View ? 'YES' : 'NO');
      debug('  - Response has View.Account: %s', investmentData.View?.Account ? 'YES' : 'NO');
    }

    if (investmentData?.View?.Account) {
      debug('✓ Found investment account data');

      const accountData = investmentData.View.Account;
      const balance = accountData.OnlineValue || 0;
      const currency = accountData.CurrencyCode || SHEKEL_CURRENCY;

      // Get securities from the balance array
      const securities: Security[] = [];
      const balances = accountData.AccountPosition?.Balance || [];
      const metaSecurities = investmentData.View.Meta?.Security || [];

      // Create a map of security metadata for easy lookup
      const metaMap = new Map<string, InvestmentSecurityMeta>();
      for (const meta of metaSecurities) {
        metaMap.set(meta['-Key'], meta);
      }

      for (const securityBalance of balances) {
        const meta = metaMap.get(securityBalance.EquityNumber);

        securities.push({
          name: meta?.EngName || '',
          symbol: meta?.EngSymbol || '',
          volume: securityBalance.OnlineNV,
          value: securityBalance.OnlineVL,
          currency: securityBalance.CurrencyCode || meta?.CurrencyCode || SHEKEL_CURRENCY,
          changePercentage: securityBalance.BaseRateChangePercentage,
          profitLoss: securityBalance.ProfitLoss,
        });
      }

      debug('  - Balance: %s %s, Securities: %d', balance, currency, securities.length);

      if (balance !== 0 || securities.length > 0) {
        const investmentAccountNumber = `${account.bankNumber}-${account.branchNumber}-${account.accountNumber}-investment`;
        accounts.push({
          accountNumber: investmentAccountNumber,
          balance,
          currency,
          savingsAccount: true,
          txns: [],
          securities,
        });

        debug('  ✓ Added investment account: %s with %d securities', investmentAccountNumber, securities.length);
      } else {
        debug('  - Skipping (zero balance and no securities)');
      }
    } else {
      debug('  - No investment account data found');
    }
  } catch (error) {
    debug('  - Error fetching investment account: %s', error);
    // Log more details about the error
    if (error instanceof Error) {
      debug('    Error message: %s', error.message);
      debug('    Error stack: %s', error.stack);
    }
  } finally {
    // Clean up request interception (in case it wasn't already done)
    try {
      page.off('request', requestHandler);
      await page.setRequestInterception(false);
    } catch (e) {
      // Ignore cleanup errors
    }

    // Navigate back to the main homepage to restore the session for subsequent scraping
    try {
      const homepageUrl = `${baseUrl}/ng-portals/rb/he/homepage`;
      debug('Navigating back to homepage: %s', homepageUrl);
      await page.goto(homepageUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      await new Promise(resolve => setTimeout(resolve, 2000));
      debug('Homepage restored');
    } catch (navError) {
      debug('  - Failed to navigate back to homepage: %s', navError);
      // Continue anyway, the outer try-catch in fetchAccountData will handle it
    }
  }

  debug('Returning %d investment accounts', accounts.length);
  return accounts;
}

async function fetchAccountData(page: Page, baseUrl: string, options: ScraperOptions) {
  const restContext = await getRestContext(page);
  const apiSiteUrl = `${baseUrl}/${restContext}`;
  const accountDataUrl = `${baseUrl}/ServerServices/general/accounts`;

  debug('fetching accounts data');
  const accountsInfo = (await fetchGetWithinPage<FetchedAccountData>(page, accountDataUrl)) || [];
  debug('got %d accounts, fetching txns and balance', accountsInfo.length);

  const defaultStartMoment = moment().subtract(1, 'years').add(1, 'day');
  const startDate = options.startDate || defaultStartMoment.toDate();
  const startMoment = moment.max(defaultStartMoment, moment(startDate));
  const { additionalTransactionInformation } = options;

  const startDateStr = startMoment.format(DATE_FORMAT);
  const endDateStr = moment().format(DATE_FORMAT);

  const accounts: TransactionsAccount[] = [];

  for (const account of accountsInfo) {
    let balance: number | undefined;
    const accountNumber = `${account.bankNumber}-${account.branchNumber}-${account.accountNumber}`;

    const isActiveAccount = account.accountClosingReasonCode === 0;
    if (isActiveAccount) {
      balance = await getAccountBalance(apiSiteUrl, page, accountNumber);
    } else {
      debug('Skipping balance for a closed account, balance will be undefined');
    }

    let txns: Transaction[] = [];
    try {
      txns = await getAccountTransactions(
        baseUrl,
        apiSiteUrl,
        page,
        accountNumber,
        startDateStr,
        endDateStr,
        additionalTransactionInformation,
      );
    } catch (error) {
      debug('Error fetching transactions for %s (possibly closed account): %s', accountNumber, error);
      // Continue with empty transactions
    }

    // Add regular checking account
    accounts.push({
      accountNumber,
      balance,
      txns,
    });

    // Fetch forex accounts for this account number
    try {
      const forexAccounts = await getForexAccounts(baseUrl, page, accountNumber, startDateStr, endDateStr);
      accounts.push(...forexAccounts);
      debug('Added %d forex accounts to results', forexAccounts.length);
    } catch (error) {
      debug('Error fetching forex accounts for %s: %s', accountNumber, error);
    }

    // Fetch savings accounts for this account number
    try {
      const savingsAccounts = await getSavingsAccounts(baseUrl, page, accountNumber);
      accounts.push(...savingsAccounts);
      debug('Added %d savings accounts to results', savingsAccounts.length);
    } catch (error) {
      debug('Error fetching savings accounts for %s: %s', accountNumber, error);
    }

    // Fetch investment accounts for this account number
    try {
      const investmentAccounts = await getInvestmentAccounts(baseUrl, page, account);
      accounts.push(...investmentAccounts);
      debug('Added %d investment accounts to results', investmentAccounts.length);
    } catch (error) {
      debug('Error fetching investment accounts for %s: %s', accountNumber, error);
    }
  }

  const accountData = {
    success: true,
    accounts,
  };
  debug('fetching ended');
  return accountData;
}

function getPossibleLoginResults(baseUrl: string) {
  const urls: PossibleLoginResults = {};
  urls[LoginResults.Success] = [
    `${baseUrl}/portalserver/HomePage`,
    `${baseUrl}/ng-portals-bt/rb/he/homepage`,
    `${baseUrl}/ng-portals/rb/he/homepage`,
  ];
  urls[LoginResults.InvalidPassword] = [
    `${baseUrl}/AUTHENTICATE/LOGON?flow=AUTHENTICATE&state=LOGON&errorcode=1.6&callme=false`,
  ];
  urls[LoginResults.ChangePassword] = [
    `${baseUrl}/MCP/START?flow=MCP&state=START&expiredDate=null`,
    /\/ABOUTTOEXPIRE\/START/i,
  ];
  return urls;
}

function createLoginFields(credentials: ScraperSpecificCredentials) {
  return [
    { selector: '#userCode', value: credentials.userCode },
    { selector: '#password', value: credentials.password },
  ];
}

type ScraperSpecificCredentials = { userCode: string; password: string };

class HapoalimScraper extends BaseScraperWithBrowser<ScraperSpecificCredentials> {
  // eslint-disable-next-line class-methods-use-this
  get baseUrl() {
    return 'https://login.bankhapoalim.co.il';
  }

  getLoginOptions(credentials: ScraperSpecificCredentials) {
    return {
      loginUrl: `${this.baseUrl}/cgi-bin/poalwwwc?reqName=getLogonPage`,
      fields: createLoginFields(credentials),
      submitButtonSelector: '.login-btn',
      postAction: async () => waitForRedirect(this.page),
      possibleResults: getPossibleLoginResults(this.baseUrl),
    };
  }

  async fetchData() {
    return fetchAccountData(this.page, this.baseUrl, this.options);
  }
}

export default HapoalimScraper;
