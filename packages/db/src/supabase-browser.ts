// Factory for browser/client-side Supabase client creation
// Accepts only browser-safe config. Never references service role keys.

import { createClient } from "@supabase/supabase-js";

export interface SupabaseBrowserConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
}

export function createBrowserSupabaseClient(config: SupabaseBrowserConfig) {
  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
    },
  });
}
