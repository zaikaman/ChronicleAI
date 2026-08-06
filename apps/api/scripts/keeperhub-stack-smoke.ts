/**
 * KeeperHub Stack Smoke Test
 *
 * Live verification of KeeperHub stack surfaces. Never prints PASS without a check.
 *
 * Checks:
 *  1. KeeperHub GET /api/health
 *  2. Private routing chain capability (Sepolia 11155111 via GET /api/chains)
 *  3. Configured KEEPERHUB_WORKFLOW_* IDs resolve via GET /api/workflows/{id}
 *     (FAIL if missing, soft-deleted, or disabled)
 *  4. Workflow version/content drift vs checked-in workflows/keeperhub/*.workflow.json
 *  5. MCP server tool discovery (expected write-path tools present)
 *
 * Usage:
 *   pnpm --filter @chronicleai/api exec tsx scripts/keeperhub-stack-smoke.ts
 *
 * Exit 0 only when every required check passes. Missing optional workflow IDs
 * are reported as WARN (not FAIL) so partial local setups remain inspectable.
 */

import fs from "node:fs";
import path from "node:path";
import {
  isKeeperHubMcpConfigured,
  resolveKeeperHubMcpUrl,
  withKeeperHubMcpClient,
} from "../src/services/keeperhub-mcp-client.ts";
import { fetchKeeperHubPrivateMempoolCapability } from "../src/services/keeperhub-private-capability.ts";
import {
  assessWorkflowDrift,
  asRecord,
  loadCheckedInWorkflow,
  readHistoryLatestMeta,
  readLiveWorkflowContentHash,
  resolveWorkflowsKeeperhubDir,
} from "../src/services/keeperhub-workflow-drift.ts";
import {
  PRIVATE_ROUTING_CHAIN_ID,
  PRIVATE_ROUTING_PRODUCT_DESCRIPTION,
} from "../src/services/routing-metadata.ts";
type CheckStatus = "PASS" | "FAIL" | "WARN" | "SKIP";

interface CheckResult {
  name: string;
  status: CheckStatus;
  detail: string;
}

/**
 * MCP tools the production write path actually calls on the KeeperHub server.
 * `get_execution_status` / `get_execution_logs` are Chronicle client aliases over
 * `get_execution` — they are not required as distinct server tools.
 */
const EXPECTED_MCP_TOOLS = [
  "list_workflows",
  "get_workflow",
  "execute_workflow",
  "get_execution",
] as const;

/** Core write-path workflow env keys used by production registry + desk paths. */
const WORKFLOW_ENV_KEYS = [
  "KEEPERHUB_WORKFLOW_PUBLISH_ALERT",
  "KEEPERHUB_WORKFLOW_PUBLISH_DIGEST",
  "KEEPERHUB_WORKFLOW_CREATE_SPONSORED_WATCH",
  "KEEPERHUB_WORKFLOW_PUBLISH_SPONSORED_REPORT",
  "KEEPERHUB_WORKFLOW_PUBLISH_PREMIUM_RECEIPT",
  "KEEPERHUB_WORKFLOW_RECORD_PAYOUT",
  "KEEPERHUB_WORKFLOW_PUBLISH_TRADE_TICKET",
  "KEEPERHUB_WORKFLOW_RECORD_CAPITAL_MOVE",
  "KEEPERHUB_WORKFLOW_RECORD_CAPITAL_MOVE_PUBLIC_FALLBACK",
  "KEEPERHUB_WORKFLOW_TRANSFER",
  "KEEPERHUB_WORKFLOW_DESK_SWEEP",
  "KEEPERHUB_WORKFLOW_DESK_DEFEND",
  "KEEPERHUB_WORKFLOW_DESK_DEFEND_PUBLIC_FALLBACK",
  "KEEPERHUB_WORKFLOW_DESK_ROTATE",
  "KEEPERHUB_WORKFLOW_DESK_ROTATE_PUBLIC_FALLBACK",
  "KEEPERHUB_WORKFLOW_DESK_ORACLE_ARB",
  "KEEPERHUB_WORKFLOW_DESK_ORACLE_ARB_PUBLIC_FALLBACK",
  "KEEPERHUB_WORKFLOW_DESK_KILL_SWITCH",
  "KEEPERHUB_WORKFLOW_DESK_KILL_SWITCH_PUBLIC_FALLBACK",
  "KEEPERHUB_WORKFLOW_AAVE_LIQUIDATION",
  "KEEPERHUB_WORKFLOW_COW_TRADE",
  "KEEPERHUB_WORKFLOW_UNISWAP_USDC_WETH_SWAP",
  "KEEPERHUB_WORKFLOW_UNISWAP_POOL_CREATED",
  "KEEPERHUB_WORKFLOW_GAS_VOLUME_BLOCK",
] as const;

/** Workflows required for a minimal material-write path. Missing → FAIL. */
const REQUIRED_WORKFLOW_ENV_KEYS = [
  "KEEPERHUB_WORKFLOW_PUBLISH_ALERT",
  "KEEPERHUB_WORKFLOW_PUBLISH_DIGEST",
  "KEEPERHUB_WORKFLOW_TRANSFER",
] as const;

function loadEnvFile() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx <= 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

function normalizeBaseUrl(apiBaseUrl: string): string {
  return apiBaseUrl.replace(/\/+$/, "");
}

function mark(status: CheckStatus): string {
  switch (status) {
    case "PASS":
      return "[✓]";
    case "FAIL":
      return "[✗]";
    case "WARN":
      return "[!]";
    case "SKIP":
      return "[–]";
  }
}

function printCheck(result: CheckResult) {
  console.log(`${mark(result.status)} ${result.name}: ${result.detail}`);
}

async function fetchJson(
  url: string,
  options: {
    apiKey?: string;
    timeoutMs?: number;
    method?: string;
  } = {},
): Promise<{ ok: boolean; status: number; body: unknown; error?: string }> {
  const timeoutMs = options.timeoutMs ?? 12_000;
  const headers = new Headers({ Accept: "application/json" });
  const key = options.apiKey?.trim();
  if (key) {
    headers.set("Authorization", `Bearer ${key}`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: options.method ?? "GET",
      headers,
      signal: controller.signal,
    });
    let body: unknown = null;
    const text = await res.text();
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    return { ok: res.ok, status: res.status, body };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.name === "AbortError"
          ? `timed out after ${timeoutMs}ms`
          : error.message
        : String(error);
    return { ok: false, status: 0, body: null, error: message };
  } finally {
    clearTimeout(timer);
  }
}

function readWorkflowVersionMeta(body: unknown): {
  name: string | null;
  enabled: boolean | null;
  listingVersion: number | null;
  updatedAt: string | null;
  deletedAt: string | null;
} {
  const rec = asRecord(body);
  if (!rec) {
    return {
      name: null,
      enabled: null,
      listingVersion: null,
      updatedAt: null,
      deletedAt: null,
    };
  }
  return {
    name: typeof rec.name === "string" ? rec.name : null,
    enabled: typeof rec.enabled === "boolean" ? rec.enabled : null,
    listingVersion:
      typeof rec.listingVersion === "number" && Number.isFinite(rec.listingVersion)
        ? rec.listingVersion
        : typeof rec.listing_version === "number" &&
            Number.isFinite(rec.listing_version)
          ? rec.listing_version
          : null,
    updatedAt:
      typeof rec.updatedAt === "string"
        ? rec.updatedAt
        : typeof rec.updated_at === "string"
          ? rec.updated_at
          : null,
    deletedAt:
      typeof rec.deletedAt === "string"
        ? rec.deletedAt
        : typeof rec.deleted_at === "string"
          ? rec.deleted_at
          : null,
  };
}

async function checkHealth(
  apiBaseUrl: string,
  apiKey: string,
): Promise<CheckResult> {
  const base = normalizeBaseUrl(apiBaseUrl);
  const res = await fetchJson(`${base}/api/health`, { apiKey, timeoutMs: 10_000 });
  if (!res.ok) {
    return {
      name: "KeeperHub health",
      status: "FAIL",
      detail: res.error
        ? `GET /api/health failed: ${res.error}`
        : `GET /api/health returned HTTP ${res.status}`,
    };
  }
  const rec = asRecord(res.body);
  const status = typeof rec?.status === "string" ? rec.status : null;
  if (status !== "ok") {
    return {
      name: "KeeperHub health",
      status: "FAIL",
      detail: `GET /api/health body status=${JSON.stringify(status)} (expected "ok")`,
    };
  }
  const ts = typeof rec?.timestamp === "string" ? rec.timestamp : "n/a";
  return {
    name: "KeeperHub health",
    status: "PASS",
    detail: `status=ok timestamp=${ts}`,
  };
}

async function checkPrivateRouting(
  apiBaseUrl: string,
  apiKey: string,
  privatePolicyEnabled: boolean,
  strictPrivate: boolean,
): Promise<CheckResult> {
  const result = await fetchKeeperHubPrivateMempoolCapability({
    apiBaseUrl,
    apiKey: apiKey || undefined,
    chainId: PRIVATE_ROUTING_CHAIN_ID,
    timeoutMs: 10_000,
  });

  if (!result.ok) {
    return {
      name: "Private routing capability (Sepolia)",
      status: privatePolicyEnabled ? "FAIL" : "WARN",
      detail: `Could not verify chain ${PRIVATE_ROUTING_CHAIN_ID}: ${result.reason}`,
    };
  }

  const chainLabel = result.chainName
    ? `${result.chainName} (${result.chainId})`
    : `chain ${result.chainId}`;
  const capable = result.usePrivateMempoolRpc === true;

  if (privatePolicyEnabled && !capable) {
    return {
      name: "Private routing capability (Sepolia)",
      status: "FAIL",
      detail:
        `${chainLabel} reports usePrivateMempoolRpc=false while desk/registry private policy is ON ` +
        `(strict=${strictPrivate}). ${PRIVATE_ROUTING_PRODUCT_DESCRIPTION} ` +
        `Writes will fall back to public mempool until KH CHAIN_RPC_CONFIG enables private RPC.`,
    };
  }

  if (!capable) {
    return {
      name: "Private routing capability (Sepolia)",
      status: "WARN",
      detail:
        `${chainLabel} usePrivateMempoolRpc=false (private policy off — OK for public-only mode)`,
    };
  }

  return {
    name: "Private routing capability (Sepolia)",
    status: "PASS",
    detail:
      `${chainLabel} usePrivateMempoolRpc=true · policy=${privatePolicyEnabled ? "ON" : "OFF"} · strict=${strictPrivate}`,
  };
}

interface WorkflowResolution {
  envKey: string;
  workflowId: string;
  required: boolean;
  status: CheckStatus;
  detail: string;
  listingVersion: number | null;
  historyVersion: number | null;
  historyContentHash: string | null;
  liveContentHash: string | null;
}

function emptyResolution(
  partial: Omit<
    WorkflowResolution,
    "listingVersion" | "historyVersion" | "historyContentHash" | "liveContentHash"
  > &
    Partial<
      Pick<
        WorkflowResolution,
        | "listingVersion"
        | "historyVersion"
        | "historyContentHash"
        | "liveContentHash"
      >
    >,
): WorkflowResolution {
  return {
    listingVersion: null,
    historyVersion: null,
    historyContentHash: null,
    liveContentHash: null,
    ...partial,
  };
}

async function resolveWorkflow(
  apiBaseUrl: string,
  apiKey: string,
  envKey: string,
  workflowId: string,
  required: boolean,
): Promise<WorkflowResolution> {
  const base = normalizeBaseUrl(apiBaseUrl);
  const wfRes = await fetchJson(
    `${base}/api/workflows/${encodeURIComponent(workflowId)}`,
    { apiKey, timeoutMs: 12_000 },
  );

  if (!wfRes.ok) {
    const reason = wfRes.error
      ? wfRes.error
      : `HTTP ${wfRes.status}${
          asRecord(wfRes.body)?.error
            ? ` — ${String(asRecord(wfRes.body)!.error)}`
            : ""
        }`;
    return emptyResolution({
      envKey,
      workflowId,
      required,
      status: "FAIL",
      detail: `GET /api/workflows/${workflowId} failed: ${reason}`,
    });
  }

  const meta = readWorkflowVersionMeta(wfRes.body);
  const liveContentHash = readLiveWorkflowContentHash(wfRes.body);

  if (meta.deletedAt) {
    return emptyResolution({
      envKey,
      workflowId,
      required,
      status: "FAIL",
      detail: `workflow soft-deleted at ${meta.deletedAt}`,
      listingVersion: meta.listingVersion,
      liveContentHash,
    });
  }

  // Disabled workflows resolve but cannot execute — treat as unhealthy.
  if (meta.enabled === false) {
    return emptyResolution({
      envKey,
      workflowId,
      required,
      status: "FAIL",
      detail: `workflow disabled (enabled=false)${
        meta.name ? ` name="${meta.name}"` : ""
      }${
        meta.listingVersion != null
          ? ` listingVersion=${meta.listingVersion}`
          : ""
      }`,
      listingVersion: meta.listingVersion,
      liveContentHash,
    });
  }

  // History is org-scoped; failure here does not fail the resolve itself.
  let historyVersion: number | null = null;
  let historyContentHash: string | null = null;
  const histRes = await fetchJson(
    `${base}/api/workflows/${encodeURIComponent(workflowId)}/history?pageSize=5`,
    { apiKey, timeoutMs: 10_000 },
  );
  if (histRes.ok) {
    const histMeta = readHistoryLatestMeta(histRes.body);
    historyVersion = histMeta.version;
    historyContentHash = histMeta.contentHash;
  }

  const parts = [
    meta.name ? `name="${meta.name}"` : null,
    meta.enabled === null ? null : `enabled=${meta.enabled}`,
    meta.listingVersion != null ? `listingVersion=${meta.listingVersion}` : null,
    historyVersion != null ? `historyVersion=${historyVersion}` : null,
    liveContentHash ? `contentHash=${liveContentHash.slice(0, 12)}…` : null,
    meta.updatedAt ? `updatedAt=${meta.updatedAt}` : null,
  ].filter(Boolean);

  return {
    envKey,
    workflowId,
    required,
    status: "PASS",
    detail: parts.join(" · ") || "resolved",
    listingVersion: meta.listingVersion,
    historyVersion,
    historyContentHash,
    liveContentHash,
  };
}

async function checkWorkflowIds(
  apiBaseUrl: string,
  apiKey: string,
): Promise<{ results: CheckResult[]; resolutions: WorkflowResolution[] }> {
  const results: CheckResult[] = [];
  const resolutions: WorkflowResolution[] = [];

  if (!apiKey.trim()) {
    results.push({
      name: "Workflow IDs",
      status: "FAIL",
      detail: "KEEPERHUB_API_KEY missing — cannot resolve workflow IDs against KeeperHub",
    });
    return { results, resolutions };
  }

  const configured: Array<{ envKey: string; workflowId: string; required: boolean }> =
    [];
  const missingRequired: string[] = [];
  const missingOptional: string[] = [];

  for (const envKey of WORKFLOW_ENV_KEYS) {
    const raw = process.env[envKey]?.trim() ?? "";
    const required = (REQUIRED_WORKFLOW_ENV_KEYS as readonly string[]).includes(
      envKey,
    );
    if (!raw) {
      if (required) missingRequired.push(envKey);
      else missingOptional.push(envKey);
      continue;
    }
    configured.push({ envKey, workflowId: raw, required });
  }

  if (missingRequired.length > 0) {
    results.push({
      name: "Required workflow env",
      status: "FAIL",
      detail: `Missing: ${missingRequired.join(", ")}`,
    });
  } else {
    results.push({
      name: "Required workflow env",
      status: "PASS",
      detail: `${REQUIRED_WORKFLOW_ENV_KEYS.length} core IDs present in env`,
    });
  }

  if (missingOptional.length > 0) {
    results.push({
      name: "Optional workflow env",
      status: "WARN",
      detail: `${missingOptional.length} unset (feature paths will fail hard when invoked): ${missingOptional.slice(0, 6).join(", ")}${missingOptional.length > 6 ? "…" : ""}`,
    });
  } else {
    results.push({
      name: "Optional workflow env",
      status: "PASS",
      detail: "All known KEEPERHUB_WORKFLOW_* keys set",
    });
  }

  if (configured.length === 0) {
    results.push({
      name: "Workflow ID resolution",
      status: "FAIL",
      detail: "No KEEPERHUB_WORKFLOW_* IDs configured to resolve",
    });
    return { results, resolutions };
  }

  // Resolve sequentially to stay under KH rate limits.
  let passCount = 0;
  let failCount = 0;
  for (const entry of configured) {
    const resolution = await resolveWorkflow(
      apiBaseUrl,
      apiKey,
      entry.envKey,
      entry.workflowId,
      entry.required,
    );
    resolutions.push(resolution);
    if (resolution.status === "PASS") passCount += 1;
    else failCount += 1;
    results.push({
      name: `Workflow ${entry.envKey.replace("KEEPERHUB_WORKFLOW_", "")}`,
      status: resolution.status,
      detail: `${entry.workflowId} — ${resolution.detail}`,
    });
  }

  results.push({
    name: "Workflow ID resolution summary",
    status: failCount > 0 ? "FAIL" : "PASS",
    detail: `${passCount} resolved, ${failCount} failed of ${configured.length} configured`,
  });

  return { results, resolutions };
}

function checkWorkflowVersions(resolutions: WorkflowResolution[]): CheckResult[] {
  const results: CheckResult[] = [];
  const resolved = resolutions.filter((r) => r.status === "PASS");

  if (resolved.length === 0) {
    results.push({
      name: "Workflow versions",
      status: "SKIP",
      detail:
        "No successfully resolved workflows to compare against checked-in JSON",
    });
    return results;
  }

  const workflowsDir = resolveWorkflowsKeeperhubDir();
  if (!workflowsDir) {
    results.push({
      name: "Workflow versions",
      status: "WARN",
      detail:
        "workflows/keeperhub/ not found from cwd — cannot compare live versions to checked-in JSON",
    });
    return results;
  }

  let matchCount = 0;
  let driftCount = 0;
  let unknownCount = 0;
  let failCount = 0;
  const perWorkflow: CheckResult[] = [];

  for (const r of resolved) {
    const checkedIn = loadCheckedInWorkflow(r.envKey, workflowsDir);
    const drift = assessWorkflowDrift({
      envKey: r.envKey,
      required: r.required,
      listingVersion: r.listingVersion,
      historyVersion: r.historyVersion,
      historyContentHash: r.historyContentHash,
      liveContentHash: r.liveContentHash,
      checkedIn,
    });

    if (drift.status === "match") matchCount += 1;
    else if (drift.status === "drift") driftCount += 1;
    else unknownCount += 1;
    if (drift.checkStatus === "FAIL") failCount += 1;

    perWorkflow.push({
      name: `  drift ${r.envKey.replace("KEEPERHUB_WORKFLOW_", "")}`,
      status: drift.checkStatus,
      detail: `${r.workflowId} — ${drift.detail}`,
    });
  }

  const summaryStatus: CheckStatus =
    failCount > 0 ? "FAIL" : driftCount > 0 || unknownCount > 0 ? "WARN" : "PASS";

  results.push({
    name: "Workflow versions",
    status: summaryStatus,
    detail:
      `${resolved.length} workflow(s) vs ${workflowsDir}: ` +
      `${matchCount} match, ${driftCount} drift, ${unknownCount} unknown` +
      (failCount > 0 ? ` (${failCount} required FAIL)` : ""),
  });

  // Surface all drift/unknown first, then a sample of matches (cap noise).
  const notable = perWorkflow.filter((c) => c.status !== "PASS");
  const matches = perWorkflow.filter((c) => c.status === "PASS");
  for (const c of notable) results.push(c);
  for (const c of matches.slice(0, 8)) results.push(c);
  if (matches.length > 8) {
    results.push({
      name: "  drift …",
      status: "PASS",
      detail: `+${matches.length - 8} more matching (omitted)`,
    });
  }

  return results;
}

async function checkMcp(
  apiBaseUrl: string,
  apiKey: string,
  mcpEnabled: boolean,
  explicitMcpUrl: string | undefined,
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const mcpUrl = resolveKeeperHubMcpUrl(apiBaseUrl, explicitMcpUrl);
  const ready = isKeeperHubMcpConfigured({
    keeperhubApiBaseUrl: apiBaseUrl,
    keeperhubApiKey: apiKey,
    keeperhubMcpEnabled: mcpEnabled,
    keeperhubMcpUrl: explicitMcpUrl,
  });

  if (!ready) {
    const reasons: string[] = [];
    if (!mcpEnabled) reasons.push("KEEPERHUB_MCP_ENABLED=false");
    if (!apiKey.trim()) reasons.push("KEEPERHUB_API_KEY missing");
    else if (!apiKey.startsWith("kh_")) reasons.push("KEEPERHUB_API_KEY does not start with kh_");
    if (!apiBaseUrl.trim()) reasons.push("KEEPERHUB_API_BASE_URL missing");
    results.push({
      name: "MCP tools",
      status: "SKIP",
      detail: `MCP not configured (${reasons.join("; ") || "unknown"}). REST workflow execute remains the fallback path.`,
    });
    return results;
  }

  try {
    const toolNames = await withKeeperHubMcpClient(
      {
        mcpUrl,
        apiKey,
        clientName: "chronicleai-stack-smoke",
        requestTimeoutMs: 15_000,
      },
      async (client) => {
        const tools = await client.listServerTools();
        return tools.map((t) => t.name);
      },
    );

    results.push({
      name: "MCP connection",
      status: "PASS",
      detail: `Connected to ${mcpUrl} · ${toolNames.length} tool(s) listed`,
    });

    const discovered = new Set(toolNames);
    const missing = EXPECTED_MCP_TOOLS.filter((name) => !discovered.has(name));
    const present = EXPECTED_MCP_TOOLS.filter((name) => discovered.has(name));

    if (missing.length > 0) {
      results.push({
        name: "MCP expected tools",
        status: "FAIL",
        detail: `Missing required tools: ${missing.join(", ")}. Present: ${present.join(", ") || "(none)"}. Discovered: ${toolNames.join(", ") || "(none)"}`,
      });
    } else {
      results.push({
        name: "MCP expected tools",
        status: "PASS",
        detail: `All ${EXPECTED_MCP_TOOLS.length} required tools present: ${EXPECTED_MCP_TOOLS.join(", ")}`,
      });
    }

    const extras = toolNames.filter(
      (n) => !(EXPECTED_MCP_TOOLS as readonly string[]).includes(n),
    );
    if (extras.length > 0) {
      results.push({
        name: "MCP additional tools",
        status: "PASS",
        detail: extras.join(", "),
      });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push({
      name: "MCP tools",
      status: "FAIL",
      detail: `Connection/listTools failed against ${mcpUrl}: ${msg}`,
    });
  }

  return results;
}

async function runStackSmokeTest(): Promise<number> {
  loadEnvFile();
  console.log("==================================================");
  console.log("       CHRONICLE AI — KEEPERHUB STACK SMOKE TEST  ");
  console.log("==================================================\n");

  const env = process.env;
  const apiKey = env.KEEPERHUB_API_KEY || "";
  const apiBaseUrl = env.KEEPERHUB_API_BASE_URL || "https://app.keeperhub.com";
  const mcpEnabled = env.KEEPERHUB_MCP_ENABLED !== "false";
  const explicitMcpUrl = env.KEEPERHUB_MCP_URL;
  const mcpUrl = resolveKeeperHubMcpUrl(apiBaseUrl, explicitMcpUrl);

  const deskPrivateMempool = env.DESK_USE_PRIVATE_MEMPOOL !== "false";
  const registryPrivateMempool = env.REGISTRY_USE_PRIVATE_MEMPOOL !== "false";
  const strictPrivate = env.DESK_PRIVATE_MEMPOOL_STRICT !== "false";
  const privatePolicyEnabled = deskPrivateMempool || registryPrivateMempool;

  console.log("0. ENVIRONMENT (config only — not a pass/fail claim)");
  console.log("--------------------------------------------------");
  console.log(`• KeeperHub API Base URL : ${apiBaseUrl}`);
  console.log(
    `• API Key Configured     : ${
      apiKey ? `YES (${apiKey.slice(0, 5)}…, kh_=${apiKey.startsWith("kh_")})` : "NO"
    }`,
  );
  console.log(`• MCP Enabled            : ${mcpEnabled}`);
  console.log(`• Resolved MCP URL       : ${mcpUrl}`);
  console.log(
    `• Desk Private Mempool   : ${deskPrivateMempool} (Strict: ${strictPrivate})`,
  );
  console.log(`• Registry Private       : ${registryPrivateMempool}`);
  console.log(
    `• Private policy active  : ${privatePolicyEnabled} (capability checked live below)`,
  );
  console.log("--------------------------------------------------\n");

  const all: CheckResult[] = [];

  console.log("1. KEEPERHUB HEALTH");
  console.log("--------------------------------------------------");
  const health = await checkHealth(apiBaseUrl, apiKey);
  all.push(health);
  printCheck(health);
  console.log("");

  console.log("2. PRIVATE ROUTING CAPABILITY (SEPOLIA)");
  console.log("--------------------------------------------------");
  const routing = await checkPrivateRouting(
    apiBaseUrl,
    apiKey,
    privatePolicyEnabled,
    strictPrivate,
  );
  all.push(routing);
  printCheck(routing);
  console.log("");

  console.log("3. WORKFLOW IDS");
  console.log("--------------------------------------------------");
  const { results: wfResults, resolutions } = await checkWorkflowIds(
    apiBaseUrl,
    apiKey,
  );
  for (const r of wfResults) {
    all.push(r);
    printCheck(r);
  }
  console.log("");

  console.log("4. WORKFLOW VERSIONS");
  console.log("--------------------------------------------------");
  const versionResults = checkWorkflowVersions(resolutions);
  for (const r of versionResults) {
    all.push(r);
    printCheck(r);
  }
  console.log("");

  console.log("5. MCP TOOLS");
  console.log("--------------------------------------------------");
  const mcpResults = await checkMcp(
    apiBaseUrl,
    apiKey,
    mcpEnabled,
    explicitMcpUrl,
  );
  for (const r of mcpResults) {
    all.push(r);
    printCheck(r);
  }
  console.log("");

  const pass = all.filter((r) => r.status === "PASS").length;
  const fail = all.filter((r) => r.status === "FAIL").length;
  const warn = all.filter((r) => r.status === "WARN").length;
  const skip = all.filter((r) => r.status === "SKIP").length;

  console.log("==================================================");
  console.log("       KEEPERHUB STACK SMOKE SUMMARY              ");
  console.log("==================================================");
  console.log(
    ` PASS=${pass}  FAIL=${fail}  WARN=${warn}  SKIP=${skip}  total=${all.length}`,
  );
  if (fail > 0) {
    console.log(" Failed checks:");
    for (const r of all.filter((c) => c.status === "FAIL")) {
      console.log(`  • ${r.name}: ${r.detail}`);
    }
  }
  console.log("==================================================\n");

  return fail > 0 ? 1 : 0;
}

runStackSmokeTest()
  .then((code) => {
    process.exit(code);
  })
  .catch((err) => {
    console.error("Fatal error running stack smoke test:", err);
    process.exit(1);
  });
