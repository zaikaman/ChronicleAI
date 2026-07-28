/**
 * Structured CCTP logs — always prefix with `[cctp]`.
 * Never log full attestation blobs at info.
 */

export type CctpLogLevel = "info" | "warn" | "error" | "debug";

export interface CctpLogFields {
  transferId?: string | undefined;
  status?: string | undefined;
  outcome?: string | undefined;
  mode?: string | undefined;
  amountUsdc?: number | undefined;
  burnTxHash?: string | undefined;
  mintTxHash?: string | undefined;
  approveTxHash?: string | undefined;
  errorClass?: string | undefined;
  reason?: string | undefined;
  inFlightCount?: number | undefined;
  attempt?: number | undefined;
  irisStatus?: string | undefined;
  durationMs?: number | undefined;
  /** Safe short metadata only — no attestation/message bytes. */
  [key: string]: unknown;
}

function sanitize(fields: CctpLogFields): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    // Drop large hex payloads if callers accidentally pass them.
    if (
      (k === "attestation" ||
        k === "message" ||
        k === "message_bytes" ||
        k === "messageBytes") &&
      typeof v === "string" &&
      v.length > 64
    ) {
      out[k] = `[omitted ${v.length} chars]`;
      continue;
    }
    out[k] = v;
  }
  return out;
}

export function cctpLog(
  level: CctpLogLevel,
  event: string,
  fields: CctpLogFields = {},
): void {
  const payload = {
    event,
    ...sanitize(fields),
  };
  const line = `[cctp] ${JSON.stringify(payload)}`;
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else if (level === "debug") {
    if (process.env.CCTP_DEBUG === "true" || process.env.NODE_ENV === "test") {
      // Keep debug quiet outside test/debug unless CCTP_DEBUG=true
      if (process.env.CCTP_DEBUG === "true") console.debug(line);
    }
  } else {
    console.info(line);
  }
}
