import "server-only";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "../env";

/**
 * Service-role client. SERVER ONLY. Bypasses RLS, so it is used exclusively for:
 *  - inviting / deleting admin users (Supabase Auth admin API)
 *  - reading private notification settings when an inquiry arrives
 * Every caller must perform its own authorization check first.
 */
export function createServiceClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return createClient(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
