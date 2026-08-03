/**
 * Phase 0 — Snapshot desk / KeeperHub baseline metrics for the execution plan appendix.
 *
 * Usage (from apps/api):
 *   pnpm exec tsx --env-file=.env scripts/snapshot-desk-baseline.ts
 *   pnpm exec tsx --env-file=.env scripts/snapshot-desk-baseline.ts --json
 *
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (via loadServerEnv).
 */

import { loadServerEnv } from "@chronicleai/config";
import { createClient } from "@supabase/supabase-js";

interface CountResult {
  label: string;
  count: number | null;
}

type CountQuery = {
  select: (
    columns: string,
    options: { count: "exact"; head: boolean },
  ) => CountQuery;
  eq: (column: string, value: string) => CountQuery;
  not: (column: string, operator: string, value: null) => CountQuery;
  then: (
    onfulfilled?: (value: {
      count: number | null;
      error: { message: string } | null;
    }) => unknown,
  ) => Promise<{ count: number | null; error: { message: string } | null }>;
};

async function countExact(
  from: (table: string) => CountQuery,
  table: string,
  apply?: (q: CountQuery) => CountQuery,
): Promise<number | null> {
  let query = from(table).select("*", { count: "exact", head: true });
  if (apply) {
    query = apply(query);
  }
  const { count, error } = await query;
  if (error) {
    console.error(`count ${table} failed:`, error.message);
    return null;
  }
  return count ?? 0;
}

async function main(): Promise<void> {
  const asJson = process.argv.includes("--json");
  const env = loadServerEnv();
  const supabase = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const from = (table: string) => supabase.from(table) as unknown as CountQuery;

  const results: CountResult[] = [
    {
      label: "Alert registry writes (alerts with registry_tx_hash)",
      count: await countExact(from, "public_alerts", (q) =>
        q.not("registry_tx_hash", "is", null),
      ),
    },
    {
      label: "Public alerts (all)",
      count: await countExact(from, "public_alerts"),
    },
    {
      label: "Digest registry writes (digests with registry_tx_hash)",
      count: await countExact(from, "daily_digests", (q) =>
        q.not("registry_tx_hash", "is", null),
      ),
    },
    {
      label: "Daily digests (all)",
      count: await countExact(from, "daily_digests"),
    },
    {
      label: "Desk signals",
      count: await countExact(from, "desk_signals"),
    },
    {
      label: "Desk filled intents",
      count: await countExact(from, "desk_intents", (q) =>
        q.eq("status", "filled"),
      ),
    },
    {
      label: "Desk intents (all)",
      count: await countExact(from, "desk_intents"),
    },
    {
      label: "Desk trade tickets",
      count: await countExact(from, "desk_tickets"),
    },
    {
      label: "Desk capital moves",
      count: await countExact(from, "desk_capital_moves"),
    },
    {
      label: "desk_agent_runs",
      count: await countExact(from, "desk_agent_runs"),
    },
    {
      label: "execution_logs",
      count: await countExact(from, "execution_logs"),
    },
    {
      label: "execution_logs desk_agent",
      count: await countExact(from, "execution_logs", (q) =>
        q.eq("action_type", "desk_agent"),
      ),
    },
    {
      label: "execution_logs registry_write",
      count: await countExact(from, "execution_logs", (q) =>
        q.eq("action_type", "registry_write"),
      ),
    },
    {
      label: "Sponsored watches",
      count: await countExact(from, "sponsored_watches"),
    },
    {
      label: "Payout records",
      count: await countExact(from, "payout_records"),
    },
    {
      label: "x402 payments settled",
      count: await countExact(from, "payment_records", (q) =>
        q.eq("status", "settled"),
      ),
    },
    {
      label: "CCTP rebalance transfers",
      count: await countExact(from, "cctp_rebalance_transfers"),
    },
    {
      label: "CCTP failed",
      count: await countExact(from, "cctp_rebalance_transfers", (q) =>
        q.eq("status", "failed"),
      ),
    },
  ];

  const { data: latestPosition, error: posError } = await supabase
    .from("desk_positions")
    .select("as_of, usdc, link, weth, equity_usdc, aave, created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (posError) {
    console.error("latest desk_positions failed:", posError.message);
  }

  const { data: filledIntents, error: fillError } = await supabase
    .from("desk_intents")
    .select("id, strategy, notional_usdc, status, created_at, keeper_hub_run_id")
    .eq("status", "filled")
    .order("created_at", { ascending: false })
    .limit(10);

  if (fillError) {
    console.error("filled intents sample failed:", fillError.message);
  }

  const snapshotAt = new Date().toISOString();

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          snapshotAt,
          counts: results,
          latestPosition: latestPosition ?? null,
          recentFilledIntents: filledIntents ?? [],
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log("=== Desk / KeeperHub baseline snapshot ===");
  console.log(`snapshotAt: ${snapshotAt}`);
  console.log("");
  console.log("| Surface | Count |");
  console.log("| --- | ---: |");
  for (const row of results) {
    const countStr = row.count == null ? "error" : String(row.count);
    console.log(`| ${row.label} | ${countStr} |`);
  }

  console.log("");
  console.log("--- Latest desk position ---");
  if (latestPosition) {
    const aave =
      latestPosition.aave && typeof latestPosition.aave === "object"
        ? (latestPosition.aave as Record<string, unknown>)
        : {};
    console.log(
      [
        `as_of: ${latestPosition.as_of ?? latestPosition.created_at ?? "n/a"}`,
        `free_usdc: ${latestPosition.usdc ?? "n/a"}`,
        `free_link: ${latestPosition.link ?? "n/a"}`,
        `free_weth: ${latestPosition.weth ?? "n/a"}`,
        `equity_usdc: ${latestPosition.equity_usdc ?? "n/a"}`,
        `collateral_usd: ${aave.totalCollateralUsd ?? aave.total_collateral_usd ?? "n/a"}`,
        `debt_usd: ${aave.totalDebtUsd ?? aave.total_debt_usd ?? "n/a"}`,
        `health_factor: ${aave.healthFactor ?? aave.health_factor ?? "n/a"}`,
      ].join("\n"),
    );
  } else {
    console.log("(none)");
  }

  console.log("");
  console.log("--- Recent filled desk intents ---");
  if (filledIntents && filledIntents.length > 0) {
    for (const row of filledIntents) {
      console.log(
        `${row.created_at}  ${row.strategy}  notional=${row.notional_usdc}  id=${row.id}` +
          (row.keeper_hub_run_id ? `  run=${row.keeper_hub_run_id}` : ""),
      );
    }
  } else {
    console.log("(none)");
  }

}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
