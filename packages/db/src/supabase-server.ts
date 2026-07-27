// Factory for server-side Supabase client creation
// Intended only for backend/API usage

import { createClient } from "@supabase/supabase-js";

export interface SupabaseServerConfig {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
}

export function createServerSupabaseClient(config: SupabaseServerConfig) {
  return createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
