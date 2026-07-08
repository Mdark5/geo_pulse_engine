import { loadConfig } from "./config";
import { childLogger } from "./logger";
import { createSupabaseClient } from "./supabase";
import { BitgetWsClient, SubscriptionArg } from "./bitget/client";
import { BatchWriter } from "./pipeline/batchWriter";
import { ProjectRegistry } from "./pipeline/projectRegistry";
import { KeyedThrottle } from "./pipeline/throttle";
import { routeMessage, HandlerDeps } from "./pipeline/handlers";
import { TradeRow, OrderbookSnapshotRow, OpenInterestRow, FundingRateRow } from "./types";

const log = childLogger({ component: "main" });

async function main(): Promise<void> {
  const config = loadConfig();
  const supabase = createSupabaseClient(config);

  const projectRegistry = new ProjectRegistry(supabase);
  await projectRegistry.ensureProjects(config.BITGET_SYMBOLS);

  const tradeWriter = new BatchWriter<TradeRow>(supabase, {
    table: "trades",
    flushIntervalMs: config.BATCH_FLUSH_INTERVAL_MS,
    maxBatchSize: config.BATCH_MAX_SIZE,
    mode: "upsert",
    onConflict: "project_id,exchange_trade_id,traded_at",
  });
  const orderbookWriter = new BatchWriter<OrderbookSnapshotRow>(supabase, {
    table: "orderbook_snapshots",
    flushIntervalMs: config.BATCH_FLUSH_INTERVAL_MS,
    maxBatchSize: config.BATCH_MAX_SIZE,
    mode: "insert",
  });
  const openInterestWriter = new BatchWriter<OpenInterestRow>(supabase, {
    table: "open_interest",
    flushIntervalMs: config.BATCH_FLUSH_INTERVAL_MS,
    maxBatchSize: config.BATCH_MAX_SIZE,
    mode: "insert",
  });
  const fundingRateWriter = new BatchWriter<FundingRateRow>(supabase, {
    table: "funding_rates",
    flushIntervalMs: config.BATCH_FLUSH_INTERVAL_MS,
    maxBatchSize: config.BATCH_MAX_SIZE,
    mode: "insert",
  });

  const writers = [tradeWriter, orderbookWriter, openInterestWriter, fundingRateWriter];
  for (const writer of writers) writer.start();

  const subscriptions: SubscriptionArg[] = config.BITGET_SYMBOLS.flatMap((symbol) => [
    { instType: config.BITGET_INST_TYPE, channel: "trade", instId: symbol },
    { instType: config.BITGET_INST_TYPE, channel: config.BITGET_ORDERBOOK_CHANNEL, instId: symbol },
    { instType: config.BITGET_INST_TYPE, channel: "ticker", instId: symbol },
  ]);

  const deps: HandlerDeps = {
    projectRegistry,
    tradeWriter,
    orderbookWriter,
    openInterestWriter,
    fundingRateWriter,
    orderbookThrottle: new KeyedThrottle(config.ORDERBOOK_SNAPSHOT_MIN_INTERVAL_MS),
    openInterestThrottle: new KeyedThrottle(config.OPEN_INTEREST_MIN_INTERVAL_MS),
    fundingRateThrottle: new KeyedThrottle(config.FUNDING_RATE_MIN_INTERVAL_MS),
    orderbookDepthLevels: config.ORDERBOOK_DEPTH_LEVELS,
  };

  const client = new BitgetWsClient(config, subscriptions);
  client.on("message", (envelope) => {
    try {
      routeMessage(envelope, deps);
    } catch (err) {
      log.error({ err }, "unhandled error while routing message");
    }
  });
  client.start();

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, "shutting down ingestion engine");

    // Supabase calls are timeout-bounded (see supabase.ts), but this is a
    // hard backstop: shutdown must never hang indefinitely regardless of
    // what a flush is waiting on.
    const forceExit = setTimeout(() => {
      log.warn("graceful shutdown exceeded timeout, forcing exit");
      process.exit(1);
    }, config.SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();

    client.stop();
    for (const writer of writers) {
      writer.stop();
      await writer.flushAndWait();
    }
    clearTimeout(forceExit);
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("uncaughtException", (err) => {
    log.fatal({ err }, "uncaught exception");
  });
  process.on("unhandledRejection", (reason) => {
    log.error({ reason }, "unhandled rejection");
  });

  log.info({ symbols: config.BITGET_SYMBOLS }, "market ingestion engine started");
}

main().catch((err) => {
  // Logger may not be usable if config loading itself failed; fall back to console.
  console.error("Fatal startup error:", err);
  process.exit(1);
});
