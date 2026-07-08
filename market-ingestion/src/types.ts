// Row shapes mirror supabase/migrations/20260706230000_initial_market_intelligence_schema.sql.
// Numeric columns are sent as strings to preserve exact decimal precision through
// JSON serialization (JS numbers would lose precision on large/high-scale values).

export interface TradeRow {
  project_id: string;
  exchange_trade_id: string;
  price: string;
  size: string;
  side: "buy" | "sell";
  traded_at: string;
}

export interface OrderbookSnapshotRow {
  project_id: string;
  snapshot_at: string;
  best_bid: string | null;
  best_ask: string | null;
  spread: string | null;
  depth_levels: number;
  bids: [string, string][];
  asks: [string, string][];
}

export interface OpenInterestRow {
  project_id: string;
  recorded_at: string;
  open_interest: string;
  open_interest_value: string | null;
}

export interface FundingRateRow {
  project_id: string;
  funding_time: string;
  funding_rate: string;
  predicted_rate: string | null;
}
