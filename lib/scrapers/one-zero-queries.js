"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.GET_MOVEMENTS = exports.GET_CUSTOMER = void 0;
const GET_CUSTOMER = exports.GET_CUSTOMER = `
query GetCustomer {
  customer {
    __typename
    customerId
    userId
    idType
    idNumber
    hebrewFirstName
    hebrewLastName
    latinFirstName
    latinLastName
    dateOfBirth
    lastLoginDate
    userEmail
    gender
    portfolioRelations {
      __typename
      customerId
      customerRole
      portfolioId
      initiator
      relationToInitiator
      status
    }
    portfolios {
      __typename
      ...Portfolio
    }
    status
  }
}
fragment Portfolio on Portfolio {
  __typename
  accounts {
    __typename
    accountId
    accountType
    closingDate
    currency
    openingDate
    status
    subType
  }
  activationDate
  bank
  baseCurrency
  branch
  club
  clubDescription
  iban
  imageURL
  isJointAccount
  partnerName {
    __typename
    partnerFirstName
    partnerLastName
  }
  portfolioId
  portfolioNum
  portfolioType
  status
  subType
  onboardingCompleted
}
`;
const GET_MOVEMENTS = exports.GET_MOVEMENTS = `query GetMovements(
  $portfolioId: String!
  $accountId: String!
  $pagination: PaginationInput!
  $language: BffLanguage!
) {
  movements(
    portfolioId: $portfolioId
    accountId: $accountId
    pagination: $pagination
    language: $language
  ) {
    __typename
    ...MovementsFragment
  }
}
fragment TransactionInstrumentAmountFragment on TransactionInstrumentAmount {
  __typename
  instrumentAmount
  instrumentSymbol
  instrumentType
}
fragment CounterPartyReferenceFragment on CounterPartyReference {
  __typename
  bankId
  bic
  branchCode
  id
  name
  type
}
fragment BaseTransactionFragment on BaseTransaction {
  __typename
  accountId
  betweenOwnAccounts
  bookDate
  calculatedStatus
  chargeAmount {
    __typename
    ...TransactionInstrumentAmountFragment
  }
  clearingSystem
  counterParty {
    __typename
    ...CounterPartyReferenceFragment
  }
  currentPaymentNumber
  direction
  domainType
  isReversal
  method
  originalAmount {
    __typename
    ...TransactionInstrumentAmountFragment
  }
  portfolioId
  totalPaymentsCount
  transactionId
  transactionType
  valueDate
}
fragment CategoryFragment on Category {
  __typename
  categoryId
  dataSource
  subCategoryId
}
fragment RecurrenceFragment on Recurrence {
  __typename
  dataSource
  isRecurrent
}
fragment TransactionEnrichmentFragment on TransactionEnrichment {
  __typename
  categories {
    __typename
    ...CategoryFragment
  }
  recurrences {
    __typename
    ...RecurrenceFragment
  }
}
fragment TransactionEventMetadataFragment on TransactionEventMetadata {
  __typename
  correlationId
  processingOrder
}
fragment CounterPartyTransferData on CounterPartyTransfer {
  __typename
  accountId
  bank_id
  branch_code
  counter_party_name
}
fragment BankTransferDetailsData on BankTransferDetails {
  __typename
  ... on CashBlockTransfer {
    counterParty {
      __typename
      ...CounterPartyTransferData
    }
    transferDescriptionKey
  }
  ... on RTGSReturnTransfer {
    transferDescriptionKey
  }
  ... on RTGSTransfer {
    transferDescriptionKey
  }
  ... on SwiftReturnTransfer {
    transferConversionRate
    transferDescriptionKey
  }
  ... on SwiftTransfer {
    transferConversionRate
    transferDescriptionKey
  }
  ... on Transfer {
    counterParty {
      __typename
      ...CounterPartyTransferData
    }
    transferDescriptionKey
  }
}
fragment CategoryData on Category {
  __typename
  categoryId
  dataSource
  subCategoryId
}
fragment RecurrenceData on Recurrence {
  __typename
  dataSource
  isRecurrent
}
fragment CardDetailsData on CardDetails {
  __typename
  ... on CardCharge {
    book_date
    cardDescriptionKey
  }
  ... on CardChargeFCY {
    book_date
    cardConversionRate
    cardDescriptionKey
    cardFCYAmount
    cardFCYCurrency
  }
  ... on CardMonthlySettlement {
    cardDescriptionKey
  }
  ... on CardRefund {
    cardDescriptionKey
  }
  ... on CashBlockCardCharge {
    cardDescriptionKey
  }
}
fragment CashDetailsData on CashDetails {
  __typename
  ... on CashWithdrawal {
    cashDescriptionKey
  }
  ... on CashWithdrawalFCY {
    FCYAmount
    FCYCurrency
    cashDescriptionKey
    conversionRate
  }
}
fragment ChequesDetailsData on ChequesDetails {
  __typename
  ... on CashBlockChequeDeposit {
    bookDate
    chequesDescriptionKey
  }
  ... on ChequeDeposit {
    bookDate
    chequesDescriptionKey
  }
  ... on ChequeReturn {
    bookDate
    chequeReturnReason
    chequesDescriptionKey
  }
  ... on ChequeWithdrawal {
    chequesDescriptionKey
  }
}
fragment DefaultDetailsData on DefaultDetails {
  __typename
  ... on DefaultWithTransaction {
    defaultDescriptionKey
  }
  ... on DefaultWithoutTransaction {
    categories {
      __typename
      ...CategoryData
    }
    defaultDescriptionKey
  }
}
fragment FeeDetailsData on FeeDetails {
  __typename
  ... on GeneralFee {
    feeDescriptionKey
  }
}
fragment LoanDetailsData on LoanDetails {
  __typename
  ... on FullPrePayment {
    loanDescriptionKey
  }
  ... on Initiate {
    loanDescriptionKey
  }
  ... on MonthlyPayment {
    loanDescriptionKey
    loanPaymentNumber
    loanTotalPaymentsCount
  }
  ... on PartialPrePayment {
    loanDescriptionKey
  }
}
fragment MandateDetailsData on MandateDetails {
  __typename
  ... on MandatePayment {
    mandateDescriptionKey
  }
  ... on MandateReturnPayment {
    mandateDescriptionKey
  }
}
fragment SavingsDetailsData on SavingsDetails {
  __typename
  ... on FullSavingsWithdrawal {
    savingsDescriptionKey
  }
  ... on MonthlySavingsDeposit {
    savingsDepositNumber
    savingsDescriptionKey
    savingsTotalDepositCount
  }
  ... on PartialSavingsWithdrawal {
    savingsDescriptionKey
  }
  ... on SavingsClosing {
    savingsDescriptionKey
  }
  ... on SavingsDeposit {
    savingsDescriptionKey
  }
  ... on SavingsInterest {
    savingsDescriptionKey
  }
  ... on SavingsPenalty {
    savingsDescriptionKey
  }
  ... on SavingsTax {
    savingsDescriptionKey
  }
}
fragment SubscriptionDetailsData on SubscriptionDetails {
  __typename
  ... on SubscriptionPayment {
    subscriptionDescriptionKey
  }
  ... on SubscriptionReturnPayment {
    subscriptionDescriptionKey
  }
}
fragment TransactionsDetailsData on TransactionDetails {
  __typename
  ... on BankTransfer {
    bank_transfer_details {
      __typename
      ...BankTransferDetailsData
    }
    book_date
    categories {
      __typename
      ...CategoryData
    }
    recurrences {
      __typename
      ...RecurrenceData
    }
    value_date
  }
  ... on Card {
    card_details {
      __typename
      ...CardDetailsData
    }
    categories {
      __typename
      ...CategoryData
    }
    recurrences {
      __typename
      ...RecurrenceData
    }
    value_date
  }
  ... on Cash {
    cash_details {
      __typename
      ...CashDetailsData
    }
    categories {
      __typename
      ...CategoryData
    }
    recurrences {
      __typename
      ...RecurrenceData
    }
    value_date
  }
  ... on Cheques {
    categories {
      __typename
      ...CategoryData
    }
    chequesDetails {
      __typename
      ...ChequesDetailsData
    }
    recurrences {
      __typename
      ...RecurrenceData
    }
    valueDate
    referenceNumber
    frontImageUrl
    backImageUrl
  }
  ... on Default {
    default_details {
      __typename
      ...DefaultDetailsData
    }
    recurrences {
      __typename
      ...RecurrenceData
    }
    value_date
  }
  ... on Fee {
    categories {
      __typename
      ...CategoryData
    }
    fee_details {
      __typename
      ...FeeDetailsData
    }
    value_date
  }
  ... on Loans {
    categories {
      __typename
      ...CategoryData
    }
    loan_details {
      __typename
      ...LoanDetailsData
    }
    recurrences {
      __typename
      ...RecurrenceData
    }
    value_date
  }
  ... on Mandate {
    categories {
      __typename
      ...CategoryData
    }
    mandate_details {
      __typename
      ...MandateDetailsData
    }
    recurrences {
      __typename
      ...RecurrenceData
    }
    value_date
  }
  ... on Savings {
    categories {
      __typename
      ...CategoryData
    }
    recurrences {
      __typename
      ...RecurrenceData
    }
    savings_details {
      __typename
      ...SavingsDetailsData
    }
    value_date
  }
  ... on SubscriptionTransaction {
    categories {
      __typename
      ...CategoryData
    }
    recurrences {
      __typename
      ...RecurrenceData
    }
    subscription_details {
      __typename
      ...SubscriptionDetailsData
    }
    value_date
  }
}
fragment TransactionFragment on Transaction {
  __typename
  baseTransaction {
    __typename
    ...BaseTransactionFragment
  }
  enrichment {
    __typename
    ...TransactionEnrichmentFragment
  }
  metadata {
    __typename
    ...TransactionEventMetadataFragment
  }
  referenceNumber
  transactionDetails {
    __typename
    ...TransactionsDetailsData
  }
}
fragment MovementFragment on Movement {
  __typename
  accountId
  bankCurrencyAmount
  bookingDate
  conversionRate
  creditDebit
  description
  isReversed
  linkTransaction {
    __typename
    ...TransactionFragment
  }
  movementAmount
  movementCurrency
  movementId
  movementReversedId
  movementTimestamp
  movementType
  portfolioId
  runningBalance
  transaction {
    __typename
    ...TransactionFragment
  }
  valueDate
}
fragment PaginationFragment on Pagination {
  __typename
  cursor
  hasMore
}
fragment MovementsFragment on Movements {
  __typename
  isRunningBalanceInSync
  movements {
    __typename
    ...MovementFragment
  }
  pagination {
    __typename
    ...PaginationFragment
  }
}`;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJHRVRfQ1VTVE9NRVIiLCJleHBvcnRzIiwiR0VUX01PVkVNRU5UUyJdLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9zY3JhcGVycy9vbmUtemVyby1xdWVyaWVzLnRzIl0sInNvdXJjZXNDb250ZW50IjpbImV4cG9ydCBjb25zdCBHRVRfQ1VTVE9NRVIgPSBgXG5xdWVyeSBHZXRDdXN0b21lciB7XG4gIGN1c3RvbWVyIHtcbiAgICBfX3R5cGVuYW1lXG4gICAgY3VzdG9tZXJJZFxuICAgIHVzZXJJZFxuICAgIGlkVHlwZVxuICAgIGlkTnVtYmVyXG4gICAgaGVicmV3Rmlyc3ROYW1lXG4gICAgaGVicmV3TGFzdE5hbWVcbiAgICBsYXRpbkZpcnN0TmFtZVxuICAgIGxhdGluTGFzdE5hbWVcbiAgICBkYXRlT2ZCaXJ0aFxuICAgIGxhc3RMb2dpbkRhdGVcbiAgICB1c2VyRW1haWxcbiAgICBnZW5kZXJcbiAgICBwb3J0Zm9saW9SZWxhdGlvbnMge1xuICAgICAgX190eXBlbmFtZVxuICAgICAgY3VzdG9tZXJJZFxuICAgICAgY3VzdG9tZXJSb2xlXG4gICAgICBwb3J0Zm9saW9JZFxuICAgICAgaW5pdGlhdG9yXG4gICAgICByZWxhdGlvblRvSW5pdGlhdG9yXG4gICAgICBzdGF0dXNcbiAgICB9XG4gICAgcG9ydGZvbGlvcyB7XG4gICAgICBfX3R5cGVuYW1lXG4gICAgICAuLi5Qb3J0Zm9saW9cbiAgICB9XG4gICAgc3RhdHVzXG4gIH1cbn1cbmZyYWdtZW50IFBvcnRmb2xpbyBvbiBQb3J0Zm9saW8ge1xuICBfX3R5cGVuYW1lXG4gIGFjY291bnRzIHtcbiAgICBfX3R5cGVuYW1lXG4gICAgYWNjb3VudElkXG4gICAgYWNjb3VudFR5cGVcbiAgICBjbG9zaW5nRGF0ZVxuICAgIGN1cnJlbmN5XG4gICAgb3BlbmluZ0RhdGVcbiAgICBzdGF0dXNcbiAgICBzdWJUeXBlXG4gIH1cbiAgYWN0aXZhdGlvbkRhdGVcbiAgYmFua1xuICBiYXNlQ3VycmVuY3lcbiAgYnJhbmNoXG4gIGNsdWJcbiAgY2x1YkRlc2NyaXB0aW9uXG4gIGliYW5cbiAgaW1hZ2VVUkxcbiAgaXNKb2ludEFjY291bnRcbiAgcGFydG5lck5hbWUge1xuICAgIF9fdHlwZW5hbWVcbiAgICBwYXJ0bmVyRmlyc3ROYW1lXG4gICAgcGFydG5lckxhc3ROYW1lXG4gIH1cbiAgcG9ydGZvbGlvSWRcbiAgcG9ydGZvbGlvTnVtXG4gIHBvcnRmb2xpb1R5cGVcbiAgc3RhdHVzXG4gIHN1YlR5cGVcbiAgb25ib2FyZGluZ0NvbXBsZXRlZFxufVxuYDtcblxuZXhwb3J0IGNvbnN0IEdFVF9NT1ZFTUVOVFMgPSBgcXVlcnkgR2V0TW92ZW1lbnRzKFxuICAkcG9ydGZvbGlvSWQ6IFN0cmluZyFcbiAgJGFjY291bnRJZDogU3RyaW5nIVxuICAkcGFnaW5hdGlvbjogUGFnaW5hdGlvbklucHV0IVxuICAkbGFuZ3VhZ2U6IEJmZkxhbmd1YWdlIVxuKSB7XG4gIG1vdmVtZW50cyhcbiAgICBwb3J0Zm9saW9JZDogJHBvcnRmb2xpb0lkXG4gICAgYWNjb3VudElkOiAkYWNjb3VudElkXG4gICAgcGFnaW5hdGlvbjogJHBhZ2luYXRpb25cbiAgICBsYW5ndWFnZTogJGxhbmd1YWdlXG4gICkge1xuICAgIF9fdHlwZW5hbWVcbiAgICAuLi5Nb3ZlbWVudHNGcmFnbWVudFxuICB9XG59XG5mcmFnbWVudCBUcmFuc2FjdGlvbkluc3RydW1lbnRBbW91bnRGcmFnbWVudCBvbiBUcmFuc2FjdGlvbkluc3RydW1lbnRBbW91bnQge1xuICBfX3R5cGVuYW1lXG4gIGluc3RydW1lbnRBbW91bnRcbiAgaW5zdHJ1bWVudFN5bWJvbFxuICBpbnN0cnVtZW50VHlwZVxufVxuZnJhZ21lbnQgQ291bnRlclBhcnR5UmVmZXJlbmNlRnJhZ21lbnQgb24gQ291bnRlclBhcnR5UmVmZXJlbmNlIHtcbiAgX190eXBlbmFtZVxuICBiYW5rSWRcbiAgYmljXG4gIGJyYW5jaENvZGVcbiAgaWRcbiAgbmFtZVxuICB0eXBlXG59XG5mcmFnbWVudCBCYXNlVHJhbnNhY3Rpb25GcmFnbWVudCBvbiBCYXNlVHJhbnNhY3Rpb24ge1xuICBfX3R5cGVuYW1lXG4gIGFjY291bnRJZFxuICBiZXR3ZWVuT3duQWNjb3VudHNcbiAgYm9va0RhdGVcbiAgY2FsY3VsYXRlZFN0YXR1c1xuICBjaGFyZ2VBbW91bnQge1xuICAgIF9fdHlwZW5hbWVcbiAgICAuLi5UcmFuc2FjdGlvbkluc3RydW1lbnRBbW91bnRGcmFnbWVudFxuICB9XG4gIGNsZWFyaW5nU3lzdGVtXG4gIGNvdW50ZXJQYXJ0eSB7XG4gICAgX190eXBlbmFtZVxuICAgIC4uLkNvdW50ZXJQYXJ0eVJlZmVyZW5jZUZyYWdtZW50XG4gIH1cbiAgY3VycmVudFBheW1lbnROdW1iZXJcbiAgZGlyZWN0aW9uXG4gIGRvbWFpblR5cGVcbiAgaXNSZXZlcnNhbFxuICBtZXRob2RcbiAgb3JpZ2luYWxBbW91bnQge1xuICAgIF9fdHlwZW5hbWVcbiAgICAuLi5UcmFuc2FjdGlvbkluc3RydW1lbnRBbW91bnRGcmFnbWVudFxuICB9XG4gIHBvcnRmb2xpb0lkXG4gIHRvdGFsUGF5bWVudHNDb3VudFxuICB0cmFuc2FjdGlvbklkXG4gIHRyYW5zYWN0aW9uVHlwZVxuICB2YWx1ZURhdGVcbn1cbmZyYWdtZW50IENhdGVnb3J5RnJhZ21lbnQgb24gQ2F0ZWdvcnkge1xuICBfX3R5cGVuYW1lXG4gIGNhdGVnb3J5SWRcbiAgZGF0YVNvdXJjZVxuICBzdWJDYXRlZ29yeUlkXG59XG5mcmFnbWVudCBSZWN1cnJlbmNlRnJhZ21lbnQgb24gUmVjdXJyZW5jZSB7XG4gIF9fdHlwZW5hbWVcbiAgZGF0YVNvdXJjZVxuICBpc1JlY3VycmVudFxufVxuZnJhZ21lbnQgVHJhbnNhY3Rpb25FbnJpY2htZW50RnJhZ21lbnQgb24gVHJhbnNhY3Rpb25FbnJpY2htZW50IHtcbiAgX190eXBlbmFtZVxuICBjYXRlZ29yaWVzIHtcbiAgICBfX3R5cGVuYW1lXG4gICAgLi4uQ2F0ZWdvcnlGcmFnbWVudFxuICB9XG4gIHJlY3VycmVuY2VzIHtcbiAgICBfX3R5cGVuYW1lXG4gICAgLi4uUmVjdXJyZW5jZUZyYWdtZW50XG4gIH1cbn1cbmZyYWdtZW50IFRyYW5zYWN0aW9uRXZlbnRNZXRhZGF0YUZyYWdtZW50IG9uIFRyYW5zYWN0aW9uRXZlbnRNZXRhZGF0YSB7XG4gIF9fdHlwZW5hbWVcbiAgY29ycmVsYXRpb25JZFxuICBwcm9jZXNzaW5nT3JkZXJcbn1cbmZyYWdtZW50IENvdW50ZXJQYXJ0eVRyYW5zZmVyRGF0YSBvbiBDb3VudGVyUGFydHlUcmFuc2ZlciB7XG4gIF9fdHlwZW5hbWVcbiAgYWNjb3VudElkXG4gIGJhbmtfaWRcbiAgYnJhbmNoX2NvZGVcbiAgY291bnRlcl9wYXJ0eV9uYW1lXG59XG5mcmFnbWVudCBCYW5rVHJhbnNmZXJEZXRhaWxzRGF0YSBvbiBCYW5rVHJhbnNmZXJEZXRhaWxzIHtcbiAgX190eXBlbmFtZVxuICAuLi4gb24gQ2FzaEJsb2NrVHJhbnNmZXIge1xuICAgIGNvdW50ZXJQYXJ0eSB7XG4gICAgICBfX3R5cGVuYW1lXG4gICAgICAuLi5Db3VudGVyUGFydHlUcmFuc2ZlckRhdGFcbiAgICB9XG4gICAgdHJhbnNmZXJEZXNjcmlwdGlvbktleVxuICB9XG4gIC4uLiBvbiBSVEdTUmV0dXJuVHJhbnNmZXIge1xuICAgIHRyYW5zZmVyRGVzY3JpcHRpb25LZXlcbiAgfVxuICAuLi4gb24gUlRHU1RyYW5zZmVyIHtcbiAgICB0cmFuc2ZlckRlc2NyaXB0aW9uS2V5XG4gIH1cbiAgLi4uIG9uIFN3aWZ0UmV0dXJuVHJhbnNmZXIge1xuICAgIHRyYW5zZmVyQ29udmVyc2lvblJhdGVcbiAgICB0cmFuc2ZlckRlc2NyaXB0aW9uS2V5XG4gIH1cbiAgLi4uIG9uIFN3aWZ0VHJhbnNmZXIge1xuICAgIHRyYW5zZmVyQ29udmVyc2lvblJhdGVcbiAgICB0cmFuc2ZlckRlc2NyaXB0aW9uS2V5XG4gIH1cbiAgLi4uIG9uIFRyYW5zZmVyIHtcbiAgICBjb3VudGVyUGFydHkge1xuICAgICAgX190eXBlbmFtZVxuICAgICAgLi4uQ291bnRlclBhcnR5VHJhbnNmZXJEYXRhXG4gICAgfVxuICAgIHRyYW5zZmVyRGVzY3JpcHRpb25LZXlcbiAgfVxufVxuZnJhZ21lbnQgQ2F0ZWdvcnlEYXRhIG9uIENhdGVnb3J5IHtcbiAgX190eXBlbmFtZVxuICBjYXRlZ29yeUlkXG4gIGRhdGFTb3VyY2VcbiAgc3ViQ2F0ZWdvcnlJZFxufVxuZnJhZ21lbnQgUmVjdXJyZW5jZURhdGEgb24gUmVjdXJyZW5jZSB7XG4gIF9fdHlwZW5hbWVcbiAgZGF0YVNvdXJjZVxuICBpc1JlY3VycmVudFxufVxuZnJhZ21lbnQgQ2FyZERldGFpbHNEYXRhIG9uIENhcmREZXRhaWxzIHtcbiAgX190eXBlbmFtZVxuICAuLi4gb24gQ2FyZENoYXJnZSB7XG4gICAgYm9va19kYXRlXG4gICAgY2FyZERlc2NyaXB0aW9uS2V5XG4gIH1cbiAgLi4uIG9uIENhcmRDaGFyZ2VGQ1kge1xuICAgIGJvb2tfZGF0ZVxuICAgIGNhcmRDb252ZXJzaW9uUmF0ZVxuICAgIGNhcmREZXNjcmlwdGlvbktleVxuICAgIGNhcmRGQ1lBbW91bnRcbiAgICBjYXJkRkNZQ3VycmVuY3lcbiAgfVxuICAuLi4gb24gQ2FyZE1vbnRobHlTZXR0bGVtZW50IHtcbiAgICBjYXJkRGVzY3JpcHRpb25LZXlcbiAgfVxuICAuLi4gb24gQ2FyZFJlZnVuZCB7XG4gICAgY2FyZERlc2NyaXB0aW9uS2V5XG4gIH1cbiAgLi4uIG9uIENhc2hCbG9ja0NhcmRDaGFyZ2Uge1xuICAgIGNhcmREZXNjcmlwdGlvbktleVxuICB9XG59XG5mcmFnbWVudCBDYXNoRGV0YWlsc0RhdGEgb24gQ2FzaERldGFpbHMge1xuICBfX3R5cGVuYW1lXG4gIC4uLiBvbiBDYXNoV2l0aGRyYXdhbCB7XG4gICAgY2FzaERlc2NyaXB0aW9uS2V5XG4gIH1cbiAgLi4uIG9uIENhc2hXaXRoZHJhd2FsRkNZIHtcbiAgICBGQ1lBbW91bnRcbiAgICBGQ1lDdXJyZW5jeVxuICAgIGNhc2hEZXNjcmlwdGlvbktleVxuICAgIGNvbnZlcnNpb25SYXRlXG4gIH1cbn1cbmZyYWdtZW50IENoZXF1ZXNEZXRhaWxzRGF0YSBvbiBDaGVxdWVzRGV0YWlscyB7XG4gIF9fdHlwZW5hbWVcbiAgLi4uIG9uIENhc2hCbG9ja0NoZXF1ZURlcG9zaXQge1xuICAgIGJvb2tEYXRlXG4gICAgY2hlcXVlc0Rlc2NyaXB0aW9uS2V5XG4gIH1cbiAgLi4uIG9uIENoZXF1ZURlcG9zaXQge1xuICAgIGJvb2tEYXRlXG4gICAgY2hlcXVlc0Rlc2NyaXB0aW9uS2V5XG4gIH1cbiAgLi4uIG9uIENoZXF1ZVJldHVybiB7XG4gICAgYm9va0RhdGVcbiAgICBjaGVxdWVSZXR1cm5SZWFzb25cbiAgICBjaGVxdWVzRGVzY3JpcHRpb25LZXlcbiAgfVxuICAuLi4gb24gQ2hlcXVlV2l0aGRyYXdhbCB7XG4gICAgY2hlcXVlc0Rlc2NyaXB0aW9uS2V5XG4gIH1cbn1cbmZyYWdtZW50IERlZmF1bHREZXRhaWxzRGF0YSBvbiBEZWZhdWx0RGV0YWlscyB7XG4gIF9fdHlwZW5hbWVcbiAgLi4uIG9uIERlZmF1bHRXaXRoVHJhbnNhY3Rpb24ge1xuICAgIGRlZmF1bHREZXNjcmlwdGlvbktleVxuICB9XG4gIC4uLiBvbiBEZWZhdWx0V2l0aG91dFRyYW5zYWN0aW9uIHtcbiAgICBjYXRlZ29yaWVzIHtcbiAgICAgIF9fdHlwZW5hbWVcbiAgICAgIC4uLkNhdGVnb3J5RGF0YVxuICAgIH1cbiAgICBkZWZhdWx0RGVzY3JpcHRpb25LZXlcbiAgfVxufVxuZnJhZ21lbnQgRmVlRGV0YWlsc0RhdGEgb24gRmVlRGV0YWlscyB7XG4gIF9fdHlwZW5hbWVcbiAgLi4uIG9uIEdlbmVyYWxGZWUge1xuICAgIGZlZURlc2NyaXB0aW9uS2V5XG4gIH1cbn1cbmZyYWdtZW50IExvYW5EZXRhaWxzRGF0YSBvbiBMb2FuRGV0YWlscyB7XG4gIF9fdHlwZW5hbWVcbiAgLi4uIG9uIEZ1bGxQcmVQYXltZW50IHtcbiAgICBsb2FuRGVzY3JpcHRpb25LZXlcbiAgfVxuICAuLi4gb24gSW5pdGlhdGUge1xuICAgIGxvYW5EZXNjcmlwdGlvbktleVxuICB9XG4gIC4uLiBvbiBNb250aGx5UGF5bWVudCB7XG4gICAgbG9hbkRlc2NyaXB0aW9uS2V5XG4gICAgbG9hblBheW1lbnROdW1iZXJcbiAgICBsb2FuVG90YWxQYXltZW50c0NvdW50XG4gIH1cbiAgLi4uIG9uIFBhcnRpYWxQcmVQYXltZW50IHtcbiAgICBsb2FuRGVzY3JpcHRpb25LZXlcbiAgfVxufVxuZnJhZ21lbnQgTWFuZGF0ZURldGFpbHNEYXRhIG9uIE1hbmRhdGVEZXRhaWxzIHtcbiAgX190eXBlbmFtZVxuICAuLi4gb24gTWFuZGF0ZVBheW1lbnQge1xuICAgIG1hbmRhdGVEZXNjcmlwdGlvbktleVxuICB9XG4gIC4uLiBvbiBNYW5kYXRlUmV0dXJuUGF5bWVudCB7XG4gICAgbWFuZGF0ZURlc2NyaXB0aW9uS2V5XG4gIH1cbn1cbmZyYWdtZW50IFNhdmluZ3NEZXRhaWxzRGF0YSBvbiBTYXZpbmdzRGV0YWlscyB7XG4gIF9fdHlwZW5hbWVcbiAgLi4uIG9uIEZ1bGxTYXZpbmdzV2l0aGRyYXdhbCB7XG4gICAgc2F2aW5nc0Rlc2NyaXB0aW9uS2V5XG4gIH1cbiAgLi4uIG9uIE1vbnRobHlTYXZpbmdzRGVwb3NpdCB7XG4gICAgc2F2aW5nc0RlcG9zaXROdW1iZXJcbiAgICBzYXZpbmdzRGVzY3JpcHRpb25LZXlcbiAgICBzYXZpbmdzVG90YWxEZXBvc2l0Q291bnRcbiAgfVxuICAuLi4gb24gUGFydGlhbFNhdmluZ3NXaXRoZHJhd2FsIHtcbiAgICBzYXZpbmdzRGVzY3JpcHRpb25LZXlcbiAgfVxuICAuLi4gb24gU2F2aW5nc0Nsb3Npbmcge1xuICAgIHNhdmluZ3NEZXNjcmlwdGlvbktleVxuICB9XG4gIC4uLiBvbiBTYXZpbmdzRGVwb3NpdCB7XG4gICAgc2F2aW5nc0Rlc2NyaXB0aW9uS2V5XG4gIH1cbiAgLi4uIG9uIFNhdmluZ3NJbnRlcmVzdCB7XG4gICAgc2F2aW5nc0Rlc2NyaXB0aW9uS2V5XG4gIH1cbiAgLi4uIG9uIFNhdmluZ3NQZW5hbHR5IHtcbiAgICBzYXZpbmdzRGVzY3JpcHRpb25LZXlcbiAgfVxuICAuLi4gb24gU2F2aW5nc1RheCB7XG4gICAgc2F2aW5nc0Rlc2NyaXB0aW9uS2V5XG4gIH1cbn1cbmZyYWdtZW50IFN1YnNjcmlwdGlvbkRldGFpbHNEYXRhIG9uIFN1YnNjcmlwdGlvbkRldGFpbHMge1xuICBfX3R5cGVuYW1lXG4gIC4uLiBvbiBTdWJzY3JpcHRpb25QYXltZW50IHtcbiAgICBzdWJzY3JpcHRpb25EZXNjcmlwdGlvbktleVxuICB9XG4gIC4uLiBvbiBTdWJzY3JpcHRpb25SZXR1cm5QYXltZW50IHtcbiAgICBzdWJzY3JpcHRpb25EZXNjcmlwdGlvbktleVxuICB9XG59XG5mcmFnbWVudCBUcmFuc2FjdGlvbnNEZXRhaWxzRGF0YSBvbiBUcmFuc2FjdGlvbkRldGFpbHMge1xuICBfX3R5cGVuYW1lXG4gIC4uLiBvbiBCYW5rVHJhbnNmZXIge1xuICAgIGJhbmtfdHJhbnNmZXJfZGV0YWlscyB7XG4gICAgICBfX3R5cGVuYW1lXG4gICAgICAuLi5CYW5rVHJhbnNmZXJEZXRhaWxzRGF0YVxuICAgIH1cbiAgICBib29rX2RhdGVcbiAgICBjYXRlZ29yaWVzIHtcbiAgICAgIF9fdHlwZW5hbWVcbiAgICAgIC4uLkNhdGVnb3J5RGF0YVxuICAgIH1cbiAgICByZWN1cnJlbmNlcyB7XG4gICAgICBfX3R5cGVuYW1lXG4gICAgICAuLi5SZWN1cnJlbmNlRGF0YVxuICAgIH1cbiAgICB2YWx1ZV9kYXRlXG4gIH1cbiAgLi4uIG9uIENhcmQge1xuICAgIGNhcmRfZGV0YWlscyB7XG4gICAgICBfX3R5cGVuYW1lXG4gICAgICAuLi5DYXJkRGV0YWlsc0RhdGFcbiAgICB9XG4gICAgY2F0ZWdvcmllcyB7XG4gICAgICBfX3R5cGVuYW1lXG4gICAgICAuLi5DYXRlZ29yeURhdGFcbiAgICB9XG4gICAgcmVjdXJyZW5jZXMge1xuICAgICAgX190eXBlbmFtZVxuICAgICAgLi4uUmVjdXJyZW5jZURhdGFcbiAgICB9XG4gICAgdmFsdWVfZGF0ZVxuICB9XG4gIC4uLiBvbiBDYXNoIHtcbiAgICBjYXNoX2RldGFpbHMge1xuICAgICAgX190eXBlbmFtZVxuICAgICAgLi4uQ2FzaERldGFpbHNEYXRhXG4gICAgfVxuICAgIGNhdGVnb3JpZXMge1xuICAgICAgX190eXBlbmFtZVxuICAgICAgLi4uQ2F0ZWdvcnlEYXRhXG4gICAgfVxuICAgIHJlY3VycmVuY2VzIHtcbiAgICAgIF9fdHlwZW5hbWVcbiAgICAgIC4uLlJlY3VycmVuY2VEYXRhXG4gICAgfVxuICAgIHZhbHVlX2RhdGVcbiAgfVxuICAuLi4gb24gQ2hlcXVlcyB7XG4gICAgY2F0ZWdvcmllcyB7XG4gICAgICBfX3R5cGVuYW1lXG4gICAgICAuLi5DYXRlZ29yeURhdGFcbiAgICB9XG4gICAgY2hlcXVlc0RldGFpbHMge1xuICAgICAgX190eXBlbmFtZVxuICAgICAgLi4uQ2hlcXVlc0RldGFpbHNEYXRhXG4gICAgfVxuICAgIHJlY3VycmVuY2VzIHtcbiAgICAgIF9fdHlwZW5hbWVcbiAgICAgIC4uLlJlY3VycmVuY2VEYXRhXG4gICAgfVxuICAgIHZhbHVlRGF0ZVxuICAgIHJlZmVyZW5jZU51bWJlclxuICAgIGZyb250SW1hZ2VVcmxcbiAgICBiYWNrSW1hZ2VVcmxcbiAgfVxuICAuLi4gb24gRGVmYXVsdCB7XG4gICAgZGVmYXVsdF9kZXRhaWxzIHtcbiAgICAgIF9fdHlwZW5hbWVcbiAgICAgIC4uLkRlZmF1bHREZXRhaWxzRGF0YVxuICAgIH1cbiAgICByZWN1cnJlbmNlcyB7XG4gICAgICBfX3R5cGVuYW1lXG4gICAgICAuLi5SZWN1cnJlbmNlRGF0YVxuICAgIH1cbiAgICB2YWx1ZV9kYXRlXG4gIH1cbiAgLi4uIG9uIEZlZSB7XG4gICAgY2F0ZWdvcmllcyB7XG4gICAgICBfX3R5cGVuYW1lXG4gICAgICAuLi5DYXRlZ29yeURhdGFcbiAgICB9XG4gICAgZmVlX2RldGFpbHMge1xuICAgICAgX190eXBlbmFtZVxuICAgICAgLi4uRmVlRGV0YWlsc0RhdGFcbiAgICB9XG4gICAgdmFsdWVfZGF0ZVxuICB9XG4gIC4uLiBvbiBMb2FucyB7XG4gICAgY2F0ZWdvcmllcyB7XG4gICAgICBfX3R5cGVuYW1lXG4gICAgICAuLi5DYXRlZ29yeURhdGFcbiAgICB9XG4gICAgbG9hbl9kZXRhaWxzIHtcbiAgICAgIF9fdHlwZW5hbWVcbiAgICAgIC4uLkxvYW5EZXRhaWxzRGF0YVxuICAgIH1cbiAgICByZWN1cnJlbmNlcyB7XG4gICAgICBfX3R5cGVuYW1lXG4gICAgICAuLi5SZWN1cnJlbmNlRGF0YVxuICAgIH1cbiAgICB2YWx1ZV9kYXRlXG4gIH1cbiAgLi4uIG9uIE1hbmRhdGUge1xuICAgIGNhdGVnb3JpZXMge1xuICAgICAgX190eXBlbmFtZVxuICAgICAgLi4uQ2F0ZWdvcnlEYXRhXG4gICAgfVxuICAgIG1hbmRhdGVfZGV0YWlscyB7XG4gICAgICBfX3R5cGVuYW1lXG4gICAgICAuLi5NYW5kYXRlRGV0YWlsc0RhdGFcbiAgICB9XG4gICAgcmVjdXJyZW5jZXMge1xuICAgICAgX190eXBlbmFtZVxuICAgICAgLi4uUmVjdXJyZW5jZURhdGFcbiAgICB9XG4gICAgdmFsdWVfZGF0ZVxuICB9XG4gIC4uLiBvbiBTYXZpbmdzIHtcbiAgICBjYXRlZ29yaWVzIHtcbiAgICAgIF9fdHlwZW5hbWVcbiAgICAgIC4uLkNhdGVnb3J5RGF0YVxuICAgIH1cbiAgICByZWN1cnJlbmNlcyB7XG4gICAgICBfX3R5cGVuYW1lXG4gICAgICAuLi5SZWN1cnJlbmNlRGF0YVxuICAgIH1cbiAgICBzYXZpbmdzX2RldGFpbHMge1xuICAgICAgX190eXBlbmFtZVxuICAgICAgLi4uU2F2aW5nc0RldGFpbHNEYXRhXG4gICAgfVxuICAgIHZhbHVlX2RhdGVcbiAgfVxuICAuLi4gb24gU3Vic2NyaXB0aW9uVHJhbnNhY3Rpb24ge1xuICAgIGNhdGVnb3JpZXMge1xuICAgICAgX190eXBlbmFtZVxuICAgICAgLi4uQ2F0ZWdvcnlEYXRhXG4gICAgfVxuICAgIHJlY3VycmVuY2VzIHtcbiAgICAgIF9fdHlwZW5hbWVcbiAgICAgIC4uLlJlY3VycmVuY2VEYXRhXG4gICAgfVxuICAgIHN1YnNjcmlwdGlvbl9kZXRhaWxzIHtcbiAgICAgIF9fdHlwZW5hbWVcbiAgICAgIC4uLlN1YnNjcmlwdGlvbkRldGFpbHNEYXRhXG4gICAgfVxuICAgIHZhbHVlX2RhdGVcbiAgfVxufVxuZnJhZ21lbnQgVHJhbnNhY3Rpb25GcmFnbWVudCBvbiBUcmFuc2FjdGlvbiB7XG4gIF9fdHlwZW5hbWVcbiAgYmFzZVRyYW5zYWN0aW9uIHtcbiAgICBfX3R5cGVuYW1lXG4gICAgLi4uQmFzZVRyYW5zYWN0aW9uRnJhZ21lbnRcbiAgfVxuICBlbnJpY2htZW50IHtcbiAgICBfX3R5cGVuYW1lXG4gICAgLi4uVHJhbnNhY3Rpb25FbnJpY2htZW50RnJhZ21lbnRcbiAgfVxuICBtZXRhZGF0YSB7XG4gICAgX190eXBlbmFtZVxuICAgIC4uLlRyYW5zYWN0aW9uRXZlbnRNZXRhZGF0YUZyYWdtZW50XG4gIH1cbiAgcmVmZXJlbmNlTnVtYmVyXG4gIHRyYW5zYWN0aW9uRGV0YWlscyB7XG4gICAgX190eXBlbmFtZVxuICAgIC4uLlRyYW5zYWN0aW9uc0RldGFpbHNEYXRhXG4gIH1cbn1cbmZyYWdtZW50IE1vdmVtZW50RnJhZ21lbnQgb24gTW92ZW1lbnQge1xuICBfX3R5cGVuYW1lXG4gIGFjY291bnRJZFxuICBiYW5rQ3VycmVuY3lBbW91bnRcbiAgYm9va2luZ0RhdGVcbiAgY29udmVyc2lvblJhdGVcbiAgY3JlZGl0RGViaXRcbiAgZGVzY3JpcHRpb25cbiAgaXNSZXZlcnNlZFxuICBsaW5rVHJhbnNhY3Rpb24ge1xuICAgIF9fdHlwZW5hbWVcbiAgICAuLi5UcmFuc2FjdGlvbkZyYWdtZW50XG4gIH1cbiAgbW92ZW1lbnRBbW91bnRcbiAgbW92ZW1lbnRDdXJyZW5jeVxuICBtb3ZlbWVudElkXG4gIG1vdmVtZW50UmV2ZXJzZWRJZFxuICBtb3ZlbWVudFRpbWVzdGFtcFxuICBtb3ZlbWVudFR5cGVcbiAgcG9ydGZvbGlvSWRcbiAgcnVubmluZ0JhbGFuY2VcbiAgdHJhbnNhY3Rpb24ge1xuICAgIF9fdHlwZW5hbWVcbiAgICAuLi5UcmFuc2FjdGlvbkZyYWdtZW50XG4gIH1cbiAgdmFsdWVEYXRlXG59XG5mcmFnbWVudCBQYWdpbmF0aW9uRnJhZ21lbnQgb24gUGFnaW5hdGlvbiB7XG4gIF9fdHlwZW5hbWVcbiAgY3Vyc29yXG4gIGhhc01vcmVcbn1cbmZyYWdtZW50IE1vdmVtZW50c0ZyYWdtZW50IG9uIE1vdmVtZW50cyB7XG4gIF9fdHlwZW5hbWVcbiAgaXNSdW5uaW5nQmFsYW5jZUluU3luY1xuICBtb3ZlbWVudHMge1xuICAgIF9fdHlwZW5hbWVcbiAgICAuLi5Nb3ZlbWVudEZyYWdtZW50XG4gIH1cbiAgcGFnaW5hdGlvbiB7XG4gICAgX190eXBlbmFtZVxuICAgIC4uLlBhZ2luYXRpb25GcmFnbWVudFxuICB9XG59YDtcbiJdLCJtYXBwaW5ncyI6Ijs7Ozs7O0FBQU8sTUFBTUEsWUFBWSxHQUFBQyxPQUFBLENBQUFELFlBQUEsR0FBRztBQUM1QjtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLENBQUM7QUFFTSxNQUFNRSxhQUFhLEdBQUFELE9BQUEsQ0FBQUMsYUFBQSxHQUFHO0FBQzdCO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxFQUFFIiwiaWdub3JlTGlzdCI6W119