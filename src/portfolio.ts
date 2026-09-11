export enum AssetType {
  Stock = 'stock',
  Bond = 'bond',
  Etf = 'etf',
  Fund = 'fund',
  Option = 'option',
  Future = 'future',
  Cash = 'cash',
  Other = 'other',
}

export interface Position {
  name: string; // security name        <- Meta.Security.HebName/EngName
  symbol?: string; // ticker               <- Meta.Security.Symbol (often null for IL)
  securityId: string; // Excellence EquityNumber/Key (their internal id, NOT ISIN)
  isin?: string; // ISIN if resolvable (not directly in balances response)
  assetType?: AssetType; // <- Meta.Security.ItemType/StockType/IsEtf/IsForeign

  exchange?: string;

  quantity: number;
  currency: string; // per-instrument currency (accounts are multi-currency)
  marketPrice?: number; // current price per unit, in `currency`
  marketValue: number; // quantity * price, in `currency`

  averageCost?: number; // avg purchase price per unit
  costBasis?: number;
  unrealizedPnl?: number;
  unrealizedPnlPct?: number;

  asOf?: string; // ISO timestamp of the snapshot
  rawPosition?: unknown; // mirrors the `rawTransaction` convention
}

export interface PortfolioAccount {
  accountNumber: string;
  baseCurrency?: string; // currency the account total is expressed in (e.g. ILS)
  totalValue?: number; // total portfolio value as REPORTED by the platform
  cash?: number; // uninvested cash balance
  positions: Position[];
}
