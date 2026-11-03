export const USER_DATA_V2 = `
query UserDataV2 {
  userDataV2 {
    getUserDataV2 {
      customerAndAccounts {
        customerId
        accounts {
          accountId
          accountNumber
          accountCategory
        }
      }
    }
  }
}
`;

export const FETCH_ACCOUNT_BALANCE = `
query fetchAccountBalance($accountId: String!) {
  accounts {
    balance(accountId: $accountId) {
      currentBalance
    }
  }
}
`;

export const TRANSACTIONS = `
query Transactions(
  $accountId: String!
  $from: String
  $to: String
  $pageNumber: Int
  $pageCount: Int
) {
  accounts {
    oshTransactionsNew(
      accountId: $accountId
      from: $from
      to: $to
      pageNumber: $pageNumber
      pageCount: $pageCount
    ) {
      totalCount
      transactions {
        transactionId
        transactionAmount
        bookingDate
        effectiveDate
        currency
        description
        title
        subTitle
        referenceNumber
        liquidityStatus
      }
      pendingTransactions {
        transactionId
        transactionAmount
        bookingDate
        effectiveDate
        currency
        description
        title
        subTitle
        referenceNumber
        liquidityStatus
      }
    }
  }
}
`;
