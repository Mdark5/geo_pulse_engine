import pino from "pino";

const level = process.env.LOG_LEVEL ?? "info";
const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level,
  base: { service: "market-ingestion" },
  timestamp: pino.stdTimeFunctions.isoTime,
  // Pretty-print in dev only; in production emit plain NDJSON so the async
  // pino writer never pays formatting cost on the hot ingestion path.
  transport: isProduction
    ? undefined
    : { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss.l" } },
});

export function childLogger(bindings: Record<string, unknown>) {
  return logger.child(bindings);
}
