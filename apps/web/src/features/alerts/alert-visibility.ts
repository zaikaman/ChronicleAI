import type { PublicAlertResponse } from "@chronicleai/schemas";

/** Public UI surfaces only show alerts that are published and exclude wallet watch alerts. */
export function isAlertVisibleInPublicUi(alert: PublicAlertResponse): boolean {
  if (alert.eventType === "wallet_transfer" || alert.title.startsWith("Wallet watch alert")) {
    return false;
  }
  return alert.deliveryStatus !== "draft" && alert.deliveryStatus !== "queued";
}
