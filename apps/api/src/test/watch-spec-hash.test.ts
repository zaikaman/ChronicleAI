import { describe, expect, it } from "vitest";
import {
  deriveWatchSpecHash,
  resolveTargetContract,
  resolveWatchSpecHash,
} from "../services/watch-spec-hash.ts";

describe("watch-spec-hash", () => {
  const validHash = "0x" + "ab".repeat(32);

  it("uses explicit watchSpecHash when valid bytes32", () => {
    expect(resolveWatchSpecHash({ watchSpecHash: validHash })).toBe(validHash);
  });

  it("lowercases explicit watchSpecHash", () => {
    const upper = "0x" + "AB".repeat(32);
    expect(resolveWatchSpecHash({ watchSpecHash: upper })).toBe(upper.toLowerCase());
  });

  it("rejects invalid watchSpecHash shapes", () => {
    expect(() => resolveWatchSpecHash({ watchSpecHash: "0xcc" })).toThrow(/32-byte/);
    expect(() => resolveWatchSpecHash({ watchSpecHash: `0x${"c".repeat(64)}` })).not.toThrow();
  });

  it("derives a deterministic hash from watchSpec when hash is missing", () => {
    const spec = {
      targetContract: "0x1111111111111111111111111111111111111111",
      eventSignatures: ["Transfer(address,address,uint256)"],
      filters: { minUsd: 10000 },
    };
    const a = resolveWatchSpecHash({ watchSpec: spec });
    const b = deriveWatchSpecHash(spec);
    const c = deriveWatchSpecHash({
      filters: { minUsd: 10000 },
      eventSignatures: ["Transfer(address,address,uint256)"],
      targetContract: "0x1111111111111111111111111111111111111111",
    });

    expect(a).toMatch(/^0x[0-9a-f]{64}$/);
    expect(a).toBe(b);
    expect(a).toBe(c); // key order independent
  });

  it("rejects when neither watchSpecHash nor watchSpec is present", () => {
    expect(() => resolveWatchSpecHash({})).toThrow(/watchSpecHash or watchSpec/);
  });

  it("resolves and checksums targetContract", () => {
    const address = resolveTargetContract({
      targetContract: "0x1111111111111111111111111111111111111111",
    });
    expect(address).toMatch(/^0x/);
    expect(address.length).toBe(42);
  });

  it("reads targetContract from nested watchSpec", () => {
    const address = resolveTargetContract({
      watchSpec: { targetContract: "0x2222222222222222222222222222222222222222" },
    });
    expect(address.toLowerCase()).toBe("0x2222222222222222222222222222222222222222");
  });

  it("rejects missing or invalid targetContract", () => {
    expect(() => resolveTargetContract({})).toThrow(/missing targetContract/);
    expect(() => resolveTargetContract({ targetContract: "not-an-address" })).toThrow(
      /valid Ethereum address/,
    );
  });
});
