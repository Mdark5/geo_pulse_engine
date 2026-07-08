import { SupabaseClient } from "@supabase/supabase-js";
import { childLogger } from "../logger";

const log = childLogger({ component: "batch-writer" });

export interface BatchWriterOptions {
  table: string;
  flushIntervalMs: number;
  maxBatchSize: number;
  mode: "insert" | "upsert";
  /** Required when mode === "upsert": comma-separated columns matching a unique constraint/index. */
  onConflict?: string;
}

/**
 * Buffers rows in memory and flushes them to Supabase on a timer or once a size
 * threshold is hit, so a burst of market data never triggers one write per row.
 * Failures are logged and the batch is dropped rather than retried in place —
 * blocking the ingestion pipeline on a slow/failing DB would build unbounded
 * backpressure into the WebSocket read loop.
 */
export class BatchWriter<T extends object> {
  private queue: T[] = [];
  private timer: NodeJS.Timeout | null = null;
  private flushing = false;

  constructor(private readonly client: SupabaseClient, private readonly options: BatchWriterOptions) {
    if (options.mode === "upsert" && !options.onConflict) {
      throw new Error(`BatchWriter for "${options.table}" is in upsert mode but has no onConflict target`);
    }
  }

  start(): void {
    this.timer = setInterval(() => {
      void this.flush();
    }, this.options.flushIntervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  enqueue(row: T): void {
    this.queue.push(row);
    if (this.queue.length >= this.options.maxBatchSize) {
      void this.flush();
    }
  }

  async flushAndWait(): Promise<void> {
    await this.flush();
  }

  private async flush(): Promise<void> {
    if (this.flushing || this.queue.length === 0) return;
    this.flushing = true;
    const batch = this.queue;
    this.queue = [];

    try {
      // Cast to `any`: this client has no generated Database schema type, so
      // supabase-js's excess-property-check generics have nothing meaningful
      // to check `batch` against here — validation already happened upstream
      // via the zod schemas in bitget/schemas.ts.
      const query =
        this.options.mode === "upsert"
          ? this.client
              .from(this.options.table)
              .upsert(batch as any[], { onConflict: this.options.onConflict, ignoreDuplicates: true })
          : this.client.from(this.options.table).insert(batch as any[]);

      const { error } = await query;
      if (error) {
        log.error({ table: this.options.table, error, batchSize: batch.length }, "batch write failed");
      } else {
        log.debug({ table: this.options.table, batchSize: batch.length }, "batch write succeeded");
      }
    } catch (err) {
      log.error({ table: this.options.table, err, batchSize: batch.length }, "batch write threw");
    } finally {
      this.flushing = false;
    }
  }
}
