
export interface ScraperAccount {
  accountNumber: string;
  txns: Transaction[];
}

export enum ErrorTypes {
  InvalidPassword ='INVALID_PASSWORD',
  ChangePassword = 'CHANGE_PASSWORD',
  Timeout = 'TIMEOUT',
  Generic = 'GENERIC',
  General = 'GENERAL_ERROR'
}

export interface LegacyLoginResult {
  success: boolean;
  errorType?: ErrorTypes;
  errorMessage?: string; // only on success=false
}


export interface LegacyScrapingResult {
  success: boolean;
  accounts?: ScraperAccount[];
  errorType?: ErrorTypes;
  errorMessage?: string; // only on success=false
}

export enum TransactionTypes {
  Normal = 'normal',
  Installments = 'installments'
}

export enum TransactionStatuses {
  Completed = 'completed',
  Pending = 'pending'
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
  memo?: string;
  status: TransactionStatuses;
}

export interface NormalTransaction extends Transaction {
  type: TransactionTypes.Normal;
}

export interface InstallmentsTransaction extends Transaction {
  type: TransactionTypes.Installments;
  installments: {
    number: number;
    total: number;
  };
}
