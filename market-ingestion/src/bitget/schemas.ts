import { z } from "zod";

// Bitget v2 public WS envelope: { action?, arg: { instType, channel, instId }, data: [...], ts }
export const wsEnvelopeSchema = z.object({
  action: z.enum(["snapshot", "update"]).optional(),
  arg: z.object({
    instType: z.string(),
    channel: z.string(),
    instId: z.string(),
  }),
  data: z.array(z.unknown()),
  ts: z.union([z.string(), z.number()]).optional(),
});
export type WsEnvelope = z.infer<typeof wsEnvelopeSchema>;

export const tradeItemSchema = z.object({
  ts: z.union([z.string(), z.number()]),
  price: z.union([z.string(), z.number()]),
  size: z.union([z.string(), z.number()]),
  side: z.enum(["buy", "sell"]),
  tradeId: z.union([z.string(), z.number()]),
});

const bookLevelSchema = z.tuple([z.string(), z.string()]);

export const orderbookItemSchema = z.object({
  asks: z.array(bookLevelSchema),
  bids: z.array(bookLevelSchema),
  ts: z.union([z.string(), z.number()]),
});

// Field names for funding rate / open interest on the ticker channel vary across
// exchange API revisions. We accept the known candidates and fall back gracefully
// rather than throwing — verify against current Bitget v2 docs before relying on
// this in production, and add any missing field name here if Bitget renames it.
export const tickerItemSchema = z
  .object({
    ts: z.union([z.string(), z.number()]).optional(),
    fundingRate: z.union([z.string(), z.number()]).optional(),
    nextFundingTime: z.union([z.string(), z.number()]).optional(),
    openInterest: z.union([z.string(), z.number()]).optional(),
    holdingAmount: z.union([z.string(), z.number()]).optional(),
    holdingAmountValue: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();
