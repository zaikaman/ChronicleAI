/**
 * Resolve a real watchSpecHash for sponsored monitors.
 *
 * Never fabricates placeholder hashes (e.g. 0xccc…). Prefer an explicit
 * bytes32 hash; otherwise derive one deterministically from the watchSpec object.
 */

import { getAddress, isAddress, keccak256, stringToBytes } from "viem";

const BYTES32_HEX = /^0x[0-9a-fA-F]{64}$/;

export interface SponsoredMonitorContentPrivate {
  targetContract?: string;
  watchSpecHash?: string;
  /** Monitoring specification used to derive watchSpecHash when hash is omitted. */
  watchSpec?: Record<string, unknown>;
  /** Optional ISO campaign start (Loop 4 buyer-chosen window). */
  startsAt?: string;
  /** Optional ISO campaign end (Loop 4 buyer-chosen window). */
  endsAt?: string;
  /** Optional duration in days when endsAt is not set at product creation. */
  durationDays?: number;
  /** Optional short-demo duration in hours (takes precedence over durationDays). */
  durationHours?: number;
  /** contract (default) or wallet — wallet watches match Transfer from/to. */
  targetKind?: "contract" | "wallet";
  /** public (default) or private alert delivery. */
  visibility?: "public" | "private";
  /** One-time Telegram binding code (committed in watchSpec, resolved at settle). */
  telegramBindingCode?: string;
}

/** Resolve target kind from content_private (top-level or nested watchSpec). */
export function resolveTargetKind(
  content: SponsoredMonitorContentPrivate,
): "contract" | "wallet" {
  const fromSpec =
    content.watchSpec && typeof content.watchSpec.targetKind === "string"
      ? content.watchSpec.targetKind
      : undefined;
  const raw = content.targetKind ?? fromSpec;
  return raw === "wallet" ? "wallet" : "contract";
}

/** Resolve visibility from content_private (top-level or nested watchSpec). */
export function resolveVisibility(
  content: SponsoredMonitorContentPrivate,
): "public" | "private" {
  const fromSpec =
    content.watchSpec && typeof content.watchSpec.visibility === "string"
      ? content.watchSpec.visibility
      : undefined;
  const raw = content.visibility ?? fromSpec;
  return raw === "private" ? "private" : "public";
}

/** Resolve optional Telegram binding code from content_private. */
export function resolveTelegramBindingCode(
  content: SponsoredMonitorContentPrivate,
): string | undefined {
  const fromSpec =
    content.watchSpec && typeof content.watchSpec.telegramBindingCode === "string"
      ? content.watchSpec.telegramBindingCode
      : undefined;
  const raw = content.telegramBindingCode ?? fromSpec;
  if (!raw || typeof raw !== "string") return undefined;
  const trimmed = raw.trim().toUpperCase();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Resolve campaign window from content_private.
 * Prefer explicit startsAt/endsAt; else durationDays from now; else defaultDays.
 */
export function resolveCampaignWindowFromContent(
  content: SponsoredMonitorContentPrivate,
  options: { defaultDurationDays: number; now?: Date },
): { startsAt: string; endsAt: string } {
  const now = options.now ?? new Date();
  const startsAt = content.startsAt
    ? new Date(content.startsAt)
    : content.watchSpec && typeof content.watchSpec.startsAt === "string"
      ? new Date(content.watchSpec.startsAt)
      : now;

  if (Number.isNaN(startsAt.getTime())) {
    throw new Error("Sponsored monitor startsAt is not a valid ISO timestamp");
  }

  const endsRaw =
    content.endsAt ??
    (content.watchSpec && typeof content.watchSpec.endsAt === "string"
      ? content.watchSpec.endsAt
      : undefined);

  if (endsRaw) {
    const endsAt = new Date(endsRaw);
    if (Number.isNaN(endsAt.getTime())) {
      throw new Error("Sponsored monitor endsAt is not a valid ISO timestamp");
    }
    if (endsAt.getTime() <= startsAt.getTime()) {
      throw new Error("Sponsored monitor requires startsAt < endsAt");
    }
    return { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() };
  }

  // Prefer hour-level short demo windows when present.
  const durationHoursRaw =
    typeof content.durationHours === "number" && Number.isFinite(content.durationHours)
      ? Math.floor(content.durationHours)
      : typeof content.watchSpec?.durationHours === "number"
        ? Math.floor(content.watchSpec.durationHours as number)
        : null;

  if (durationHoursRaw != null) {
    if (durationHoursRaw < 1) {
      throw new Error("Sponsored monitor durationHours must be at least 1");
    }
    const endsAt = new Date(startsAt.getTime() + durationHoursRaw * 60 * 60 * 1000);
    return { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() };
  }

  const durationDays =
    typeof content.durationDays === "number" && Number.isFinite(content.durationDays)
      ? Math.floor(content.durationDays)
      : typeof content.watchSpec?.durationDays === "number"
        ? Math.floor(content.watchSpec.durationDays as number)
        : options.defaultDurationDays;

  if (durationDays < 1) {
    throw new Error("Sponsored monitor durationDays must be at least 1");
  }

  const endsAt = new Date(startsAt.getTime() + durationDays * 24 * 60 * 60 * 1000);
  return { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() };
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

  if (!isAddress(candidate, { strict: false })) {
    throw new Error(
      `Sponsored monitor targetContract is not a valid Ethereum address: ${candidate}`,
    );
  }

  return getAddress(candidate);
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
  return keccak256(stringToBytes(canonical));
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
