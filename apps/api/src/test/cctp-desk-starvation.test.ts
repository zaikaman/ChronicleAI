import { describe, expect, it } from "vitest";
import {
  deployableToDeskUsdc,
  evaluateDeskCctpStarvation,
} from "../cctp/desk-starvation.ts";

describe("evaluateDeskCctpStarvation", () => {
  const base = {
    deskEquityUsdc: 10,
    minAumUsdc: 20,
    targetAumUsdc: 50,
    treasurySepoliaUsdc: 5,
    usdcOperatingReserve: 10,
    topupChunkUsdc: 10,
    treasuryBaseUsdc: 100,
    baseSafetyBufferUsdc: 5,
    rebalanceThresholdUsdc: 10,
  };

  it("detects starvation when desk needs capital, Sepolia cannot top-up, Base flush", () => {
    const r = evaluateDeskCctpStarvation(base);
    expect(r.starved).toBe(true);
    expect(r.reason).toBe("awaiting_cctp_rebalance");
    expect(r.baseSurplusUsdc).toBe(95);
  });

  it("is not starved when desk equity is healthy", () => {
    const r = evaluateDeskCctpStarvation({
      ...base,
      deskEquityUsdc: 60,
    });
    expect(r.starved).toBe(false);
    expect(r.reason).toBe("desk_equity_ok");
  });

  it("is not starved when Sepolia can fund top-up", () => {
    const r = evaluateDeskCctpStarvation({
      ...base,
      treasurySepoliaUsdc: 50,
    });
    expect(r.starved).toBe(false);
    expect(r.reason).toBe("sepolia_can_topup");
  });

  it("is not starved when Base is not flush", () => {
    const r = evaluateDeskCctpStarvation({
      ...base,
      treasuryBaseUsdc: 12, // surplus 7 < threshold 10
    });
    expect(r.starved).toBe(false);
    expect(r.reason).toBe("base_not_flush");
  });
});

describe("deployableToDeskUsdc", () => {
  it("subtracts operating reserve and never goes negative", () => {
    expect(deployableToDeskUsdc(40, 10)).toBe(30);
    expect(deployableToDeskUsdc(5, 10)).toBe(0);
    expect(deployableToDeskUsdc(Number.NaN, 10)).toBe(0);
  });
});
