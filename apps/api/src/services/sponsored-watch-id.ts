// Robust decoding of on-chain sponsored watch ids (uint256).
// Never invents a watch id: missing/invalid input returns undefined or throws.

import {
  decodeEventLog,
  type Hex,
  type Log,
  parseAbiItem,
  toEventSelector,
} from "viem";

/** SponsoredWatchCreated(uint256 indexed watchId, address indexed targetContract, ...) */
export const SPONSORED_WATCH_CREATED_EVENT =
  "event SponsoredWatchCreated(uint256 indexed watchId, address indexed targetContract, bytes32 watchSpecHash, uint64 startsAt, uint64 endsAt)";

const SPONSORED_WATCH_CREATED_ABI_ITEM = parseAbiItem(SPONSORED_WATCH_CREATED_EVENT);
const SPONSORED_WATCH_CREATED_TOPIC0 = toEventSelector(SPONSORED_WATCH_CREATED_ABI_ITEM);

/**
 * Parse a uint256 watch id from common KeeperHub / RPC return shapes.
 * Accepts number, bigint, decimal string, or 0x-hex. Returns undefined if invalid.
 * Note: on-chain watchId may legitimately be 0 (first id) — callers must not
 * treat 0 as "missing" after a successful parse.
 */
export function parseOnChainWatchId(value: unknown): number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
      return undefined;
    }
    // Stay within safe integer range for JS number storage / JSON.
    if (value > Number.MAX_SAFE_INTEGER) {
      return undefined;
    }
    return value;
  }

  if (typeof value === "bigint") {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
      return undefined;
    }
    return Number(value);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;

    // Decimal digits only
    if (/^\d+$/.test(trimmed)) {
      const asNum = Number(trimmed);
      if (!Number.isSafeInteger(asNum) || asNum < 0) return undefined;
      return asNum;
    }

    // Hex (with or without 0x)
    if (/^0x[0-9a-fA-F]+$/.test(trimmed) || /^[0-9a-fA-F]+$/.test(trimmed)) {
      try {
        const asBig = BigInt(trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`);
        if (asBig < 0n || asBig > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
        return Number(asBig);
      } catch {
        return undefined;
      }
    }

    // Never strip non-digits and re-parse — that can map garbage → wrong id.
    return undefined;
  }

  if (Array.isArray(value) && value.length > 0) {
    return parseOnChainWatchId(value[0]);
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if ("watchId" in record) {
      return parseOnChainWatchId(record.watchId);
    }
    if ("result" in record) {
      return parseOnChainWatchId(record.result);
    }
    // Result / named args / tuple index
    if ("0" in record) {
      return parseOnChainWatchId(record["0"]);
    }
  }

  return undefined;
}

/**
 * Require a valid on-chain watch id or throw with context (no silent zero default).
 */
export function requireOnChainWatchId(value: unknown, context: string): number {
  const id = parseOnChainWatchId(value);
  if (id === undefined) {
    throw new Error(
      `Could not decode on-chain watchId (${context}): received ${summarizeValue(value)}`,
    );
  }
  return id;
}

export interface ReceiptLogLike {
  topics?: readonly string[] | null;
  data?: string | null;
}

/**
 * Decode SponsoredWatchCreated.watchId from transaction logs.
 * Throws if the event is missing or the id cannot be parsed.
 */
export function decodeSponsoredWatchIdFromLogs(
  logs: readonly ReceiptLogLike[],
  context = "SponsoredWatchCreated logs",
): number {
  for (const log of logs) {
    const topics = (log.topics ?? []) as Hex[];
    if (topics.length > 0 && topics[0] !== SPONSORED_WATCH_CREATED_TOPIC0) {
      // Fast path: skip unrelated logs
      continue;
    }
    try {
      const parsed = decodeEventLog({
        abi: [SPONSORED_WATCH_CREATED_ABI_ITEM],
        data: (log.data ?? "0x") as Hex,
        topics: topics as Log["topics"],
      });
      if (parsed.eventName === "SponsoredWatchCreated") {
        const args = parsed.args as {
          watchId?: bigint;
          0?: bigint;
        };
        const raw =
          args.watchId ?? args[0] ?? (topics.length > 1 ? topics[1] : undefined);
        return requireOnChainWatchId(raw, context);
      }
    } catch {
      // not our event
    }
  }

  throw new Error(
    `Could not decode on-chain watchId (${context}): SponsoredWatchCreated event not found in receipt logs`,
  );
}

function summarizeValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") {
    return value.length > 80 ? `${JSON.stringify(value.slice(0, 80))}…` : JSON.stringify(value);
  }
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value).slice(0, 120);
  } catch {
    return Object.prototype.toString.call(value);
  }
}
