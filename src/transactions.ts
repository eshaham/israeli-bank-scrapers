
export interface TransactionsAccount {
  accountNumber: string;
  txns: Transaction[];
}

export enum TransactionTypes {
  Normal = 'normal',
  Installments = 'installments'
}

export enum TransactionStatuses {
  Completed = 'completed',
  Pending = 'pending'
}

export interface TransactionInstallments {
  number: number;
  total: number;
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
  installments?: TransactionInstallments;
}
