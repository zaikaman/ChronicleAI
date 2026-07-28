// Factory for server-side Supabase client creation
// Intended only for backend/API usage

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types.ts";
import { createInMemorySupabaseClient } from "./in-memory-supabase.ts";

/** Typed Supabase client for ChronicleAI (P2-5). */
export type AppSupabaseClient = SupabaseClient<Database>;

export interface SupabaseServerConfig {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  /**
   * Per-request fetch timeout in ms (PostgREST / Auth HTTP).
   * Default 15_000. Set SUPABASE_FETCH_TIMEOUT_MS in env via callers.
   */
  fetchTimeoutMs?: number;
}

const DEFAULT_FETCH_TIMEOUT_MS = 15_000;

/**
 * Fetch wrapper with AbortSignal timeout so hung PostgREST calls fail fast.
 */
export function createTimedFetch(timeoutMs: number): typeof fetch {
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

/**
 * Create a server-side Supabase client typed with generated `Database`.
 *
 * - Session persistence disabled (service-role / backend only).
 * - HTTP fetch timeout applied (default 15s).
 * - Prefer Supavisor **transaction pooler** URL for direct Postgres tools;
 *   this client uses the REST API (`SUPABASE_URL`), which is already edge-pooled.
 *   Point `SUPABASE_URL` at the project API URL (or a custom domain in front of it).
 *
 * When CHRONICLE_TEST_DB_ISOLATION=1 (set by the Vitest setup), returns an
 * in-memory client so unit/contract tests never open network connections or
 * mutate a real project database.
 */
export function createServerSupabaseClient(
  config: SupabaseServerConfig,
): AppSupabaseClient {
  if (process.env.CHRONICLE_TEST_DB_ISOLATION === "1") {
    return createInMemorySupabaseClient() as unknown as AppSupabaseClient;
  }

  const envTimeout = Number.parseInt(process.env.SUPABASE_FETCH_TIMEOUT_MS ?? "", 10);
  const timeoutMs =
    config.fetchTimeoutMs ??
    (Number.isFinite(envTimeout) && envTimeout > 0 ? envTimeout : DEFAULT_FETCH_TIMEOUT_MS);

  return createClient<Database>(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      fetch: createTimedFetch(timeoutMs),
    },
  });
}
