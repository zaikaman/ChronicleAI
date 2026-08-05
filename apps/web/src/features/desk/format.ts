import type { DeskTicketLegSummary, DeskTicketNarrative } from "./types.ts";

// Desk display helpers — calm, editorial labels

export function formatUsdc(amount: number | null | undefined, fractionDigits = 2): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) {
    return "—";
  }
  return `${amount.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits,
  })} USDC`;
}

export function formatHealthFactor(hf: number | null | undefined): string {
  if (hf === null || hf === undefined || !Number.isFinite(hf)) {
    return "—";
  }
  // Aave uses a very large number for “no debt”
  if (hf > 100) return "∞";
  return hf.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function humanizeIdentifier(value: string): string {
  return value
    .replace(/[:_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function strategyLabel(strategy: string | null | undefined): string {
  switch (strategy) {
    case "risk_defend":
      return "Risk protection";
    case "yield_rotation":
      return "Yield improvement";
    case "oracle_amm":
      return "Price-gap opportunity";
    default:
      return strategy ? humanizeIdentifier(strategy) : "Desk action";
  }
}

export function protocolLabel(protocol: string): string {
  const normalized = protocol
    .trim()
    .toLowerCase()
    .replace(/[-_:\s]+/g, "");
  if (normalized.includes("uniswap")) return "Uniswap";
  if (normalized.includes("aave")) return "Aave";
  if (normalized.includes("cctp") || normalized.includes("circle")) {
    return "Circle CCTP";
  }
  if (normalized.includes("keeperhub")) return "KeeperHub";
  return humanizeIdentifier(protocol);
}

export function actionLabel(action: string): string {
  const normalized = action
    .trim()
    .toLowerCase()
    .replace(/[-_:\s]+/g, "");
  if (
    normalized.includes("swap") ||
    normalized === "trade" ||
    normalized === "exactinput" ||
    normalized === "usdctoweth" ||
    normalized === "wethtousdc"
  ) {
    return "Swap";
  }
  if (normalized.includes("supply") || normalized === "deposit" || normalized === "lend") {
    return "Supply";
  }
  if (normalized.includes("withdraw") || normalized === "redeem" || normalized === "unstake") {
    return "Withdraw";
  }
  if (normalized.includes("repay")) return "Repay debt";
  if (normalized.includes("borrow")) return "Borrow";
  if (normalized.includes("transfer") || normalized === "send") return "Transfer";
  if (normalized.includes("approve")) return "Approve";
  if (normalized === "wrap") return "Wrap";
  if (normalized === "unwrap") return "Unwrap";
  return humanizeIdentifier(action);
}

export function ticketLegLabel(leg: DeskTicketLegSummary): string {
  const action = actionLabel(leg.action);
  const protocol = protocolLabel(leg.protocol);
  if (leg.tokenIn && leg.tokenOut) {
    return `${action} ${leg.tokenIn} for ${leg.tokenOut} on ${protocol}`;
  }
  if (leg.asset) return `${action} ${leg.asset} on ${protocol}`;
  return `${action} on ${protocol}`;
}

export function ticketLegSummary(legs: DeskTicketLegSummary[]): string | null {
  if (legs.length === 0) return null;
  const firstLeg = legs[0];
  if (!firstLeg) return null;
  const first = ticketLegLabel(firstLeg);
  if (legs.length === 1) return `${first}.`;
  const remaining = legs.length - 1;
  return `${first}; ${remaining} additional step${remaining === 1 ? "" : "s"}.`;
}

export function ticketHeadline(
  ticket: Pick<DeskTicketNarrative, "strategy" | "notionalUsdc">,
): string {
  const amount = ticket.notionalUsdc != null ? formatUsdc(ticket.notionalUsdc) : null;
  switch (ticket.strategy) {
    case "risk_defend":
      return amount
        ? `The desk protected the position with ${amount}`
        : "The desk protected the position";
    case "yield_rotation":
      return `The desk moved ${amount ?? "funds"} toward better yield`;
    case "oracle_amm":
      return amount
        ? `The desk acted on a market price gap with ${amount}`
        : "The desk acted on a market price gap";
    default: {
      const action = ticket.strategy ? strategyLabel(ticket.strategy).toLowerCase() : null;
      if (!action) return "The desk completed a recorded action";
      return amount
        ? `The desk completed a ${action} action with ${amount}`
        : `The desk completed a ${action} action`;
    }
  }
}

type TicketOutcomeInput = Pick<
  DeskTicketNarrative,
  "executionAudit" | "executionAuditSummary" | "fillsCount" | "fillTxHashes"
>;

export type TicketOutcomeStatus =
  | "filled"
  | "failed"
  | "timeout"
  | "skipped"
  | "unknown"
  | "published";

export function ticketOutcomeStatus(ticket: TicketOutcomeInput): TicketOutcomeStatus {
  const recordedStatus = ticket.executionAudit?.stages.outcome.status;
  if (recordedStatus && recordedStatus !== "unknown") return recordedStatus;
  if (ticket.fillsCount > 0 || ticket.fillTxHashes.length > 0) return "filled";

  // Older tickets only expose the generated one-line audit summary.
  const legacySummary = ticket.executionAuditSummary?.toLowerCase() ?? "";
  if (/\bfilled\b/.test(legacySummary)) return "filled";
  if (/\bfailed\b/.test(legacySummary)) return "failed";
  if (/\btimeout\b|\btimed out\b/.test(legacySummary)) return "timeout";
  return "published";
}

export function ticketOutcomeLabel(ticket: TicketOutcomeInput): string {
  switch (ticketOutcomeStatus(ticket)) {
    case "filled":
      return "Completed";
    case "failed":
      return "Not completed";
    case "timeout":
      return "Timed out";
    case "skipped":
      return "Skipped";
    case "unknown":
      return "Outcome unknown";
    default:
      return "Awaiting result";
  }
}

export function ticketOutcomeVariant(
  ticket: TicketOutcomeInput,
): "default" | "success" | "warning" | "error" | "info" {
  switch (ticketOutcomeStatus(ticket)) {
    case "filled":
      return "success";
    case "failed":
      return "error";
    case "timeout":
    case "skipped":
      return "warning";
    case "unknown":
      return "default";
    default:
      return "info";
  }
}

export function ticketExecutionNarrative(ticket: TicketOutcomeInput): string {
  const status = ticketOutcomeStatus(ticket);
  if (status === "filled") {
    const preflight = ticket.executionAudit?.stages.preflight;
    if (preflight?.status === "passed" && preflight.khSimulate?.status === "passed") {
      return "Policy checks passed, then KeeperHub completed the trade.";
    }
    const fills = ticket.fillsCount;
    return fills > 0
      ? `The trade completed with ${fills} recorded fill${fills === 1 ? "" : "s"}.`
      : "The trade completed successfully.";
  }
  if (status === "failed") {
    return ticket.executionAudit?.stages.preflight.status === "failed"
      ? "Policy checks stopped this trade before submission."
      : "The trade did not complete. Open the ticket for the failed step and its proof.";
  }
  if (status === "timeout") {
    return "The trade did not finish before the execution window closed.";
  }
  if (status === "skipped") return "This trade was recorded but skipped before execution.";
  if (status === "unknown") return "The ticket is recorded, but its final outcome is unclear.";
  return "The decision is recorded; this trade has not reported a completed outcome yet.";
}

export function signalTypeLabel(signalType: string | null | undefined): string {
  if (!signalType) return "Unspecified signal";
  return signalType
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function intentStatusVariant(
  status: string,
): "default" | "success" | "warning" | "error" | "info" {
  switch (status) {
    case "filled":
      return "success";
    case "executing":
    case "approved":
    case "proposed":
      return "info";
    case "deferred":
      return "warning";
    case "failed":
    case "cancelled":
      return "error";
    default:
      return "default";
  }
}

export function capitalDirectionLabel(direction: string): string {
  switch (direction) {
    case "topup":
      return "Top-up";
    case "sweep":
      return "Sweep";
    case "emergency_return":
      return "Emergency return";
    default:
      return direction.replace(/_/g, " ");
  }
}

export function humanizeCapitalMoveReason(
  reason: string | null | undefined,
  direction?: string,
): string {
  if (!reason) {
    if (direction === "sweep") return "Automated profit sweep";
    if (direction === "topup") return "Automated desk top-up";
    if (direction === "emergency_return") return "Emergency return to treasury";
    return "Capital movement";
  }

  const normalized = reason.trim().toLowerCase();

  switch (normalized) {
    case "desk_equity_above_max_aum":
      return "Desk balance exceeded ceiling (Automated profit sweep)";
    case "profit_sweep_threshold":
      return "Profit threshold reached (Automated profit sweep)";
    case "desk_below_target_aum":
      return "Desk balance below target (Automated top-up)";
    case "desk_below_min_aum":
      return "Desk balance critically low (Emergency top-up)";
    case "free_usdc_shortfall_no_unwind":
      return "Free liquidity shortfall (Treasury top-up)";
    case "free_usdc_shortfall_unwind":
      return "Free liquidity shortfall (Inventory unwind)";
    case "free_usdc_shortfall_prefer_treasury":
      return "Free liquidity top-up from treasury";
    case "emergency_return":
    case "kill_switch_armed":
      return "Emergency capital return to treasury";
    case "manual_topup":
      return "Manual desk top-up";
    case "manual_sweep":
      return "Manual desk profit sweep";
    case "cctp_rebalance":
      return "Cross-chain revenue rebalance";
    case "policy_sweep":
      return "Automated policy sweep";
    case "policy_topup":
      return "Automated policy top-up";
    default:
      return humanizeIdentifier(reason);
  }
}

export function capitalDirectionVariant(
  direction: string,
): "default" | "success" | "warning" | "error" | "info" {
  switch (direction) {
    case "topup":
      return "info";
    case "sweep":
      return "success";
    case "emergency_return":
      return "error";
    default:
      return "default";
  }
}

export function equityProgress(
  equity: number | null,
  target: number,
  max: number,
): {
  pctOfTarget: number;
  pctOfMax: number;
  band: "below_min" | "near_target" | "above_target" | "at_ceiling" | "unknown";
} {
  if (equity === null || !Number.isFinite(equity) || target <= 0) {
    return { pctOfTarget: 0, pctOfMax: 0, band: "unknown" };
  }
  const pctOfTarget = (equity / target) * 100;
  const pctOfMax = max > 0 ? (equity / max) * 100 : 0;
  let band: "below_min" | "near_target" | "above_target" | "at_ceiling" | "unknown" = "near_target";
  if (equity >= max) band = "at_ceiling";
  else if (equity > target * 1.05) band = "above_target";
  else if (equity < target * 0.8) band = "below_min";
  return { pctOfTarget, pctOfMax, band };
}

/** Extract ticket id from a content URI or absolute path. */
export function ticketIdFromReference(ref: string): string | null {
  try {
    const path = ref.includes("://") ? new URL(ref).pathname : ref;
    const match = path.match(/\/desk\/tickets\/([A-Za-z0-9_-]+)/);
    if (!match?.[1] || match[1] === "pending") return null;
    return match[1];
  } catch {
    return null;
  }
}
