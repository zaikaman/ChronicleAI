// Test fixture helpers for database-backed tests

interface SupabaseClientLike {
  from: (table: string) => {
    delete: () => {
      neq: (column: string, value: string) => Promise<{ error: { message: string } | null }>;
    };
    insert: (data: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
  };
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
  const { error } = await supabase.from(tableName).delete().neq(idColumn, "00000000-0000-0000-0000-000000000000");

  if (error) {
    console.warn(`Cleanup warning for ${tableName}: ${error.message}`);
  }
}

export async function cleanupAllTables(supabase: SupabaseClientLike): Promise<void> {
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
