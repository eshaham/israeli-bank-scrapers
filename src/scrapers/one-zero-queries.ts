export const GET_CUSTOMER = `
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

export const GET_MOVEMENTS = `query GetMovements(
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
