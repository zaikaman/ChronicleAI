import {
  encodeAbiParameters,
  encodeEventTopics,
  parseAbiItem,
  zeroHash,
  type Hex,
} from "viem";
import { describe, expect, it } from "vitest";
import {
  decodeSponsoredWatchIdFromLogs,
  parseOnChainWatchId,
  requireOnChainWatchId,
  SPONSORED_WATCH_CREATED_EVENT,
} from "../services/sponsored-watch-id.ts";

describe("parseOnChainWatchId", () => {
  it("accepts number, bigint, decimal string, and hex", () => {
    expect(parseOnChainWatchId(0)).toBe(0);
    expect(parseOnChainWatchId(42)).toBe(42);
    expect(parseOnChainWatchId(42n)).toBe(42);
    expect(parseOnChainWatchId("42")).toBe(42);
    expect(parseOnChainWatchId("0x2a")).toBe(42);
  });

  it("does not invent ids from garbage or digit-stripping", () => {
    expect(parseOnChainWatchId("watch-42-abc")).toBeUndefined();
    expect(parseOnChainWatchId("not-a-number")).toBeUndefined();
    expect(parseOnChainWatchId("")).toBeUndefined();
    expect(parseOnChainWatchId(null)).toBeUndefined();
    expect(parseOnChainWatchId(3.14)).toBeUndefined();
    expect(parseOnChainWatchId(-1)).toBeUndefined();
  });

  it("unwraps nested result / watchId shapes", () => {
    expect(parseOnChainWatchId({ watchId: "7" })).toBe(7);
    expect(parseOnChainWatchId({ result: 9 })).toBe(9);
    expect(parseOnChainWatchId([11])).toBe(11);
  });
});

describe("requireOnChainWatchId", () => {
  it("throws with context when missing", () => {
    expect(() => requireOnChainWatchId(undefined, "test")).toThrow(/Could not decode/);
  });

  it("returns valid id including zero", () => {
    expect(requireOnChainWatchId(0, "test")).toBe(0);
    expect(requireOnChainWatchId(1, "test")).toBe(1);
  });
});

describe("decodeSponsoredWatchIdFromLogs", () => {
  it("decodes SponsoredWatchCreated from receipt logs", () => {
    const abiItem = parseAbiItem(SPONSORED_WATCH_CREATED_EVENT);
    const topics = encodeEventTopics({
      abi: [abiItem],
      eventName: "SponsoredWatchCreated",
      args: {
        watchId: 42n,
        targetContract: "0x1111111111111111111111111111111111111111",
      },
    });
    const data = encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "uint64" },
        { type: "uint64" },
      ],
      [zeroHash, 1n, 2n],
    );

    const watchId = decodeSponsoredWatchIdFromLogs([
      { topics: topics as string[], data: data as Hex },
    ]);
    expect(watchId).toBe(42);
  });

  it("throws when event is missing (no silent zero)", () => {
    expect(() => decodeSponsoredWatchIdFromLogs([])).toThrow(/not found/);
  });
});
