import moment from 'moment';
import { SHEKEL_CURRENCY } from '../../constants';
import { getRawTransaction } from '../../helpers/transactions';
import {
  TransactionStatuses,
  TransactionTypes,
  type Transaction,
  type TransactionInstallments,
} from '../../transactions';
import { type ScraperOptions } from '../interface';

export const DATE_FORMAT = 'DD/MM/YYYY';
export const BILLING_MONTH_FORMAT = 'MM/YYYY';

export interface ScrapedLoginValidation {
  Header: {
    Status: string;
  };
  ValidateIdDataBean?: {
    userName?: string;
    returnCode: string;
  };
}

export interface ScrapedCard {
  companyCode: string;
  cardStatus: string;
  cardSuffix: string;
  serviceType: string;
  isActive: boolean;
  isBlock: boolean;
  isPartner: boolean;
  limitData?: {
    creditLimitAmount: string;
    limitUsed: string;
  };
  cardChargeNext?: {
    billingDate: string;
  };
}

export interface ScrapedCardListResponse {
  data: {
    cardsList: ScrapedCard[];
  } | null;
  errorCode: string;
  errorDescription: string | null;
  isSuccess: boolean;
}

export interface ScrapedMonthlyBillingResponse {
  data: {
    cards: Record<string, { billingDate: string }>;
  } | null;
  errorCode: string;
  errorDescription: string | null;
  isSuccess: boolean;
}

export interface ScrapedApprovedTransaction {
  purchaseDate: string;
  israelTransactionTime: string;
  businessName: string;
  originalAmount: number;
  currencyIso: string;
  ilsBillingAmount: number;
  extraDetails: string | null;
  seqConfirmationNumber: string;
  branchCodeDescription: string | null;
}

export interface ScrapedVoucher {
  purchaseDate: string;
  purchaseTime: string | null;
  businessName: string;
  originalAmount: number;
  originalCurrencyIso: string;
  billingAmount: number;
  moreInfo: string | null;
  seqVoucherNumber: string;
  currentInstallmentNum: number | null;
  numberOfInstallment: number | null;
  transactionDescription: string | null;
}

export interface ScrapedOutOfStatementGroup {
  immediateVouchersCurrencyDate: ScrapedVoucher[];
  totalVouchersCurrencyDate: {
    dateImmediateVouchers?: string;
  };
}

export interface ScrapedTransactionsResponse {
  data: {
    approvals: { approvedTransactions: ScrapedApprovedTransaction[] } | null;
    israelAbroadVouchers: {
      vouchers: {
        israelAbroadVouchersList: ScrapedVoucher[];
      };
      outOfStatementChargeDateVouchers: ScrapedOutOfStatementGroup[];
    } | null;
  } | null;
  errorCode: string;
  errorDescription: string | null;
  isSuccess: boolean;
}

export function getCardBalance(card: ScrapedCard): number | undefined {
  if (!card.limitData) {
    return undefined;
  }
  const limitUsed = Number(card.limitData.limitUsed);
  return Number.isNaN(limitUsed) ? undefined : -limitUsed;
}

export function getCardFrame(card: ScrapedCard): number | undefined {
  if (!card.limitData) {
    return undefined;
  }
  const creditLimit = Number(card.limitData.creditLimitAmount);
  return Number.isNaN(creditLimit) ? undefined : creditLimit;
}

export function getCardBalanceDate(card: ScrapedCard): string | undefined {
  if (!card.cardChargeNext?.billingDate) {
    return undefined;
  }
  return moment(card.cardChargeNext.billingDate, DATE_FORMAT).toISOString();
}

export function isApprovedTransactionSettled(
  approved: ScrapedApprovedTransaction,
  vouchers: ScrapedVoucher[],
): boolean {
  return vouchers.some(
    voucher =>
      voucher.purchaseDate === approved.purchaseDate &&
      voucher.originalAmount === approved.originalAmount &&
      voucher.originalCurrencyIso === approved.currencyIso &&
      (voucher.businessName || '').trim() === (approved.businessName || '').trim(),
  );
}

export function convertApprovedTransaction(txn: ScrapedApprovedTransaction, options?: ScraperOptions): Transaction {
  const isoDate = moment(`${txn.purchaseDate} ${txn.israelTransactionTime}`, `${DATE_FORMAT} HH:mm`).toISOString();

  const result: Transaction = {
    type: TransactionTypes.Normal,
    identifier: txn.seqConfirmationNumber,
    date: isoDate,
    processedDate: isoDate,
    originalAmount: -txn.originalAmount,
    originalCurrency: txn.currencyIso,
    chargedAmount: -txn.ilsBillingAmount,
    chargedCurrency: SHEKEL_CURRENCY,
    description: (txn.businessName || '').trim(),
    memo: txn.extraDetails || '',
    category: txn.branchCodeDescription?.trim() || undefined,
    status: TransactionStatuses.Pending,
  };

  if (options?.includeRawTransaction) {
    result.rawTransaction = getRawTransaction(txn);
  }

  return result;
}

export function getVoucherInstallments(voucher: ScrapedVoucher): TransactionInstallments | undefined {
  if (!voucher.numberOfInstallment || !voucher.currentInstallmentNum) {
    return undefined;
  }
  return {
    number: voucher.currentInstallmentNum,
    total: voucher.numberOfInstallment,
  };
}

export function convertVoucher(
  voucher: ScrapedVoucher,
  processedDateIso: string,
  options?: ScraperOptions,
): Transaction {
  const dateMoment = moment(`${voucher.purchaseDate} ${voucher.purchaseTime || '00:00:00'}`, `${DATE_FORMAT} HH:mm:ss`);
  const installments = getVoucherInstallments(voucher);

  const result: Transaction = {
    type: installments ? TransactionTypes.Installments : TransactionTypes.Normal,
    identifier: voucher.seqVoucherNumber,
    date: dateMoment.toISOString(),
    processedDate: processedDateIso,
    originalAmount: -voucher.originalAmount,
    originalCurrency: voucher.originalCurrencyIso,
    chargedAmount: -voucher.billingAmount,
    chargedCurrency: SHEKEL_CURRENCY,
    description: (voucher.businessName || '').trim(),
    memo: (voucher.moreInfo || '').trim(),
    category: voucher.transactionDescription?.trim() || undefined,
    installments,
    status: TransactionStatuses.Completed,
  };

  if (options?.includeRawTransaction) {
    result.rawTransaction = getRawTransaction(voucher);
  }

  return result;
}
