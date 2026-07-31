import type { ExecutionLogRow } from "@chronicleai/db";
import {
  extractRoutingFromDetails,
  flashbotsProtectStatusUrl,
  routingBadgeLabel,
  shouldLinkProtectStatus,
} from "./routing-metadata.ts";

/**
 * Deliberate allow-list for execution_logs.details on public Activity APIs.
 * Do not add a key here without confirming that its value is safe for anonymous
 * clients. In particular, workflow metadata, errors, messages, and addresses
 * must remain private even when a writer stores them in JSONB.
 */
const PUBLIC_DETAIL_KEYS = [
  "burnTxHash",
  "burnExplorerUrl",
  "mintTxHash",
  "mintExplorerUrl",
  "explorer_url",
  "registryTxHash",
  "txHash",
  "transactionHash",
  "payoutTxHash",
  "contentHash",
  "sourceEventHash",
  "phase",
  "amountUsdc",
  "mode",
  "status",
  "execution_audit_version",
  "execution_audit_summary",
  "keeper_hub_run_id",
  "preflight_status",
  "submit_at",
  "outcome_status",
  "gas_used",
  "gas_used_wei",
  "tx_hashes",
  "logs_node_count",
  "kh_simulate_status",
  "routing",
  "routingStrict",
  "routingProvider",
  "chainId",
  "routingRequested",
  "routingApplied",
  "gasSponsorshipRequested",
  "gasSponsorshipApplied",
] as const;

type PublicActivityDetails = Record<string, unknown>;

function isPublicDetailValue(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function serializePublicDetails(raw: unknown): PublicActivityDetails | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;

  const source = raw as Record<string, unknown>;
  const details: PublicActivityDetails = {};
  for (const key of PUBLIC_DETAIL_KEYS) {
    const value = source[key];
    if (value !== undefined && isPublicDetailValue(value)) details[key] = value;
  }
  return Object.keys(details).length > 0 ? details : null;
}

/** Serialize one execution log for anonymous/public Activity clients. */
export function serializePublicActivityLog(log: ExecutionLogRow): Record<string, unknown> {
  const rawDetails =
    log.details && typeof log.details === "object" && !Array.isArray(log.details)
      ? (log.details as Record<string, unknown>)
      : null;
  const routingMeta = extractRoutingFromDetails(rawDetails);
  const details = serializePublicDetails(log.details);
  const entry: Record<string, unknown> = {
    id: log.id,
    actionType: log.action_type,
    entityType: log.entity_type,
    entityId: log.entity_id,
    status: log.status,
    message: log.message,
    details,
    createdAt: log.created_at,
  };

  if (routingMeta) {
    entry.routing = routingMeta.routing;
    entry.routingStrict = routingMeta.routingStrict;
    entry.routingProvider = routingMeta.routingProvider;
    entry.routingRequested = routingMeta.routingRequested;
    entry.routingApplied = routingMeta.routingApplied;
    entry.routingLabel = routingBadgeLabel(routingMeta);
  }

  const txHash =
    typeof rawDetails?.txHash === "string"
      ? rawDetails.txHash
      : typeof rawDetails?.transactionHash === "string"
        ? rawDetails.transactionHash
        : null;
  if (txHash && shouldLinkProtectStatus(routingMeta)) {
    const protectStatusUrl = flashbotsProtectStatusUrl(txHash, routingMeta?.chainId);
    if (protectStatusUrl) entry.protectStatusUrl = protectStatusUrl;
  }

  return entry;
}
