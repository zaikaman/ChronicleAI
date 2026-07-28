/**
 * Global Vitest setup: ensure no test process can talk to a real Supabase project.
 *
 * Forces unreachable/dummy Supabase credentials (overrides .env) and sets
 * CHRONICLE_TEST_DB_ISOLATION=1 so createServerSupabaseClient() returns an
 * in-memory client (see packages/db/src/supabase-server.ts).
 *
 * Live HTTP contract tests against a running API are gated separately via
 * ALLOW_LIVE_API_TESTS=1 (see tests/contracts/live-api.ts).
 */

// Hard isolation: never inherit real project credentials from root .env / shell
process.env.SUPABASE_URL = "http://127.0.0.1:9";
process.env.SUPABASE_SERVICE_ROLE_KEY = "vitest-isolated-service-role-key";
process.env.CHRONICLE_TEST_DB_ISOLATION = "1";

// Prevent accidental live-API default targets unless the operator opts in.
if (process.env.ALLOW_LIVE_API_TESTS !== "1") {
  delete process.env.API_BASE_URL;
  delete process.env.TEST_API_URL;
}
