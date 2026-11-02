export interface TransactionsAccount {
  accountNumber: string;
  balance?: number;
  balanceDate?: string;
  cardFrame?: number;
  cardType?: CardType;
  currency?: string;
  savingsAccount?: boolean;
  txns: Transaction[];
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

export enum LoanTypes {
  Loan = 'loan',
  Mortgage = 'mortgage',
}

export enum LoanInterestTypes {
  Fixed = 'fixed',
  Variable = 'variable',
}

export enum LoanLinkageTypes {
  None = 'none',
  Cpi = 'cpi',
}

export interface Loan {
  type: LoanTypes;
  /**
   * the bank account the loan is attached to, in the same format as `TransactionsAccount.accountNumber`
   */
  accountNumber: string;
  loanId: string;
  /**
   * the bank's display name for the loan or mortgage track
   */
  name?: string;
  currency: string;
  originalAmount: number;
  /**
   * the remaining principal (keren). Undefined when the bank doesn't expose it or it couldn't be fetched.
   */
  principalBalance?: number;
  /**
   * the balance required to pay off the loan, as reported by the bank: principal plus accrued
   * interest and linkage differences. Whether early repayment fees are included varies by bank.
   */
  totalBalance?: number;
  /**
   * ISO date string
   */
  startDate?: string;
  /**
   * ISO date string
   */
  endDate?: string;
  /**
   * the amount of the most recent periodic payment
   */
  lastPaymentAmount?: number;
  /**
   * the amount of the next scheduled payment
   */
  nextPaymentAmount?: number;
  /**
   * ISO date string of the next scheduled payment
   */
  nextPaymentDate?: string;
  /**
   * annual interest rate in percent, e.g. 4.5 for 4.5%
   */
  interestRate?: number;
  interestType?: LoanInterestTypes;
  linkage?: LoanLinkageTypes;
  /**
   * mortgage tracks (maslulim). The parent already covers the whole mortgage,
   * so consumers should not sum the parent and its tracks together.
   * Undefined when the tracks could not be fetched.
   */
  tracks?: Loan[];
}
