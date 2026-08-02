import type { PublicAlertResponse } from "@chronicleai/schemas";

/** Public UI surfaces only show alerts that are no longer in a pre-publication state. */
export function isAlertVisibleInPublicUi(alert: PublicAlertResponse): boolean {
  return alert.deliveryStatus !== "draft" && alert.deliveryStatus !== "queued";
}
