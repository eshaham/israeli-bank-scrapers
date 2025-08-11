# Investment Portfolio Support 📈

The Israeli Bank Scrapers library now supports scraping investment portfolio data in addition to traditional banking transactions. This feature allows you to retrieve comprehensive investment information including holdings, transactions, and portfolio performance data.

## Supported Banks

Currently, investment portfolio scraping is supported for:
- ✅ **Leumi Bank** - Complete portfolio and transaction history support

## Portfolio Data Structure

### Portfolio
Each portfolio contains the following information:
```typescript
interface Portfolio {
  portfolioId: string;      // Unique identifier for the portfolio
  portfolioName: string;    // Human-readable portfolio name
  investments: Investment[]; // Current holdings
  transactions: InvestmentTransaction[]; // Historical transactions
}
```

### Investment Holdings
Individual investment holdings include:
```typescript
interface Investment {
  paperId: string;    // Unique security identifier
  paperName: string;  // Security name (e.g., "Apple Inc.")
  symbol: string;     // Trading symbol (e.g., "AAPL")
  amount: number;     // Number of shares/units held
  value: number;      // Current market value
  currency: string;   // Currency denomination
}
```

### Investment Transactions
Historical investment transactions provide:
```typescript
interface InvestmentTransaction {
  paperId: string;        // Links to specific security
  paperName: string;      // Security name
  symbol: string;         // Trading symbol
  amount: number;         // Number of shares traded
  value: number;          // Total transaction value
  currency: string;       // Transaction currency
  taxSum: number;         // Tax amount paid
  executionDate: Date;    // When the transaction was executed
  executablePrice: number; // Price per share/unit
}
```

## Usage

### Basic Portfolio Scraping
```typescript
import { CompanyTypes, createScraper } from 'israeli-bank-scrapers';

const options = {
  companyId: CompanyTypes.leumi,
  startDate: new Date('2023-01-01'), // Historical data from this date
  showBrowser: false
};

const credentials = {
  username: 'your-username',
  password: 'your-password'
};

const scraper = createScraper(options);
const scrapeResult = await scraper.scrape(credentials);

if (scrapeResult.success) {
  // Access traditional banking data
  scrapeResult.accounts?.forEach((account) => {
    console.log(`Account ${account.accountNumber}: ${account.txns.length} transactions`);
  });

  // Access investment portfolios
  scrapeResult.portfolios?.forEach((portfolio) => {
    console.log(`Portfolio: ${portfolio.portfolioName}`);
    console.log(`Holdings: ${portfolio.investments.length} securities`);
    console.log(`Transactions: ${portfolio.transactions.length} trades`);
    
    // Display current holdings
    portfolio.investments.forEach((investment) => {
      console.log(`- ${investment.paperName} (${investment.symbol}): ${investment.amount} shares @ ${investment.value} ${investment.currency}`);
    });
    
    // Display recent transactions
    const recentTransactions = portfolio.transactions
      .sort((a, b) => b.executionDate.getTime() - a.executionDate.getTime())
      .slice(0, 5);
      
    recentTransactions.forEach((transaction) => {
      console.log(`${transaction.executionDate.toDateString()}: ${transaction.paperName} - ${transaction.amount} shares @ ${transaction.executablePrice}`);
    });
  });
}
```

### Portfolio Analysis Example
```typescript
// Calculate total portfolio value
const totalValue = scrapeResult.portfolios?.reduce((total, portfolio) => {
  const portfolioValue = portfolio.investments.reduce((sum, investment) => sum + investment.value, 0);
  return total + portfolioValue;
}, 0);

console.log(`Total portfolio value: ${totalValue} ILS`);

// Find your largest holdings
scrapeResult.portfolios?.forEach((portfolio) => {
  const largestHolding = portfolio.investments
    .sort((a, b) => b.value - a.value)[0];
    
  if (largestHolding) {
    console.log(`Largest holding in ${portfolio.portfolioName}: ${largestHolding.paperName} (${largestHolding.value} ${largestHolding.currency})`);
  }
});
```

## Result Structure

When portfolios are available, the scraper result includes an optional `portfolios` array:

```typescript
interface ScraperScrapingResult {
  success: boolean;
  accounts?: TransactionsAccount[];        // Traditional banking accounts
  portfolios?: Portfolio[];                // Investment portfolios (NEW)
  futureDebits?: FutureDebit[];
  errorType?: ScraperErrorTypes;
  errorMessage?: string;
}
```

## Features

### ✅ Current Capabilities
- **Complete Portfolio Data**: Holdings and historical transactions
- **Multi-Security Support**: Stocks, bonds, and other investment vehicles
- **Historical Transactions**: Configurable date range for transaction history
- **Tax Information**: Detailed tax data for each transaction
- **Currency Support**: Foundation for multi-currency investments
- **Type Safety**: Full TypeScript support with comprehensive interfaces
