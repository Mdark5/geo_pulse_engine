# Market Ingestion Engine

Real-time ingestion service that streams Bitget USDT-M perpetual futures market
data — trades, order book snapshots, open interest, and funding rates — into the
`public.projects` / `public.trades` / `public.orderbook_snapshots` /
`public.open_interest` / `public.funding_rates` schema defined in
`supabase/migrations/20260706230000_initial_market_intelligence_schema.sql`.

This is a standalone Node/TypeScript service, independent of the Next.js app in
this repo — it's a long-running process, not a web request handler.

## Architecture

```
Bitget public WS  --->  BitgetWsClient           (reconnect, ping/pong, backoff)
                            |
                            v
                     zod schema validation         (bitget/schemas.ts)
                            |
                            v
                       routeMessage                (pipeline/handlers.ts)
                       /    |     \
                  trade  orderbook  ticker
                     |       |         |
                     v       v         v
                          BatchWriter                (pipeline/batchWriter.ts)
                    (buffered, timer/size flush)
                            |
                            v
                        Supabase (Postgres)
```

- **Config** (`src/config.ts`): all runtime configuration is loaded from `process.env`
  and validated with zod at startup. Invalid/missing config fails fast with a
  readable error instead of surfacing as a runtime crash later.
- **Transport** (`src/bitget/client.ts`): a single WebSocket connection subscribes
  to `trade`, an order-book snapshot channel (`books15` by default — a
  snapshot-style depth channel, not the incremental full-book feed, which keeps
  reconstruction logic unnecessary), and `ticker` for every configured symbol.
  Handles Bitget's ping/pong keepalive, detects stale connections, and reconnects
  with exponential backoff + jitter, resubscribing on every reconnect.
- **Validation** (`src/bitget/schemas.ts`): every inbound payload is parsed
  through a zod schema before it can reach the database. Malformed messages are
  logged and dropped — they never crash the process or corrupt a batch.
- **Pipeline** (`src/pipeline/`): `ProjectRegistry` resolves/creates the
  `projects` row per symbol once at startup and caches the id in memory so the
  hot path never does a lookup per message. `KeyedThrottle` caps how often
  high-frequency feeds (order book, ticker) are persisted. `BatchWriter` buffers
  rows and flushes on a timer or size threshold, so ingestion never does a
  round trip per message.
- **Logging** (`src/logger.ts`): structured JSON logs via pino (async, low
  overhead); pretty-printed in development only.

## Setup

```bash
cd market-ingestion
npm install
cp .env.example .env
# fill in SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY and adjust BITGET_SYMBOLS
npm run dev      # ts-node style dev run with auto-restart
# or, for production:
npm run build && npm start
```

The Supabase migration in `../supabase/migrations/` must already be applied to
the target project — this service only writes to those tables, it doesn't
manage schema.

## Known assumption to verify before production use

The `ticker` channel's exact field names for funding rate (`fundingRate`,
`nextFundingTime`) and open interest (`openInterest` / `holdingAmount`) are
based on the documented Bitget v2 public API shape at the time this was
written, but exchange APIs evolve. `bitget/schemas.ts` uses a passthrough
schema and tries multiple candidate field names for open interest — if Bitget
renames or restructures these fields, update `tickerItemSchema` and
`handleTicker` in `pipeline/handlers.ts` accordingly. Malformed/unrecognized
ticker payloads are logged and skipped rather than silently miscast, so this
will show up as WARN logs rather than bad data in the database.

## Operational notes

- **Trades** are deduplicated via the `(project_id, exchange_trade_id,
  traded_at)` unique index using `upsert(..., ignoreDuplicates: true)`, so a
  reconnect that re-delivers a recent trade won't double-count it.
- **Order book / open interest / funding rate** rows are plain inserts —
  the schema's primary keys include the identity `id` column, so there's no
  natural per-row dedup key; throttling controls write volume instead.
- Batches are dropped (not retried) on write failure to avoid building
  backpressure into the WebSocket read loop; failures are logged with the
  table name and batch size for visibility.
