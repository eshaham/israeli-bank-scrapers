export interface TransactionsAccount {
  accountNumber: string;
  balance?: number;
  balanceDate?: string;
  cardFrame?: number;
  cardType?: CardType;
  currency?: string;
  savingsAccount?: boolean;
  txns: Transaction[];
  /** FIBI asset snapshot fields, populated only with the beinleumi:assets opt-in. */
  assetsDate?: string;
  foreignCurrencyBalances?: ForeignCurrencyBalance[];
  securitiesPortfolio?: SecuritiesPortfolio;
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

/** Bank-reported balance in the original currency; valueInILS is a separate valuation. */
export interface ForeignCurrencyBalance {
  currency: string;
  balance: number;
  valueInILS: number;
}

export interface SecurityHolding {
  securityNumber: string;
  isin?: string;
  symbol?: string;
  name: string;
  type: string;
  currency: string;
  quantity: number;
  marketValue: number;
  valueInILS: number;
  /** Prices in currency units, after checking the bank's quote unit against marketValue. */
  unitPrice?: number;
  adjustedCostPrice?: number;
}

export interface SecuritiesPortfolio {
  currency: 'ILS';
  value: number;
  holdings: SecurityHolding[];
}
