// Test fixture helpers for database-backed tests.
// Mutating helpers refuse to run against real remote Supabase projects.

interface SupabaseClientLike {
  from: (table: string) => {
    delete: () => {
      neq: (column: string, value: string) => Promise<{ error: { message: string } | null }>;
    };
    insert: (data: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
  };
}

/**
 * Destructive table cleanup is only allowed when CHRONICLE_TEST_DB_ISOLATION=1
 * (set automatically by vitest) or ALLOW_DB_CLEANUP=1 with an explicit local target.
 * This prevents accidental wipes of shared/staging/production Supabase data.
 */
function assertDbMutationAllowed(operation: string): void {
  if (process.env.CHRONICLE_TEST_DB_ISOLATION === "1") {
    return;
  }
  if (process.env.ALLOW_DB_CLEANUP === "1") {
    const url = process.env.SUPABASE_URL ?? "";
    const isLocal =
      url.includes("127.0.0.1") ||
      url.includes("localhost") ||
      url.startsWith("http://127.0.0.1") ||
      url.startsWith("http://localhost");
    if (isLocal) {
      return;
    }
  }
  throw new Error(
    `${operation} blocked: refusing to mutate a non-isolated database. ` +
      `Run under vitest (CHRONICLE_TEST_DB_ISOLATION=1) or set ALLOW_DB_CLEANUP=1 with a local SUPABASE_URL.`,
  );
}

// ── Deterministic Timestamps ───────────────────────────
export function deterministicTimestamp(base: Date, offsetMs: number): string {
  return new Date(base.getTime() + offsetMs).toISOString();
}

export function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

export function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

// ── Cleanup Helper ─────────────────────────────────────
export async function cleanupTable(
  supabase: SupabaseClientLike,
  tableName: string,
  idColumn = "id",
): Promise<void> {
  assertDbMutationAllowed(`cleanupTable(${tableName})`);

  const { error } = await supabase
    .from(tableName)
    .delete()
    .neq(idColumn, "00000000-0000-0000-0000-000000000000");

  if (error) {
    console.warn(`Cleanup warning for ${tableName}: ${error.message}`);
  }
}

export async function cleanupAllTables(supabase: SupabaseClientLike): Promise<void> {
  assertDbMutationAllowed("cleanupAllTables");

  const tables = [
    "execution_logs",
    "payment_records",
    "premium_intelligence_items",
    "daily_digests",
    "public_alerts",
    "monitored_events",
    "treasury_snapshots",
  ];

  for (const table of tables) {
    await cleanupTable(supabase, table);
  }
}

// ── Fixture Builders ───────────────────────────────────
export function createMonitoredEventFixture(overrides: Record<string, unknown> = {}) {
  return {
    source: "test",
    source_event_id: `test-${Date.now()}`,
    event_type: "large_swap",
    chain_id: 1,
    captured_at: new Date().toISOString(),
    raw_payload: { test: true },
    status: "received",
    ...overrides,
  };
}

export function createPublicAlertFixture(overrides: Record<string, unknown> = {}) {
  return {
    title: "Test Alert",
    summary: "This is a test alert for development and testing.",
    source_references: ["test-ref-1"],
    delivery_status: "draft",
    ...overrides,
  };
}

export function createPaymentRecordFixture(overrides: Record<string, unknown> = {}) {
  return {
    premium_item_id: "",
    payment_route: "x402" as const,
    status: "challenge_issued" as const,
    requested_at: new Date().toISOString(),
    ...overrides,
  };
}
