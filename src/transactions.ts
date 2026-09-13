export interface TransactionsAccount {
  accountNumber: string;
  name?: string;
  balance?: number;
  balanceDate?: string;
  cardFrame?: number;
  cardType?: CardType;
  currency?: string;
  savingsAccount?: boolean;
  investmentAccount?: boolean;
  holdings?: InvestmentHolding[];
  txns: Transaction[];
}

export interface InvestmentHolding {
  identifier: string | number;
  name: string;
  symbol?: string;
  quantity: number;
  averagePrice: number;
  lastPrice: number;
  value: number;
  valueCurrency: string;
  profit: number;
  profitCurrency: string;
  profitPercent: number;
  dailyChangePercent: number;
  portfolioPercent: number;
  securityType?: string;
  regionId?: number;
  countryId?: number;
  currencyRate?: number;
  rawHolding?: unknown;
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
