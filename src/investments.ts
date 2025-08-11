export interface Portfolio {
  portfolioId: string;
  portfolioName: string;
  investments: Investment[];
  transactions: InvestmentTransaction[];
}

export interface Investment {
  paperId: string;
  paperName: string;
  symbol: string;
  amount: number;
  value: number;
  currency: string;
}

export interface InvestmentTransaction {
  paperId: string;
  paperName: string;
  symbol: string;
  amount: number;
  value: number;
  currency: string;
  taxSum: number;
  executionDate: Date;
  executablePrice: number;
}
