/**
 * A normalized loan returned by a bank scraper.
 *
 * All monetary values are denominated in `currency`.
 * Dates use ISO 8601 date-only format (YYYY-MM-DD).
 */

export interface BankLoan {
  sourceAccountNumber: string;
  loanAccountNumber: string;

  name?: string;
  currency?: string;

  originalAmount?: number;
  principalBalance?: number;
  accruedInterest?: number;
  outstandingBalance?: number;
  payoffEstimate?: number;
  prepaymentPenaltyFee?: number;

  interestRate?: number;
  effectiveInterestRate?: number;
  baseInterestRate?: number;
  interestSpread?: number;

  monthlyPayment?: number;
  paymentsTotal?: number;
  paymentsMade?: number;
  paymentsRemaining?: number;

  nextPaymentDate?: string;
  endDate?: string;

  /**
   * Original provider response, included only
   * when includeRawLoan is enabled.
   */
  rawLoan?: unknown;
}
