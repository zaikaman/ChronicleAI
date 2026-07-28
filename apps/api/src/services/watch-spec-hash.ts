/**
 * Resolve a real watchSpecHash for sponsored monitors.
 *
 * Never fabricates placeholder hashes (e.g. 0xccc…). Prefer an explicit
 * bytes32 hash; otherwise derive one deterministically from the watchSpec object.
 */

import { ethers } from "ethers";

const BYTES32_HEX = /^0x[0-9a-fA-F]{64}$/;

export interface SponsoredMonitorContentPrivate {
  targetContract?: string;
  watchSpecHash?: string;
  /** Monitoring specification used to derive watchSpecHash when hash is omitted. */
  watchSpec?: Record<string, unknown>;
}

export function parseSponsoredMonitorContentPrivate(
  raw: unknown,
): SponsoredMonitorContentPrivate {
  if (raw === null || raw === undefined) {
    return {};
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Sponsored monitor content_private must be a JSON object");
  }
  return raw as SponsoredMonitorContentPrivate;
}

/**
 * Resolve target contract from content_private (top-level or nested watchSpec).
 */
export function resolveTargetContract(content: SponsoredMonitorContentPrivate): string {
  const fromSpec =
    content.watchSpec && typeof content.watchSpec.targetContract === "string"
      ? content.watchSpec.targetContract
      : undefined;
  const candidate = content.targetContract ?? fromSpec;

  if (!candidate || typeof candidate !== "string") {
    throw new Error(
      "Sponsored monitor premium item is missing targetContract in content_private",
    );
  }

  if (!ethers.isAddress(candidate)) {
    throw new Error(
      `Sponsored monitor targetContract is not a valid Ethereum address: ${candidate}`,
    );
  }

  return ethers.getAddress(candidate);
}

/**
 * Resolve watchSpecHash:
 * 1. Use explicit watchSpecHash when it is a valid 0x + 64 hex bytes32
 * 2. Else derive keccak256 of canonical JSON from watchSpec
 * 3. Else reject (no dummy padding)
 */
export function resolveWatchSpecHash(content: SponsoredMonitorContentPrivate): string {
  if (content.watchSpecHash !== undefined && content.watchSpecHash !== null) {
    if (typeof content.watchSpecHash !== "string" || !BYTES32_HEX.test(content.watchSpecHash)) {
      throw new Error(
        "Sponsored monitor watchSpecHash must be a 0x-prefixed 32-byte hex string",
      );
    }
    return content.watchSpecHash.toLowerCase();
  }

  if (content.watchSpec && typeof content.watchSpec === "object" && !Array.isArray(content.watchSpec)) {
    return deriveWatchSpecHash(content.watchSpec);
  }

  throw new Error(
    "Sponsored monitor premium item must include watchSpecHash or watchSpec in content_private",
  );
}

/** Deterministic keccak256 of canonical JSON for a watch specification. */
export function deriveWatchSpecHash(watchSpec: unknown): string {
  const canonical = canonicalizeJson(watchSpec);
  return ethers.keccak256(ethers.toUtf8Bytes(canonical));
}

function canonicalizeJson(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === "object") {
    const input = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(input).sort()) {
      sorted[key] = sortKeysDeep(input[key]);
    }
    return sorted;
  }
  return value;
}
