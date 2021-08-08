import _ from 'lodash';
import buildUrl from 'build-url';
import moment, { Moment } from 'moment';

import {
  ScraperErrorTypes, BaseScraper,
  ScaperOptions, ScaperProgressTypes, ScraperCredentials,
} from './base-scraper';
import {
  SHEKEL_CURRENCY_SYMBOL,
  SHEKEL_CURRENCY,
  DOLLAR_CURRENCY_SYMBOL,
  DOLLAR_CURRENCY,
} from '../constants';
import { fetchGet, fetchPost } from '../helpers/fetch';
import { fixInstallments, sortTransactionsByDate, filterOldTransactions } from '../helpers/transactions';
import {
  TransactionsAccount, Transaction, TransactionStatuses, TransactionTypes,
} from '../transactions';

const BASE_URL = 'https://cal4u.cal-online.co.il/Cal4U';
const AUTH_URL = 'https://connect.cal-online.co.il/col-rest/calconnect/authentication/login';
const DATE_FORMAT = 'DD/MM/YYYY';

const PASSWORD_EXPIRED_MSGS = ['תוקף הסיסמא פג', 'אנו מתנצלים, עקב תקלה לא ניתן לבצע את הפעולה כעת.|ניתן לנסות שנית במועד מאוחר יותר'];
const INVALID_CREDENTIALS = 'שם המשתמש או הסיסמה שהוזנו שגויים';
const NO_DATA_FOUND_MSG = 'לא נמצאו חיובים לטווח תאריכים זה';
const ACCOUNT_BLOCKED_MSG = 'הכניסה למנוי נחסמה עקב ריבוי נסיונות כושלים. לשחרור המנוי באפשרותך לחדש סיסמה על ידי בחירת שכחתי שם משתמש סיסמה';

const NORMAL_TYPE_CODE = '5';
const REFUND_TYPE_CODE = '6';
const WITHDRAWAL_TYPE_CODE = '7';
const INSTALLMENTS_TYPE_CODE = '8';
const CANCEL_TYPE_CODE = '25';
const WITHDRAWAL_TYPE_CODE_2 = '27';
const DEBIT_TYPE_CODE = '41';
const DEBIT_REFUND_TYPE_CODE = '42';
const CREDIT_PAYMENTS_CODE = '59';
const MEMBERSHIP_FEE_TYPE_CODE = '67';
const SERVICES_REFUND_TYPE_CODE = '71';
const SERVICES_TYPE_CODE = '72';
const REFUND_TYPE_CODE_2 = '76';
const CANCEL_PAYMENT_CODE = '86';
const CANCELLED_TRANSACTION = '68';

const HEADER_SITE = { 'X-Site-Id': '05D905EB-810A-4680-9B23-1A2AC46533BF' };


interface BankDebitsResponse {
  Response: {
    Status: {
      Succeeded: boolean;
      Description: string;
      Message: string;
    };
  };
  Debits: {
    CardId: string;
    Date: string;
  }[];
}

interface BankAccountCard {
  Id: string;
  IsEffectiveInd: boolean;
  LastFourDigits: string;
}

interface CardByAccountResponse {
  Response: {
    Status: {
      Succeeded: boolean;
    };
  };
  BankAccounts: {
    AccountID: string;
    Cards: BankAccountCard[];
  }[];
}

interface ScrapedTransaction {
  Id: string;
  TransType: string;
  Date: string;
  DebitDate: string;
  Amount: {
    Value: number;
    Symbol: string;
  };
  DebitAmount: {
    Value: number;
  };
  MerchantDetails: {
    Name: string;
  };
  TransTypeDesc: string;
  TotalPayments?: string;
  CurrentPayment?: string;
}

function getBankDebitsUrl(accountId: string) {
  const toDate = moment().add(2, 'months');
  const fromDate = moment().subtract(6, 'months');

  return buildUrl(BASE_URL, {
    path: `CalBankDebits/${accountId}`,
    queryParams: {
      DebitLevel: 'A',
      DebitType: '2',
      FromMonth: (fromDate.month() + 1).toString().padStart(2, '0'),
      FromYear: fromDate.year().toString(),
      ToMonth: (toDate.month() + 1).toString().padStart(2, '0'),
      ToYear: toDate.year().toString(),
    },
  });
}

function getTransactionsUrl(cardId: string, debitDate: string) {
  return buildUrl(BASE_URL, {
    path: `CalTransactions/${cardId}`,
    queryParams: {
      ToDate: debitDate,
      FromDate: debitDate,
    },
  });
}

function convertTransactionType(txnType: string) {
  switch (txnType) {
    case NORMAL_TYPE_CODE:
    case REFUND_TYPE_CODE:
    case CANCEL_TYPE_CODE:
    case WITHDRAWAL_TYPE_CODE:
    case WITHDRAWAL_TYPE_CODE_2:
    case REFUND_TYPE_CODE_2:
    case CANCEL_PAYMENT_CODE:
    case CANCELLED_TRANSACTION:
    case SERVICES_REFUND_TYPE_CODE:
    case MEMBERSHIP_FEE_TYPE_CODE:
    case SERVICES_TYPE_CODE:
    case DEBIT_TYPE_CODE:
    case DEBIT_REFUND_TYPE_CODE:
      return TransactionTypes.Normal;
    case INSTALLMENTS_TYPE_CODE:
    case CREDIT_PAYMENTS_CODE:
      return TransactionTypes.Installments;
    default:
      throw new Error(`unknown transaction type ${txnType}`);
  }
}

function convertCurrency(currency: string) {
  switch (currency) {
    case SHEKEL_CURRENCY_SYMBOL:
      return SHEKEL_CURRENCY;
    case DOLLAR_CURRENCY_SYMBOL:
      return DOLLAR_CURRENCY;
    default:
      return currency;
  }
}

function getInstallmentsInfo(txn: ScrapedTransaction) {
  if (!txn.CurrentPayment || txn.CurrentPayment === '0') {
    return null;
  }

  return {
    number: parseInt(txn.CurrentPayment, 10),
    total: txn.TotalPayments ? parseInt(txn.TotalPayments, 10) : Number.NaN,
  };
}

function getTransactionMemo(txn: ScrapedTransaction) {
  const { TransType: txnType, TransTypeDesc: txnTypeDescription } = txn;
  switch (txnType) {
    case NORMAL_TYPE_CODE:
      return txnTypeDescription === 'רכישה רגילה' ? '' : txnTypeDescription;
    case INSTALLMENTS_TYPE_CODE:
      return `תשלום ${txn.CurrentPayment} מתוך ${txn.TotalPayments}`;
    default:
      return txn.TransTypeDesc;
  }
}

function convertTransactions(txns: ScrapedTransaction[]): Transaction[] {
  return txns.map((txn) => {
    return {
      type: convertTransactionType(txn.TransType),
      identifier: parseInt(txn.Id, 10),
      date: moment(txn.Date, DATE_FORMAT).toISOString(),
      processedDate: moment(txn.DebitDate, DATE_FORMAT).toISOString(),
      originalAmount: -txn.Amount.Value,
      originalCurrency: convertCurrency(txn.Amount.Symbol),
      chargedAmount: -txn.DebitAmount.Value,
      description: txn.MerchantDetails.Name,
      memo: getTransactionMemo(txn),
      installments: getInstallmentsInfo(txn) || undefined,
      status: TransactionStatuses.Completed,
    };
  });
}

function prepareTransactions(txns: Transaction[], startMoment: Moment, combineInstallments: boolean): Transaction[] {
  let clonedTxns: Transaction[] = Array.from(txns);
  if (!combineInstallments) {
    clonedTxns = fixInstallments(clonedTxns);
  }
  clonedTxns = sortTransactionsByDate(clonedTxns);
  clonedTxns = filterOldTransactions(clonedTxns, startMoment, combineInstallments);
  return clonedTxns;
}

async function getBankDebits(authHeader: Record<string, any>, accountId: string): Promise<BankDebitsResponse> {
  const bankDebitsUrl = getBankDebitsUrl(accountId);
  return fetchGet(bankDebitsUrl, authHeader);
}

async function getTransactionsNextPage(authHeader: Record<string, any>) {
  const hasNextPageUrl = `${BASE_URL}/CalTransNextPage`;
  return fetchGet<{ HasNextPage: boolean;
    Transactions?: ScrapedTransaction[];}>(hasNextPageUrl, authHeader);
}

async function fetchTxns(authHeader: Record<string, any>, cardId: string, debitDates: string[]): Promise<ScrapedTransaction[]> {
  const txns: ScrapedTransaction[] = [];
  for (const date of debitDates) {
    const fetchTxnUrl = getTransactionsUrl(cardId, date);
    let txnResponse = await fetchGet<{ HasNextPage: boolean;
      Transactions?: ScrapedTransaction[];}>(fetchTxnUrl, authHeader);
    if (txnResponse.Transactions) {
      txns.push(...txnResponse.Transactions);
    }
    while (txnResponse.HasNextPage) {
      txnResponse = await getTransactionsNextPage(authHeader);
      if (txnResponse.Transactions != null) {
        txns.push(...txnResponse.Transactions);
      }
    }
  }
  return txns;
}

async function getTxnsOfCard(authHeader: Record<string, any>, card: BankAccountCard, bankDebits: BankDebitsResponse['Debits']): Promise<ScrapedTransaction[]> {
  const cardId = card.Id;
  const cardDebitDates = bankDebits.filter((bankDebit) => {
    return bankDebit.CardId === cardId;
  }).map((cardDebit) => {
    return cardDebit.Date;
  });
  return fetchTxns(authHeader, cardId, cardDebitDates);
}

async function getTransactionsForAllAccounts(authHeader: Record<string, any>, startMoment: Moment, options: ScaperOptions) {
  const cardsByAccountUrl = `${BASE_URL}/CardsByAccounts`;
  const banksResponse = await fetchGet<CardByAccountResponse>(cardsByAccountUrl, authHeader);


  if (_.get(banksResponse, 'Response.Status.Succeeded')) {
    const accounts: TransactionsAccount[] = [];
    for (let i = 0; i < banksResponse.BankAccounts.length; i += 1) {
      const bank = banksResponse.BankAccounts[i];
      const bankDebits = await getBankDebits(authHeader, bank.AccountID);
      // Check that the bank has an active card to scrape
      if (bank.Cards.some((card) => card.IsEffectiveInd)) {
        if (_.get(bankDebits, 'Response.Status.Succeeded')) {
          for (let j = 0; j < bank.Cards.length; j += 1) {
            const rawTxns = await getTxnsOfCard(authHeader, bank.Cards[j], bankDebits.Debits);
            if (rawTxns) {
              let txns = convertTransactions(rawTxns);
              txns = prepareTransactions(txns, startMoment, options.combineInstallments || false);
              const result: TransactionsAccount = {
                accountNumber: bank.Cards[j].LastFourDigits,
                txns,
              };
              accounts.push(result);
            }
          }
        } else {
          const { Description, Message } = bankDebits.Response.Status;

          if (Message !== NO_DATA_FOUND_MSG) {
            const message = `${Description}. ${Message}`;
            throw new Error(message);
          }
        }
      }
    }
    return {
      success: true,
      accounts,
    };
  }

  return { success: false };
}

class VisaCalScraper extends BaseScraper {
  private authHeader = '';

  async login(credentials: ScraperCredentials) {
    const authRequest = {
      username: credentials.username,
      password: credentials.password,
      recaptcha: '',
    };

    this.emitProgress(ScaperProgressTypes.LoggingIn);

    const authResponse = await fetchPost(AUTH_URL, authRequest, HEADER_SITE);

    if (PASSWORD_EXPIRED_MSGS.includes(authResponse)) {
      return {
        success: false,
        errorType: ScraperErrorTypes.ChangePassword,
      };
    }

    if (authResponse === INVALID_CREDENTIALS) {
      return {
        success: false,
        errorType: ScraperErrorTypes.InvalidPassword,
      };
    }

    if (authResponse === ACCOUNT_BLOCKED_MSG) {
      return {
        success: false,
        errorType: ScraperErrorTypes.AccountBlocked,
      };
    }

    if (!authResponse || !authResponse.token) {
      return {
        success: false,
        errorType: ScraperErrorTypes.General,
        errorMessage: `No token found in authResponse: ${JSON.stringify(authResponse)}`,
      };
    }
    this.authHeader = `CALAuthScheme ${authResponse.token}`;
    this.emitProgress(ScaperProgressTypes.LoginSuccess);
    return { success: true };
  }

  async fetchData() {
    const defaultStartMoment = moment().subtract(1, 'years');
    const startDate = this.options.startDate || defaultStartMoment.toDate();
    const startMoment = moment.max(defaultStartMoment, moment(startDate));

    const authHeader = { Authorization: this.authHeader, ...HEADER_SITE };
    return getTransactionsForAllAccounts(authHeader, startMoment, this.options);
  }
}

export default VisaCalScraper;
