/**
 * Pure presentation helpers for Alert cards.
 * Kept separate so causal-chain rules can be unit-tested without a DOM harness.
 */

import type { PublicAlertResponse } from "@chronicleai/schemas";

export function isDeskTriggerAlert(alert: PublicAlertResponse): boolean {
  return alert.alertKind === "desk_trigger";
}

/** True when this Alert has a real Signal step (omit for direct capital decisions). */
export function alertHasSignalStep(alert: PublicAlertResponse): boolean {
  if (alert.causalChain?.signal) return true;
  if (alert.signalStatus === "created" || alert.signalStatus === "pending") return true;
  if (alert.signalStatus === "failed" && alert.signalType && alert.signalType !== "capital_tick") {
    return true;
  }
  if (alert.signalType === "capital_tick" && alert.signalStatus === "not_eligible") return false;
  if (
    isDeskTriggerAlert(alert) &&
    alert.signalStatus === "not_eligible" &&
    !alert.causalChain?.signal
  ) {
    return false;
  }
  return Boolean(alert.signalType && alert.signalStatus && alert.signalStatus !== "not_eligible");
}

export function alertKindBadgeLabel(alert: PublicAlertResponse): "Desk trigger" | "Market event" {
  return isDeskTriggerAlert(alert) ? "Desk trigger" : "Market event";
}

export function alertSourceOriginLabel(alert: PublicAlertResponse): string | null {
  if (!isDeskTriggerAlert(alert)) return null;
  return alert.sourceTriggerLabel
    ? `Chronicle Desk · ${alert.sourceTriggerLabel}`
    : "Chronicle Desk";
}

export function alertActionStepLabel(alert: PublicAlertResponse): string {
  if (alert.policyVerdict === "defer" || alert.actionStatus === "deferred") {
    return "Action · Deferred";
  }
  const status = alert.causalChain?.action?.status ?? alert.actionStatus;
  if (!status) return "Action · Not recorded";
  const formatted = status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
  return `Action · ${formatted}`;
}
