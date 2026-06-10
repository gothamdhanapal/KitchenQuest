import "server-only";

import { createClient } from "@supabase/supabase-js";
import { requirePublicSupabaseEnv, requireSupabaseSecretKey } from "@/lib/supabase/env";

export function createSupabaseAdminClient() {
  const { url } = requirePublicSupabaseEnv();

  return createClient(url, requireSupabaseSecretKey(), {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
