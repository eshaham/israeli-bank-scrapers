export interface Portfolio {
  portfolioId: string;
  portfolioName: string;
  investments: Investment[];
}

export interface Investment {
  paperId: string;
  paperName: string;
  symbol: string;
  amount: number;
  value: number;
  currency: string;
}
