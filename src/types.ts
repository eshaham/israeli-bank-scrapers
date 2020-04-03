import { TransactionStatuses } from '@core/constants';

export interface CompanyAccount {
  accountNumber: string;
  txns: Transaction[];
}

export enum ErrorTypes {
  InvalidPassword ="invalidPassword",
  ChangePassword = "changePassword",
  Timeout = "timeout",
  Generic = "generic",
  General = "GENERAL_ERROR"
}

export interface LegacyLoginResult {
  success: boolean;
  errorType?: ErrorTypes;
  errorMessage?: string; // only on success=false
}


export interface LegacyScrapingResult {
  success: boolean;
  accounts?: CompanyAccount[];
  errorType?: ErrorTypes;
  errorMessage?: string; // only on success=false
}

export enum TransactionTypes {
  Normal = "normal",
  Installments = "installments"
}


export interface Transaction {
  type: TransactionTypes;
  identifier?: number;
  date: string;
  processedDate: string;
  originalAmount: number;
  originalCurrency: string;
  chargedAmount: number;
  description: string;
  memo: string;
  status: TransactionStatuses;
}

export interface CreditCardTransaction extends Transaction {
  installments: {
    number: number;
    total: number;
  };
}
