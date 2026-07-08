import WebSocket from "ws";
import { EventEmitter } from "events";
import { AppConfig } from "../config";
import { childLogger } from "../logger";
import { wsEnvelopeSchema } from "./schemas";

const log = childLogger({ component: "bitget-ws" });

export interface SubscriptionArg {
  instType: string;
  channel: string;
  instId: string;
}

/**
 * Resilient WebSocket client for Bitget's public v2 market-data feed.
 * Handles subscription (re-)establishment, ping/pong keepalive, stale-connection
 * detection, and exponential backoff reconnects so the ingestion pipeline never
 * has to think about transport-level failure modes.
 */
export class BitgetWsClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private pingTimer: NodeJS.Timeout | null = null;
  private staleCheckTimer: NodeJS.Timeout | null = null;
  private lastMessageAt = Date.now();
  private closedByClient = false;

  constructor(private readonly config: AppConfig, private readonly subscriptions: SubscriptionArg[]) {
    super();
  }

  start(): void {
    this.closedByClient = false;
    this.connect();
  }

  stop(): void {
    this.closedByClient = true;
    this.clearTimers();
    this.ws?.close();
  }

  private connect(): void {
    log.info({ url: this.config.BITGET_WS_URL }, "connecting to Bitget WS");
    const ws = new WebSocket(this.config.BITGET_WS_URL);
    this.ws = ws;

    ws.on("open", () => {
      log.info("Bitget WS connected");
      this.reconnectAttempts = 0;
      this.lastMessageAt = Date.now();
      this.subscribe();
      this.startPing();
      this.startStaleCheck();
      this.emit("open");
    });

    ws.on("message", (raw) => {
      this.lastMessageAt = Date.now();
      this.handleRawMessage(raw.toString());
    });

    ws.on("pong", () => {
      this.lastMessageAt = Date.now();
    });

    ws.on("close", (code, reason) => {
      log.warn({ code, reason: reason.toString() }, "Bitget WS closed");
      this.clearTimers();
      this.emit("close", code);
      if (!this.closedByClient) this.scheduleReconnect();
    });

    ws.on("error", (err) => {
      log.error({ err }, "Bitget WS error");
      this.emit("error", err);
    });
  }

  private subscribe(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    // Bitget caps args per subscribe frame; chunk defensively even though our
    // symbol lists are typically small.
    const chunkSize = 50;
    for (let i = 0; i < this.subscriptions.length; i += chunkSize) {
      const args = this.subscriptions.slice(i, i + chunkSize);
      this.ws.send(JSON.stringify({ op: "subscribe", args }));
    }
  }

  private startPing(): void {
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send("ping");
      }
    }, this.config.WS_PING_INTERVAL_MS);
  }

  private startStaleCheck(): void {
    const checkEvery = Math.min(this.config.WS_STALE_TIMEOUT_MS, 15000);
    this.staleCheckTimer = setInterval(() => {
      if (Date.now() - this.lastMessageAt > this.config.WS_STALE_TIMEOUT_MS) {
        log.warn("Bitget WS stale connection detected, forcing reconnect");
        this.ws?.terminate();
      }
    }, checkEvery);
  }

  private clearTimers(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.staleCheckTimer) clearInterval(this.staleCheckTimer);
    this.pingTimer = null;
    this.staleCheckTimer = null;
  }

  private scheduleReconnect(): void {
    const attempt = ++this.reconnectAttempts;
    const backoff = Math.min(
      this.config.RECONNECT_MAX_DELAY_MS,
      this.config.RECONNECT_BASE_DELAY_MS * 2 ** (attempt - 1)
    );
    const delay = backoff + Math.floor(Math.random() * 250);
    log.info({ attempt, delay }, "scheduling Bitget WS reconnect");
    setTimeout(() => this.connect(), delay);
  }

  private handleRawMessage(raw: string): void {
    if (raw === "pong") return;

    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch (err) {
      log.warn({ err, raw: raw.slice(0, 200) }, "failed to parse WS message as JSON");
      return;
    }

    if (payload && typeof payload === "object" && "event" in payload) {
      const evt = payload as { event: string; msg?: string; code?: string };
      if (evt.event === "error") {
        log.error({ evt }, "Bitget WS reported error event");
      } else {
        log.debug({ evt }, "Bitget WS control event");
      }
      return;
    }

    const result = wsEnvelopeSchema.safeParse(payload);
    if (!result.success) {
      log.warn(
        { issues: result.error.issues, raw: raw.slice(0, 300) },
        "dropped malformed WS envelope"
      );
      return;
    }
    this.emit("message", result.data);
  }
}
