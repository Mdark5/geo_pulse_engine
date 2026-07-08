import { z } from "zod";

const envSchema = z.object({
  SUPABASE_URL: z.string().url({ message: "SUPABASE_URL must be a valid URL" }),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, "SUPABASE_SERVICE_ROLE_KEY is required"),

  BITGET_WS_URL: z.string().url().default("wss://ws.bitget.com/v2/ws/public"),
  BITGET_INST_TYPE: z.string().default("USDT-FUTURES"),
  BITGET_SYMBOLS: z
    .string()
    .default("BTCUSDT,ETHUSDT")
    .transform((value) =>
      value
        .split(",")
        .map((symbol) => symbol.trim().toUpperCase())
        .filter(Boolean)
    ),
  BITGET_ORDERBOOK_CHANNEL: z.string().default("books15"),
  ORDERBOOK_DEPTH_LEVELS: z.coerce.number().int().positive().default(15),

  ORDERBOOK_SNAPSHOT_MIN_INTERVAL_MS: z.coerce.number().int().positive().default(500),
  OPEN_INTEREST_MIN_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  FUNDING_RATE_MIN_INTERVAL_MS: z.coerce.number().int().positive().default(5000),

  BATCH_FLUSH_INTERVAL_MS: z.coerce.number().int().positive().default(250),
  BATCH_MAX_SIZE: z.coerce.number().int().positive().default(500),

  WS_PING_INTERVAL_MS: z.coerce.number().int().positive().default(25000),
  WS_STALE_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),

  RECONNECT_BASE_DELAY_MS: z.coerce.number().int().positive().default(1000),
  RECONNECT_MAX_DELAY_MS: z.coerce.number().int().positive().default(30000),

  // Bounds every Supabase HTTP call so a network/DNS stall can never hang the
  // process indefinitely (including during graceful shutdown flushes).
  SUPABASE_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  // Upper bound on graceful shutdown; if writers/flushes haven't finished by
  // then, we force-exit rather than hang on SIGTERM/SIGINT forever.
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),

  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(): AppConfig {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid ingestion engine configuration:\n${issues}`);
  }
  return parsed.data;
}
