import type { Database, Json } from "@chronicleai/db";
import { createClient } from "@supabase/supabase-js";

type PublicAlert = Database["public"]["Tables"]["public_alerts"]["Row"];
type AlertRepairRow = Pick<
  PublicAlert,
  | "id"
  | "title"
  | "summary"
  | "action_transaction_hash"
  | "action_explorer_url"
  | "action_keeper_hub_run_id"
  | "deterministic_evidence"
  | "created_at"
>;

type TransactionEntry = {
  hash?: unknown;
  chainId?: unknown;
  nodeId?: unknown;
  nodeName?: unknown;
  transactionLink?: unknown;
};

type ExecutionPayload = {
  transactionHashes?: unknown;
  transactionHash?: unknown;
};

type KeeperHubLogs = {
  execution?: ExecutionPayload;
};

const pageSize = 500;
const applyChanges = process.argv.includes("--apply");
const supabaseUrl = process.env.SUPABASE_URL?.trim();
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const keeperHubBaseUrl = process.env.KEEPERHUB_API_BASE_URL?.replace(/\/+$/, "");
const keeperHubApiKey = process.env.KEEPERHUB_API_KEY?.trim();

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
}
if (!keeperHubBaseUrl || !keeperHubApiKey) {
  throw new Error("KEEPERHUB_API_BASE_URL and KEEPERHUB_API_KEY are required");
}

const supabase = createClient<Database>(supabaseUrl, supabaseServiceRoleKey);
const apiKey = keeperHubApiKey;

function asRecord(value: Json | unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function formatUsdc(amount: number): string {
  if (amount >= 1000) return `$${amount.toFixed(0)}`;
  if (amount >= 1) return `$${amount.toFixed(2)}`;
  return `$${amount.toFixed(4)}`;
}

function readableReason(reason: string): string {
  const knownReasons: Record<string, string> = {
    free_usdc_shortfall_unwind: "the desk needed more ready-to-use cash",
    free_usdc_shortfall: "the desk needed more ready-to-use cash",
  };
  return knownReasons[reason] ?? reason.replace(/_/g, " ");
}

function freeInventoryCopy(row: AlertRepairRow): { title: string; summary: string } | null {
  const evidence = asRecord(row.deterministic_evidence);
  const capital = asRecord(evidence?.capital);
  if (capital?.action !== "free_inventory") return null;

  const amount = Number(capital.amountUsdc);
  if (!Number.isFinite(amount)) return null;

  const sourceLabel =
    capital.inventorySource === "aave_link"
      ? "LINK supplied to Aave"
      : capital.inventorySource === "mixed"
        ? "LINK inventory"
        : capital.inventorySource === "free_link"
          ? "LINK"
          : "inventory assets";
  const chain =
    (typeof evidence?.executionChain === "string" && evidence.executionChain) ||
    (typeof evidence?.sourceChain === "string" && evidence.sourceChain) ||
    "the execution network";
  const reason =
    typeof capital.reason === "string"
      ? readableReason(capital.reason)
      : "the desk needed more ready-to-use cash";
  const amountLabel = formatUsdc(amount);

  return {
    title: `Swapping ${amountLabel} of ${sourceLabel} into USDC for desk activity`,
    summary: `Chronicle Desk planned to swap up to ${amountLabel} worth of ${sourceLabel} into USDC on ${chain} because ${reason}.`,
  };
}

function explorerUrlForTx(hash: string, chainId: number | null): string {
  if (chainId === 84532) return `https://sepolia.basescan.org/tx/${hash}`;
  return `https://sepolia.etherscan.io/tx/${hash}`;
}

function transactionEntries(value: unknown): TransactionEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): TransactionEntry[] => {
    if (typeof entry === "string") return [{ hash: entry }];
    return asRecord(entry) ? [entry as TransactionEntry] : [];
  });
}

async function loadAlerts(): Promise<AlertRepairRow[]> {
  const rows: AlertRepairRow[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("public_alerts")
      .select(
        "id,title,summary,action_transaction_hash,action_explorer_url,action_keeper_hub_run_id,deterministic_evidence,created_at",
      )
      .eq("alert_kind", "desk_trigger")
      .eq("action_status", "filled")
      .order("created_at", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data as AlertRepairRow[]));
    if (data.length < pageSize) return rows;
  }
}

async function fetchFinalAction(row: AlertRepairRow): Promise<
  | {
      expectedHash: string;
      expectedExplorerUrl: string;
      finalNode: string | null;
      hashes: string[];
    }
  | { error: string }
> {
  if (!row.action_keeper_hub_run_id) return { error: "missing action KeeperHub run id" };

  const response = await fetch(
    `${keeperHubBaseUrl}/api/workflows/executions/${encodeURIComponent(row.action_keeper_hub_run_id)}/logs`,
    { headers: { Authorization: `Bearer ${apiKey}`, "x-api-key": apiKey } },
  );
  let body: KeeperHubLogs = {};
  try {
    body = (await response.json()) as KeeperHubLogs;
  } catch {
    // The HTTP status is sufficient to diagnose a non-JSON KeeperHub response.
  }
  if (!response.ok) return { error: `KeeperHub logs HTTP ${response.status}` };

  const execution: ExecutionPayload = body.execution ?? {};
  const entries = transactionEntries(execution.transactionHashes);
  const hashes = entries
    .map((entry) => (typeof entry.hash === "string" ? entry.hash : ""))
    .filter((hash) => hash.length > 0);
  const finalEntry = entries[entries.length - 1];
  const expectedHash =
    hashes[hashes.length - 1] ??
    (typeof execution.transactionHash === "string" ? execution.transactionHash : "");
  if (!expectedHash) return { error: "KeeperHub run has no transaction hash" };

  const chainId = typeof finalEntry?.chainId === "number" ? finalEntry.chainId : null;
  const expectedExplorerUrl =
    typeof finalEntry?.transactionLink === "string" && finalEntry.transactionLink.length > 0
      ? finalEntry.transactionLink
      : explorerUrlForTx(expectedHash, chainId);
  const finalNode =
    typeof finalEntry?.nodeName === "string"
      ? finalEntry.nodeName
      : typeof finalEntry?.nodeId === "string"
        ? finalEntry.nodeId
        : null;

  return { expectedHash, expectedExplorerUrl, finalNode, hashes };
}

const alerts = await loadAlerts();
const results: Array<{
  row: AlertRepairRow;
  action: Awaited<ReturnType<typeof fetchFinalAction>>;
  copy: ReturnType<typeof freeInventoryCopy>;
}> = [];
let cursor = 0;
const worker = async () => {
  while (true) {
    const index = cursor++;
    if (index >= alerts.length) return;
    const row = alerts[index];
    if (!row) return;
    results[index] = { row, action: await fetchFinalAction(row), copy: freeInventoryCopy(row) };
  }
};
await Promise.all(Array.from({ length: 8 }, worker));

const actionMismatches = results.filter(
  ({ row, action }) =>
    "expectedHash" in action &&
    (row.action_transaction_hash !== action.expectedHash ||
      row.action_explorer_url !== action.expectedExplorerUrl),
);
const unavailable = results.filter(({ action }) => "error" in action);
const copyMismatches = results.filter(
  ({ row, copy }) => copy && (row.title !== copy.title || row.summary !== copy.summary),
);

console.log(
  JSON.stringify(
    {
      mode: applyChanges ? "apply" : "dry-run",
      checkedFilledDeskAlerts: alerts.length,
      verifiedActionMismatches: actionMismatches.length,
      unavailableActionRuns: unavailable.length,
      freeInventoryCopyMismatches: copyMismatches.length,
      sampleActionRepairs: actionMismatches.slice(0, 8).map(({ row, action }) => ({
        id: row.id,
        stored: row.action_transaction_hash,
        replacement: "expectedHash" in action ? action.expectedHash : null,
        finalNode: "finalNode" in action ? action.finalNode : null,
      })),
      unavailableRuns: unavailable.map(({ row, action }) => ({
        id: row.id,
        run: row.action_keeper_hub_run_id,
        error: "error" in action ? action.error : null,
      })),
    },
    null,
    2,
  ),
);

if (!applyChanges) process.exit(0);

let repairedActions = 0;
let repairedCopy = 0;
for (const { row, action, copy } of results) {
  if (
    "expectedHash" in action &&
    actionMismatches.some(({ row: candidate }) => candidate.id === row.id)
  ) {
    const { error } = await supabase
      .from("public_alerts")
      .update({
        action_transaction_hash: action.expectedHash,
        action_explorer_url: action.expectedExplorerUrl,
      })
      .eq("id", row.id);
    if (error) throw error;
    repairedActions += 1;
  }

  if (copy && copyMismatches.some(({ row: candidate }) => candidate.id === row.id)) {
    const { error } = await supabase
      .from("public_alerts")
      .update({ title: copy.title, summary: copy.summary })
      .eq("id", row.id);
    if (error) throw error;
    repairedCopy += 1;
  }
}

console.log(JSON.stringify({ repairedActions, repairedCopy }, null, 2));
