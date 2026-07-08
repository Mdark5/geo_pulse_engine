import { childLogger } from "../logger";
import { tradeItemSchema, orderbookItemSchema, tickerItemSchema, WsEnvelope } from "../bitget/schemas";
import { BatchWriter } from "./batchWriter";
import { ProjectRegistry } from "./projectRegistry";
import { KeyedThrottle } from "./throttle";
import { TradeRow, OrderbookSnapshotRow, OpenInterestRow, FundingRateRow } from "../types";

const log = childLogger({ component: "handlers" });

function toIso(ts: string | number): string {
  const n = typeof ts === "string" ? Number(ts) : ts;
  return new Date(n).toISOString();
}

export interface HandlerDeps {
  projectRegistry: ProjectRegistry;
  tradeWriter: BatchWriter<TradeRow>;
  orderbookWriter: BatchWriter<OrderbookSnapshotRow>;
  openInterestWriter: BatchWriter<OpenInterestRow>;
  fundingRateWriter: BatchWriter<FundingRateRow>;
  orderbookThrottle: KeyedThrottle;
  openInterestThrottle: KeyedThrottle;
  fundingRateThrottle: KeyedThrottle;
  orderbookDepthLevels: number;
}

export function routeMessage(envelope: WsEnvelope, deps: HandlerDeps): void {
  const { channel, instId } = envelope.arg;
  const projectId = deps.projectRegistry.getProjectId(instId);
  if (!projectId) {
    log.debug({ instId, channel }, "ignoring message for unregistered symbol");
    return;
  }

  if (channel === "trade") {
    handleTrade(envelope.data, projectId, deps);
  } else if (channel.startsWith("books")) {
    handleOrderbook(envelope.data, instId, projectId, deps);
  } else if (channel === "ticker") {
    handleTicker(envelope.data, instId, projectId, deps);
  } else {
    log.debug({ channel }, "unhandled channel");
  }
}

function handleTrade(data: unknown[], projectId: string, deps: HandlerDeps): void {
  for (const raw of data) {
    const parsed = tradeItemSchema.safeParse(raw);
    if (!parsed.success) {
      log.warn({ issues: parsed.error.issues }, "dropped invalid trade item");
      continue;
    }
    const item = parsed.data;
    const row: TradeRow = {
      project_id: projectId,
      exchange_trade_id: String(item.tradeId),
      price: String(item.price),
      size: String(item.size),
      side: item.side,
      traded_at: toIso(item.ts),
    };
    deps.tradeWriter.enqueue(row);
  }
}

function handleOrderbook(data: unknown[], instId: string, projectId: string, deps: HandlerDeps): void {
  if (!deps.orderbookThrottle.shouldRun(instId)) return;

  for (const raw of data) {
    const parsed = orderbookItemSchema.safeParse(raw);
    if (!parsed.success) {
      log.warn({ issues: parsed.error.issues }, "dropped invalid orderbook snapshot");
      continue;
    }
    const item = parsed.data;
    const bestBid = item.bids[0]?.[0] ?? null;
    const bestAsk = item.asks[0]?.[0] ?? null;
    const spread = bestBid !== null && bestAsk !== null ? String(Number(bestAsk) - Number(bestBid)) : null;

    const row: OrderbookSnapshotRow = {
      project_id: projectId,
      snapshot_at: toIso(item.ts),
      best_bid: bestBid,
      best_ask: bestAsk,
      spread,
      depth_levels: deps.orderbookDepthLevels,
      bids: item.bids.slice(0, deps.orderbookDepthLevels),
      asks: item.asks.slice(0, deps.orderbookDepthLevels),
    };
    deps.orderbookWriter.enqueue(row);
  }
}

function handleTicker(data: unknown[], instId: string, projectId: string, deps: HandlerDeps): void {
  for (const raw of data) {
    const parsed = tickerItemSchema.safeParse(raw);
    if (!parsed.success) {
      log.warn({ issues: parsed.error.issues }, "dropped invalid ticker item");
      continue;
    }
    const item = parsed.data;
    const now = Date.now();

    if (item.fundingRate !== undefined && deps.fundingRateThrottle.shouldRun(instId, now)) {
      const fundingTime =
        item.nextFundingTime !== undefined ? toIso(item.nextFundingTime) : new Date(now).toISOString();
      const row: FundingRateRow = {
        project_id: projectId,
        funding_time: fundingTime,
        funding_rate: String(item.fundingRate),
        predicted_rate: null,
      };
      deps.fundingRateWriter.enqueue(row);
    }

    const openInterest = item.openInterest ?? item.holdingAmount;
    if (openInterest !== undefined && deps.openInterestThrottle.shouldRun(instId, now)) {
      const row: OpenInterestRow = {
        project_id: projectId,
        recorded_at: new Date(now).toISOString(),
        open_interest: String(openInterest),
        open_interest_value:
          item.holdingAmountValue !== undefined ? String(item.holdingAmountValue) : null,
      };
      deps.openInterestWriter.enqueue(row);
    }
  }
}
