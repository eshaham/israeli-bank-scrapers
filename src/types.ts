export interface Transaction {
  type: string;
  identifier: any;
  date: string;
  processedDate: string;
  originalAmount: any;
  originalCurrency: string;
  chargedAmount: any;
  description: any;
  status: string;
  memo: string | null;
}
