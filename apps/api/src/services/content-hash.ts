/**
 * Deterministic content hashes for Chronicle Registry publish* calls.
 * Matches IDEA: contentHash is a hash of the generated report/alert body.
 */

import { toBytes32Hash } from "./keeperhub-write-client.ts";

/** Canonical alert content payload used for on-chain contentHash. */
export function hashAlertContent(input: {
  title: string;
  summary: string;
  contentUri?: string | undefined;
  alertId?: string | undefined;
}): string {
  const canonical = [
    "v1",
    "alert",
    input.alertId ?? "",
    input.title.trim(),
    input.summary.trim(),
    input.contentUri?.trim() ?? "",
  ].join("\n");
  return toBytes32Hash(canonical);
}

/** Canonical digest content payload used for on-chain contentHash. */
export function hashDigestContent(input: {
  title: string;
  summary: string;
  reportDate: string;
  contentUri?: string | undefined;
  digestId?: string | undefined;
}): string {
  const canonical = [
    "v1",
    "digest",
    input.digestId ?? "",
    input.reportDate,
    input.title.trim(),
    input.summary.trim(),
    input.contentUri?.trim() ?? "",
  ].join("\n");
  return toBytes32Hash(canonical);
}
