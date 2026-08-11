/**
 * Global Vitest setup: ensure no test process can talk to a real Supabase project.
 *
 * Forces unreachable/dummy Supabase credentials (overrides .env) and sets
 * CHRONICLE_TEST_DB_ISOLATION=1 so createServerSupabaseClient() returns an
 * in-memory client (see packages/db/src/supabase-server.ts).
 */

// Hard isolation: never inherit real project credentials from root .env / shell
process.env.SUPABASE_URL = "http://127.0.0.1:9";
process.env.SUPABASE_SERVICE_ROLE_KEY = "vitest-isolated-service-role-key";
process.env.CHRONICLE_TEST_DB_ISOLATION = "1";
