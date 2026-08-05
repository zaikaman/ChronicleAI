import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { Database, DeskSignalRow } from "@chronicleai/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CapitalDecision } from "../src/desk/types.ts";
import {
  buildCapitalAlertCopy,
  buildSignalAlertCopy,
  isDeskTriggerCapitalAction,
  isDeskTriggerSignalType,
} from "../src/services/desk-trigger-alert-service.ts";

const DESK_ALERT_SELECT = [
  "id",
  "title",
  "summary",
  "delivery_status",
  "alert_kind",
  "signal_type",
  "policy_verdict",
  "chain_id",
  "deterministic_evidence",
  "content_hash",
  "registry_tx_hash",
  "created_at",
].join(",");

type DeskAlertRow = {
  id: string;
  title: string;
  summary: string;
  delivery_status: string;
  alert_kind: string;
  signal_type: string | null;
  policy_verdict: string | null;
  chain_id: number | null;
  deterministic_evidence: unknown;
  content_hash: string | null;
  registry_tx_hash: string | null;
  created_at: string;
};

type RefreshPlan = {
  row: DeskAlertRow;
  title: string;
  summary: string;
  reason: "signal" | "capital";
};

function loadEnvFile(): void {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;

  const content = fs.readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function buildRefreshPlan(row: DeskAlertRow): RefreshPlan | null {
  if (row.alert_kind !== "desk_trigger") return null;

  const evidence = asRecord(row.deterministic_evidence) ?? {};
  const evidenceFeatures = asRecord(evidence.features) ?? {};
  const signalType = row.signal_type ?? asString(evidence.signalType);
  const verdict = row.policy_verdict ?? asString(evidence.policyVerdict);

  if (
    signalType &&
    isDeskTriggerSignalType(signalType) &&
    verdict &&
    (verdict === "trade" || verdict === "defend" || verdict === "defer")
  ) {
    const copy = buildSignalAlertCopy({
      signal_type: signalType,
      chain_id: row.chain_id ?? 11_155_111,
      policy_verdict: verdict,
      features: evidenceFeatures,
    } as DeskSignalRow);
    return { row, ...copy, reason: "signal" };
  }

  const capital = asRecord(evidence.capital);
  const action = asString(capital?.action);
  const amountUsdc = asNumber(capital?.amountUsdc);
  const reason = asString(capital?.reason);
  if (
    action &&
    isDeskTriggerCapitalAction(action) &&
    amountUsdc != null &&
    reason
  ) {
    const copy = buildCapitalAlertCopy({
      action,
      amountUsdc,
      reason,
      inventorySource: asString(capital?.inventorySource) ?? undefined,
      direction: asString(capital?.direction) ?? undefined,
    } as CapitalDecision);
    return { row, ...copy, reason: "capital" };
  }

  return null;
}

async function loadDeskAlerts(
  supabase: SupabaseClient<Database>,
): Promise<DeskAlertRow[]> {
  const rows: DeskAlertRow[] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("public_alerts")
      .select(DESK_ALERT_SELECT)
      .eq("alert_kind", "desk_trigger")
      .order("created_at", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error(`Failed to load Desk alerts: ${error.message}`);
    const page = (data ?? []) as unknown as DeskAlertRow[];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

async function main(): Promise<void> {
  loadEnvFile();
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }

  const apply = process.argv.includes("--apply");
  const supabase = createClient<Database>(supabaseUrl, serviceRoleKey);
  const alerts = await loadDeskAlerts(supabase);
  const plans = alerts
    .map(buildRefreshPlan)
    .filter((plan): plan is RefreshPlan => plan !== null);
  const anchored = plans.filter(
    ({ row }) => row.content_hash !== null || row.registry_tx_hash !== null,
  );
  const safeToUpdate = plans.filter(
    ({ row }) => row.content_hash === null && row.registry_tx_hash === null,
  );
  const alreadyCurrent = plans.filter(
    ({ row, title, summary }) => row.title === title && row.summary === summary,
  );
  const changes = safeToUpdate.filter(
    ({ row, title, summary }) => row.title !== title || row.summary !== summary,
  );

  console.log(`Desk alerts found: ${alerts.length}`);
  console.log(`Recognized deterministic alerts: ${plans.length}`);
  console.log(`Already using current copy: ${alreadyCurrent.length}`);
  console.log(`Safe historical updates available: ${changes.length}`);
  console.log(`Skipped because proof is anchored: ${anchored.length}`);
  console.log(`Mode: ${apply ? "APPLY" : "DRY RUN"}`);

  for (const plan of changes.slice(0, 20)) {
    console.log(`\n${plan.row.id} [${plan.reason}] ${plan.row.created_at}`);
    console.log(`  OLD: ${plan.row.title}`);
    console.log(`  NEW: ${plan.title}`);
    console.log(`  OLD SUMMARY: ${plan.row.summary}`);
    console.log(`  NEW SUMMARY: ${plan.summary}`);
  }

  if (!apply) {
    console.log("\nDry run complete. Pass --apply to update only safe, unanchored rows.");
    return;
  }

  let updated = 0;
  for (const plan of changes) {
    const { data, error } = await supabase
      .from("public_alerts")
      .update({ title: plan.title, summary: plan.summary })
      .eq("id", plan.row.id)
      .is("content_hash", null)
      .is("registry_tx_hash", null)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(`Failed to update ${plan.row.id}: ${error.message}`);
    if (!data) throw new Error(`Update guard matched no row for ${plan.row.id}`);
    updated += 1;
  }

  console.log(`\nUpdated ${updated} historical alert(s).`);
  if (anchored.length > 0) {
    console.log(
      `Left ${anchored.length} proof-anchored alert(s) unchanged so their on-chain content hashes remain valid.`,
    );
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
