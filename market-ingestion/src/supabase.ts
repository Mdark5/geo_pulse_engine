import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { AppConfig } from "./config";

export function createSupabaseClient(config: AppConfig): SupabaseClient {
  return createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: "public" },
    global: {
      // Without this, a DNS/network stall on any query (including a flush
      // during graceful shutdown) can hang indefinitely — fetch has no
      // default timeout.
      fetch: (input, init) =>
        fetch(input, { ...init, signal: AbortSignal.timeout(config.SUPABASE_REQUEST_TIMEOUT_MS) }),
    },
  });
}
