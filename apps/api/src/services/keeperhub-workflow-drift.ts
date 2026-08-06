/**
 * KeeperHub workflow drift detection helpers.
 *
 * Compares live workflow version/content metadata against checked-in
 * `workflows/keeperhub/*.workflow.json` definitions used by Chronicle.
 *
 * Content hashing mirrors KeeperHub's `hashWorkflowDefinition` so live
 * `contentHash` values (and node/edge fingerprints) are comparable to repo files.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** Env key → checked-in workflow JSON filename under workflows/keeperhub/. */
export const WORKFLOW_FILE_BY_ENV: Readonly<Record<string, string>> = {
  KEEPERHUB_WORKFLOW_PUBLISH_ALERT: "chronicle-publish-alert.workflow.json",
  KEEPERHUB_WORKFLOW_PUBLISH_DIGEST: "chronicle-publish-digest.workflow.json",
  KEEPERHUB_WORKFLOW_CREATE_SPONSORED_WATCH:
    "chronicle-create-sponsored-watch.workflow.json",
  KEEPERHUB_WORKFLOW_PUBLISH_SPONSORED_REPORT:
    "chronicle-publish-sponsored-report.workflow.json",
  KEEPERHUB_WORKFLOW_PUBLISH_PREMIUM_RECEIPT:
    "chronicle-publish-premium-receipt.workflow.json",
  KEEPERHUB_WORKFLOW_RECORD_PAYOUT: "chronicle-record-payout.workflow.json",
  KEEPERHUB_WORKFLOW_PUBLISH_TRADE_TICKET:
    "chronicle-publish-trade-ticket.workflow.json",
  KEEPERHUB_WORKFLOW_RECORD_CAPITAL_MOVE:
    "chronicle-record-capital-move.workflow.json",
  KEEPERHUB_WORKFLOW_RECORD_CAPITAL_MOVE_PUBLIC_FALLBACK:
    "chronicle-record-capital-move-public-fallback.workflow.json",
  KEEPERHUB_WORKFLOW_TRANSFER: "chronicle-revenue-transfer.workflow.json",
  KEEPERHUB_WORKFLOW_DESK_SWEEP: "desk-sweep.workflow.json",
  KEEPERHUB_WORKFLOW_DESK_DEFEND: "desk-defend.workflow.json",
  KEEPERHUB_WORKFLOW_DESK_DEFEND_PUBLIC_FALLBACK:
    "desk-defend-public-fallback.workflow.json",
  KEEPERHUB_WORKFLOW_DESK_ROTATE: "desk-rotate-yield.workflow.json",
  KEEPERHUB_WORKFLOW_DESK_ROTATE_PUBLIC_FALLBACK:
    "desk-rotate-yield-public-fallback.workflow.json",
  KEEPERHUB_WORKFLOW_DESK_ORACLE_ARB: "desk-oracle-arb.workflow.json",
  KEEPERHUB_WORKFLOW_DESK_ORACLE_ARB_PUBLIC_FALLBACK:
    "desk-oracle-arb-public-fallback.workflow.json",
  KEEPERHUB_WORKFLOW_DESK_KILL_SWITCH: "desk-kill-switch.workflow.json",
  KEEPERHUB_WORKFLOW_DESK_KILL_SWITCH_PUBLIC_FALLBACK:
    "desk-kill-switch-public-fallback.workflow.json",
  KEEPERHUB_WORKFLOW_AAVE_LIQUIDATION: "aave-v3-liquidation.workflow.json",
  KEEPERHUB_WORKFLOW_COW_TRADE: "cow-protocol-trade.workflow.json",
  KEEPERHUB_WORKFLOW_UNISWAP_USDC_WETH_SWAP:
    "uniswap-v3-usdc-weth-swap.workflow.json",
  KEEPERHUB_WORKFLOW_UNISWAP_POOL_CREATED:
    "uniswap-v3-pool-created.workflow.json",
  KEEPERHUB_WORKFLOW_GAS_VOLUME_BLOCK: "gas-volume-block-monitor.workflow.json",
};

const NODE_KEYS = ["id", "type", "data"] as const;
const EDGE_KEYS = [
  "id",
  "source",
  "target",
  "sourceHandle",
  "targetHandle",
  "data",
] as const;

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

/**
 * Extract history rows from a KeeperHub history response.
 * Supports:
 *  - paginated `{ items: [...] }` / `{ data: [...] }`
 *  - bare array `[...]`
 */
export function readHistoryItems(body: unknown): unknown[] | null {
  if (Array.isArray(body)) {
    return body;
  }
  const rec = asRecord(body);
  if (!rec) return null;
  if (Array.isArray(rec.items)) return rec.items;
  if (Array.isArray(rec.data)) return rec.data;
  return null;
}

export interface HistoryLatestMeta {
  version: number | null;
  contentHash: string | null;
}

/** Latest (max) version + its contentHash from a history response body. */
export function readHistoryLatestMeta(body: unknown): HistoryLatestMeta {
  const items = readHistoryItems(body);
  if (!items || items.length === 0) {
    return { version: null, contentHash: null };
  }

  let bestVersion: number | null = null;
  let bestHash: string | null = null;
  for (const item of items) {
    const row = asRecord(item);
    if (!row) continue;
    const v = row.version;
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    if (bestVersion == null || v > bestVersion) {
      bestVersion = v;
      const hash =
        typeof row.contentHash === "string"
          ? row.contentHash
          : typeof row.content_hash === "string"
            ? row.content_hash
            : null;
      bestHash = hash && hash.length > 0 ? hash : null;
    }
  }
  return { version: bestVersion, contentHash: bestHash };
}

export function readHistoryLatestVersion(body: unknown): number | null {
  return readHistoryLatestMeta(body).version;
}

function pick(value: unknown, keys: readonly string[]): unknown {
  if (!value || typeof value !== "object") return value;
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  return out;
}

function pickAll(items: unknown, keys: readonly string[]): unknown[] {
  return Array.isArray(items) ? items.map((item) => pick(item, keys)) : [];
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      sorted[key] = canonicalize(source[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * Stable fingerprint of nodes+edges (behavioral fields only).
 * Matches KeeperHub `lib/workflow/content-hash.ts` so live contentHash compares.
 */
export function hashWorkflowDefinition(nodes: unknown, edges: unknown): string {
  const normalized = {
    nodes: pickAll(nodes, NODE_KEYS),
    edges: pickAll(edges, EDGE_KEYS),
  };
  const canonical = JSON.stringify(canonicalize(normalized));
  return createHash("sha256").update(canonical).digest("hex");
}

export interface CheckedInWorkflow {
  envKey: string;
  fileName: string;
  filePath: string;
  /** Export-schema version from the checked-in JSON (`version` field). */
  exportVersion: number;
  name: string | null;
  contentHash: string;
  nodeCount: number;
  edgeCount: number;
}

export function resolveWorkflowsKeeperhubDir(
  cwd: string = process.cwd(),
): string | null {
  const candidates = [
    path.resolve(cwd, "workflows", "keeperhub"),
    path.resolve(cwd, "..", "..", "workflows", "keeperhub"),
    path.resolve(cwd, "..", "workflows", "keeperhub"),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
      return dir;
    }
  }
  return null;
}

export function loadCheckedInWorkflow(
  envKey: string,
  workflowsDir?: string | null,
): CheckedInWorkflow | null {
  const fileName = WORKFLOW_FILE_BY_ENV[envKey];
  if (!fileName) return null;

  const dir = workflowsDir ?? resolveWorkflowsKeeperhubDir();
  if (!dir) return null;

  const filePath = path.join(dir, fileName);
  if (!fs.existsSync(filePath)) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }

  const rec = asRecord(raw);
  if (!rec) return null;

  const exportVersion =
    typeof rec.version === "number" && Number.isFinite(rec.version)
      ? rec.version
      : null;
  if (exportVersion == null) return null;

  const nodes = Array.isArray(rec.nodes) ? rec.nodes : [];
  const edges = Array.isArray(rec.edges) ? rec.edges : [];
  const workflowMeta = asRecord(rec.workflow);
  const name =
    typeof workflowMeta?.name === "string"
      ? workflowMeta.name
      : typeof rec.name === "string"
        ? rec.name
        : null;

  return {
    envKey,
    fileName,
    filePath,
    exportVersion,
    name,
    contentHash: hashWorkflowDefinition(nodes, edges),
    nodeCount: nodes.length,
    edgeCount: edges.length,
  };
}

export type DriftStatus = "match" | "drift" | "unknown";

export interface WorkflowDriftInput {
  envKey: string;
  required: boolean;
  /** Live listingVersion from GET /api/workflows/{id}. */
  listingVersion: number | null;
  /** Live latest history version. */
  historyVersion: number | null;
  /** Live latest history contentHash (when present). */
  historyContentHash: string | null;
  /** Content hash of live nodes/edges from GET /api/workflows/{id}. */
  liveContentHash: string | null;
  /** Checked-in definition; null when file missing or unmapped. */
  checkedIn: CheckedInWorkflow | null;
}

export interface WorkflowDriftResult {
  envKey: string;
  status: DriftStatus;
  /** PASS/WARN/FAIL recommendation for the smoke harness. */
  checkStatus: "PASS" | "WARN" | "FAIL";
  detail: string;
  checkedInVersion: number | null;
  liveVersion: number | null;
  contentMatch: boolean | null;
  versionMatch: boolean | null;
}

/**
 * Detect drift between a live KeeperHub workflow and its checked-in JSON.
 *
 * Content comparison is primary (hash of nodes/edges). Export-schema `version`
 * is reported against live historyVersion when both are present — a mismatch
 * alone is WARN (export version is schema, not edit count), but content
 * mismatch is FAIL for required workflows and WARN for optional.
 */
export function assessWorkflowDrift(input: WorkflowDriftInput): WorkflowDriftResult {
  const liveVersion = input.historyVersion ?? input.listingVersion;
  const shortKey = input.envKey.replace("KEEPERHUB_WORKFLOW_", "");

  if (!input.checkedIn) {
    const mapped = WORKFLOW_FILE_BY_ENV[input.envKey];
    return {
      envKey: input.envKey,
      status: "unknown",
      checkStatus: "WARN",
      detail: mapped
        ? `${shortKey}: checked-in file missing (${mapped}) — cannot assess drift`
        : `${shortKey}: no checked-in workflow mapping — cannot assess drift`,
      checkedInVersion: null,
      liveVersion,
      contentMatch: null,
      versionMatch: null,
    };
  }

  const liveHash =
    input.liveContentHash ??
    (input.historyContentHash && input.historyContentHash.length > 0
      ? input.historyContentHash
      : null);

  const contentMatch =
    liveHash != null ? liveHash === input.checkedIn.contentHash : null;

  // Export-schema version vs live edit/listing version — informative only when
  // both exist. Equal values are common right after import (both 1).
  const versionMatch =
    liveVersion != null ? liveVersion === input.checkedIn.exportVersion : null;

  const versionBits = [
    `checkedIn.version=${input.checkedIn.exportVersion}`,
    liveVersion != null ? `live=${liveVersion}` : "live=n/a",
    input.historyVersion != null
      ? `history=${input.historyVersion}`
      : null,
    input.listingVersion != null
      ? `listing=${input.listingVersion}`
      : null,
  ].filter(Boolean);

  if (contentMatch === true) {
    const versionNote =
      versionMatch === false
        ? ` · version fields differ (${versionBits.join(", ")}) but content matches`
        : versionMatch === true
          ? ` · versions align (${versionBits.join(", ")})`
          : ` · ${versionBits.join(", ")}`;
    return {
      envKey: input.envKey,
      status: "match",
      checkStatus: "PASS",
      detail: `${shortKey}: content matches ${input.checkedIn.fileName}${versionNote}`,
      checkedInVersion: input.checkedIn.exportVersion,
      liveVersion,
      contentMatch: true,
      versionMatch,
    };
  }

  if (contentMatch === false) {
    const checkStatus = input.required ? "FAIL" : "WARN";
    return {
      envKey: input.envKey,
      status: "drift",
      checkStatus,
      detail:
        `${shortKey}: CONTENT DRIFT vs ${input.checkedIn.fileName} ` +
        `(liveHash=${liveHash!.slice(0, 12)}… checkedIn=${input.checkedIn.contentHash.slice(0, 12)}…; ` +
        `${versionBits.join(", ")}) — re-import checked-in JSON or update repo export`,
      checkedInVersion: input.checkedIn.exportVersion,
      liveVersion,
      contentMatch: false,
      versionMatch,
    };
  }

  // No live content hash available — fall back to version-field comparison only.
  if (versionMatch === true) {
    return {
      envKey: input.envKey,
      status: "match",
      checkStatus: "PASS",
      detail:
        `${shortKey}: version fields match checked-in ` +
        `(${versionBits.join(", ")}; content hash unavailable for full drift check)`,
      checkedInVersion: input.checkedIn.exportVersion,
      liveVersion,
      contentMatch: null,
      versionMatch: true,
    };
  }

  if (versionMatch === false) {
    return {
      envKey: input.envKey,
      status: "drift",
      checkStatus: "WARN",
      detail:
        `${shortKey}: version DRIFT vs ${input.checkedIn.fileName} ` +
        `(${versionBits.join(", ")}; content hash unavailable — confirm re-import)`,
      checkedInVersion: input.checkedIn.exportVersion,
      liveVersion,
      contentMatch: null,
      versionMatch: false,
    };
  }

  return {
    envKey: input.envKey,
    status: "unknown",
    checkStatus: "WARN",
    detail:
      `${shortKey}: resolved but neither live content hash nor version available ` +
      `to compare against ${input.checkedIn.fileName}`,
    checkedInVersion: input.checkedIn.exportVersion,
    liveVersion,
    contentMatch: null,
    versionMatch: null,
  };
}

/** Extract nodes/edges content hash from a live GET /api/workflows/{id} body. */
export function readLiveWorkflowContentHash(body: unknown): string | null {
  const rec = asRecord(body);
  if (!rec) return null;
  if (!Array.isArray(rec.nodes)) return null;
  const edges = Array.isArray(rec.edges) ? rec.edges : [];
  return hashWorkflowDefinition(rec.nodes, edges);
}
