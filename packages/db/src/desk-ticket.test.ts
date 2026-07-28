import { DESK_CHAIN_ID } from "@chronicleai/schemas";
import { describe, expect, it } from "vitest";
import { keccak256, stringToBytes } from "viem";
import {
  buildDeskTicketV1,
  canonicalizeJson,
  hashDeskCommitment,
  hashDeskTicket,
  normalizeBytes32Hash,
  serializeDeskTicket,
  sortKeysDeep,
  type DeskTicketV1,
} from "./desk-ticket.ts";

const sampleTicket: DeskTicketV1 = {
  version: 1,
  chainId: DESK_CHAIN_ID,
  intentId: "11111111-1111-1111-1111-111111111111",
  strategy: "yield_rotation",
  signal: { type: "apy_delta", features: { apyDeltaBps: 75 } },
  legs: [
    {
      protocol: "aave-v3",
      action: "withdraw",
      asset: "LINK",
      amount: "1.0",
    },
    {
      protocol: "uniswap",
      action: "swap-exact-input",
      tokenIn: "LINK",
      tokenOut: "USDC",
      amountIn: "1.0",
    },
  ],
  fills: [{ txHash: "0x" + "ab".repeat(32), step: 0 }],
  policy: { maxTradeUsdc: 15, hfAfter: 2.1 },
  notionalUsdc: 10,
  createdAt: "2026-07-28T12:00:00.000Z",
};

describe("sortKeysDeep / canonicalizeJson", () => {
  it("sorts object keys recursively for stable JSON", () => {
    const a = canonicalizeJson({ z: 1, a: { c: 3, b: 2 }, m: [1, { y: 1, x: 0 }] });
    const b = canonicalizeJson({ a: { b: 2, c: 3 }, m: [1, { x: 0, y: 1 }], z: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":{"b":2,"c":3},"m":[1,{"x":0,"y":1}],"z":1}');
  });

  it("preserves array order", () => {
    expect(sortKeysDeep([3, 1, 2])).toEqual([3, 1, 2]);
  });
});

describe("buildDeskTicketV1 / serializeDeskTicket", () => {
  it("defaults version and Sepolia chainId", () => {
    const ticket = buildDeskTicketV1({
      intentId: "abc",
      strategy: "risk_defend",
      signal: { type: "health_factor", features: { hf: 1.1 } },
      legs: [],
      fills: [],
      policy: {},
      notionalUsdc: 5,
      createdAt: "2026-07-28T00:00:00.000Z",
    });
    expect(ticket.version).toBe(1);
    expect(ticket.chainId).toBe(11155111);
  });

  it("serializes with stable key order regardless of property insertion", () => {
    const reordered: DeskTicketV1 = {
      createdAt: sampleTicket.createdAt,
      notionalUsdc: sampleTicket.notionalUsdc,
      policy: sampleTicket.policy,
      fills: sampleTicket.fills,
      legs: sampleTicket.legs,
      signal: sampleTicket.signal,
      strategy: sampleTicket.strategy,
      intentId: sampleTicket.intentId,
      chainId: sampleTicket.chainId,
      version: sampleTicket.version,
    };
    expect(serializeDeskTicket(reordered)).toBe(serializeDeskTicket(sampleTicket));
  });
});

describe("hashDeskTicket", () => {
  it("returns lowercase 0x 32-byte keccak of canonical JSON", () => {
    const hash = hashDeskTicket(sampleTicket);
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);

    const manual = keccak256(stringToBytes(serializeDeskTicket(sampleTicket))).toLowerCase();
    expect(hash).toBe(manual);
  });

  it("is deterministic across calls", () => {
    expect(hashDeskTicket(sampleTicket)).toBe(hashDeskTicket(sampleTicket));
  });

  it("changes when material ticket fields change", () => {
    const other = buildDeskTicketV1({
      ...sampleTicket,
      notionalUsdc: 11,
    });
    expect(hashDeskTicket(other)).not.toBe(hashDeskTicket(sampleTicket));
  });
});

describe("hashDeskCommitment", () => {
  it("hashes arbitrary objects with sorted keys", () => {
    const h1 = hashDeskCommitment({ b: 2, a: 1 });
    const h2 = hashDeskCommitment({ a: 1, b: 2 });
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe("normalizeBytes32Hash", () => {
  it("lowercases valid hashes", () => {
    const upper = "0x" + "AB".repeat(32);
    expect(normalizeBytes32Hash(upper)).toBe(upper.toLowerCase());
  });

  it("rejects invalid lengths", () => {
    expect(() => normalizeBytes32Hash("0xabc")).toThrow(/32-byte/);
  });
});
