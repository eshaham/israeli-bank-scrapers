export interface BillingPeriod {
  /** ISO date string — the billing cycle closing date as returned by the bank */
  billingDate: string;
  /** 'previous' = closed/already debited from bank account; 'current' = open/still accumulating */
  status: 'previous' | 'current';
  /** Total amount charged in this billing period (in ILS), as reported directly by the bank API */
  total: number;
}

export interface TransactionsAccount {
  accountNumber: string;
  balance?: number;
  balanceDate?: string;
  cardFrame?: number;
  cardType?: CardType;
  txns: Transaction[];
  /** All billing periods for this account, including the current open period even if it has no transactions */
  billingPeriods?: BillingPeriod[];
}

export enum CardType {
  BankIssued = 'bankIssued',
  CompanyIssued = 'companyIssued',
}

export enum TransactionTypes {
  Normal = 'normal',
  Installments = 'installments',
}

export enum TransactionStatuses {
  Completed = 'completed',
  Pending = 'pending',
}

export interface TransactionInstallments {
  /**
   * the current installment number
   */
  number: number;

  /**
   * the total number of installments
   */
  total: number;
}

export interface Transaction {
  type: TransactionTypes;
  /**
   * sometimes called Asmachta
   */
  identifier?: string | number;
  /**
   * ISO date string
   */
  date: string;
  /**
   * ISO date string
   */
  processedDate: string;
  /**
   * ISO date string — the billing cycle closing date this transaction belongs to.
   * Unlike processedDate, this is never overridden by fullPaymentDate and always
   * identifies the billing period the transaction was scraped under.
   */
  billingDate?: string;
  originalAmount: number;
  originalCurrency: string;
  chargedAmount: number;
  chargedCurrency?: string;
  description: string;
  memo?: string;
  status: TransactionStatuses;
  installments?: TransactionInstallments;
  category?: string;
  rawTransaction?: unknown;
}
