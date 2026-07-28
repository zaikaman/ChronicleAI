// Factory for browser/client-side Supabase client creation.
// Accepts only browser-safe config. Never references service role keys.
//
// P3-8: Safe only after RLS is enabled (see supabase/migrations/*_enable_rls.sql).
// Prefer the Express API for privileged reads/writes; use this client only for
// anon-scoped public selects covered by RLS policies.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types.ts";

export type BrowserSupabaseClient = SupabaseClient<Database>;

export interface SupabaseBrowserConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  /** Optional fetch timeout (ms). Default 15_000. */
  fetchTimeoutMs?: number;
}

function createTimedFetch(timeoutMs: number): typeof fetch {
  const ms = Math.max(1_000, timeoutMs);
  return async (input, init) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), ms);
    const parentSignal = init?.signal;
    const onParentAbort = () => controller.abort(parentSignal?.reason);
    if (parentSignal) {
      if (parentSignal.aborted) {
        clearTimeout(timeoutId);
        throw new DOMException("The operation was aborted.", "AbortError");
      }
      parentSignal.addEventListener("abort", onParentAbort, { once: true });
    }
    try {
      return await fetch(input, {
        ...init,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
      parentSignal?.removeEventListener("abort", onParentAbort);
    }
  };
}

export function createBrowserSupabaseClient(
  config: SupabaseBrowserConfig,
): BrowserSupabaseClient {
  const timeoutMs = config.fetchTimeoutMs ?? 15_000;
  return createClient<Database>(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
    },
    global: {
      fetch: createTimedFetch(timeoutMs),
    },
  });
}
