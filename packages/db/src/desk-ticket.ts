/**
 * Canonical trade-ticket JSON and hashing for Chronicle Desk.
 *
 * ticketHash = keccak256(utf8(canonicalJson)) with stable key order —
 * same discipline as watch-spec / content hashes elsewhere.
 */

import { DESK_CHAIN_ID, type DeskStrategy } from "@chronicleai/schemas";
import { keccak256, stringToBytes } from "viem";

export const DESK_TICKET_VERSION = 1 as const;

/** One protocol leg in a desk trade ticket. */
export interface DeskTicketLeg {
  protocol: string;
  action: string;
  asset?: string;
  amount?: string;
  tokenIn?: string;
  tokenOut?: string;
  amountIn?: string;
  amountOut?: string;
  [key: string]: unknown;
}

/** On-chain fill reference for a completed leg. */
export interface DeskTicketFill {
  txHash: string;
  step: number;
  [key: string]: unknown;
}

/** Signal summary embedded in the ticket body. */
export interface DeskTicketSignal {
  type: string;
  features: Record<string, unknown>;
}

/** Policy snapshot embedded at decision/publish time. */
export interface DeskTicketPolicy {
  maxTradeUsdc?: number;
  hfAfter?: number;
  [key: string]: unknown;
}

/**
 * Canonical ticket payload (version 1).
 * Field order in TypeScript is documentary; hashing always sorts keys deeply.
 */
export interface DeskTicketV1 {
  version: typeof DESK_TICKET_VERSION;
  chainId: typeof DESK_CHAIN_ID | number;
  intentId: string;
  strategy: DeskStrategy | string;
  signal: DeskTicketSignal;
  legs: DeskTicketLeg[];
  fills: DeskTicketFill[];
  policy: DeskTicketPolicy;
  notionalUsdc: number;
  createdAt: string;
}

const BYTES32_HEX = /^0x[0-9a-fA-F]{64}$/;

/**
 * Deep-sort object keys for deterministic JSON serialization.
 * Arrays preserve order; primitives pass through.
 */
export function sortKeysDeep(value: unknown): unknown {
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

/** Stable UTF-8 JSON with sorted keys (canonical form for hashing). */
export function canonicalizeJson(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

/**
 * Normalize a partial ticket into a complete v1 ticket.
 * Defaults chainId to Sepolia and version to 1.
 */
export function buildDeskTicketV1(
  input: Omit<DeskTicketV1, "version" | "chainId"> &
    Partial<Pick<DeskTicketV1, "version" | "chainId">>,
): DeskTicketV1 {
  return {
    version: input.version ?? DESK_TICKET_VERSION,
    chainId: input.chainId ?? DESK_CHAIN_ID,
    intentId: input.intentId,
    strategy: input.strategy,
    signal: {
      type: input.signal.type,
      features: input.signal.features ?? {},
    },
    legs: input.legs ?? [],
    fills: input.fills ?? [],
    policy: input.policy ?? {},
    notionalUsdc: input.notionalUsdc,
    createdAt: input.createdAt,
  };
}

/** Serialize a desk ticket to canonical JSON (stable key order). */
export function serializeDeskTicket(ticket: DeskTicketV1): string {
  return canonicalizeJson(buildDeskTicketV1(ticket));
}

/**
 * ticketHash = keccak256(utf8(canonicalJson)).
 * Returns lowercase 0x-prefixed 32-byte hex.
 */
export function hashDeskTicket(ticket: DeskTicketV1): string {
  const canonical = serializeDeskTicket(ticket);
  return keccak256(stringToBytes(canonical)).toLowerCase();
}

/**
 * Hash an arbitrary signal or intent commitment with the same key-order discipline.
 */
export function hashDeskCommitment(value: unknown): string {
  return keccak256(stringToBytes(canonicalizeJson(value))).toLowerCase();
}

/** Accept only valid 0x + 64 hex bytes32 strings; normalize to lowercase. */
export function normalizeBytes32Hash(hash: string): string {
  if (!BYTES32_HEX.test(hash)) {
    throw new Error(`Expected 0x-prefixed 32-byte hex hash, got: ${hash.slice(0, 20)}…`);
  }
  return hash.toLowerCase();
}
