import { SupabaseClient } from "@supabase/supabase-js";
import { childLogger } from "../logger";

const log = childLogger({ component: "project-registry" });

const QUOTE_ASSETS = ["USDT", "USDC", "USD"];

function splitSymbol(symbol: string): { baseAsset: string; quoteAsset: string } {
  const quote = QUOTE_ASSETS.find((q) => symbol.endsWith(q));
  if (!quote) return { baseAsset: symbol, quoteAsset: "" };
  return { baseAsset: symbol.slice(0, -quote.length), quoteAsset: quote };
}

/**
 * Resolves configured symbols to their `projects.id` row, creating the row if
 * it doesn't exist yet, and caches the mapping so the hot ingestion path never
 * makes a DB round trip per message.
 */
export class ProjectRegistry {
  private readonly idBySymbol = new Map<string, string>();

  constructor(private readonly client: SupabaseClient) {}

  async ensureProjects(symbols: string[]): Promise<void> {
    for (const symbol of symbols) {
      const { baseAsset, quoteAsset } = splitSymbol(symbol);
      const { data, error } = await this.client
        .from("projects")
        .upsert(
          {
            exchange: "bitget",
            symbol,
            contract_type: "perpetual",
            base_asset: baseAsset,
            quote_asset: quoteAsset,
            is_active: true,
          },
          { onConflict: "exchange,symbol" }
        )
        .select("id")
        .single();

      if (error || !data) {
        log.error({ symbol, error }, "failed to register project; ingestion for this symbol will be skipped");
        continue;
      }
      this.idBySymbol.set(symbol, data.id as string);
      log.info({ symbol, projectId: data.id }, "project registered");
    }
  }

  getProjectId(symbol: string): string | undefined {
    return this.idBySymbol.get(symbol);
  }
}
