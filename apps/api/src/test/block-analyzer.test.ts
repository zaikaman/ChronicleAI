// Unit tests for block gas / volume analysis

import { describe, expect, it } from "vitest";
import {
  analyzeBlockStats,
  computeZScore,
  TransactionVolumeWindow,
  weiToGwei,
} from "../monitoring/block-analyzer.ts";

describe("block-analyzer", () => {
  it("converts wei base fee to gwei", () => {
    // 50 gwei = 50e9 wei
    expect(weiToGwei(50_000_000_000n)).toBe(50);
    expect(weiToGwei(null)).toBeNull();
  });

  it("emits gas_spike when base fee exceeds threshold", () => {
    const window = new TransactionVolumeWindow(100);
    const result = analyzeBlockStats(
      {
        chainId: 1,
        blockNumber: 100,
        blockHash: "0xabc",
        timestamp: 1_700_000_000,
        baseFeeGwei: 650,
        transactionCount: 120,
        createdContracts: [],
      },
      window,
    );

    expect(result.events.some((e) => e.eventType === "gas_spike")).toBe(true);
    const gas = result.events.find((e) => e.eventType === "gas_spike");
    expect(gas?.magnitude?.value).toBe(650);
    expect(gas?.magnitude?.unit).toBe("gwei");
  });

  it("does not emit gas_spike below threshold", () => {
    const window = new TransactionVolumeWindow(100);
    const result = analyzeBlockStats(
      {
        chainId: 1,
        blockNumber: 101,
        blockHash: "0xdef",
        timestamp: 1_700_000_012,
        baseFeeGwei: 40,
        transactionCount: 100,
        createdContracts: [],
      },
      window,
    );
    expect(result.events.some((e) => e.eventType === "gas_spike")).toBe(false);
  });

  it("emits volume_anomaly after enough samples when z-score is high", () => {
    const window = new TransactionVolumeWindow(100);
    // Seed stable baseline around 100 txs
    for (let i = 0; i < 25; i++) {
      window.push(1, 100 + (i % 3));
    }

    const result = analyzeBlockStats(
      {
        chainId: 1,
        blockNumber: 200,
        blockHash: "0xvol",
        timestamp: 1_700_000_100,
        baseFeeGwei: 20,
        transactionCount: 400,
        createdContracts: [],
      },
      window,
    );

    expect(result.volumeZScore).not.toBeNull();
    expect(Math.abs(result.volumeZScore as number)).toBeGreaterThanOrEqual(2);
    expect(result.events.some((e) => e.eventType === "volume_anomaly")).toBe(true);
  });

  it("emits contract_deployment for created contracts", () => {
    const window = new TransactionVolumeWindow(100);
    const result = analyzeBlockStats(
      {
        chainId: 1,
        blockNumber: 300,
        blockHash: "0xdep",
        timestamp: 1_700_000_200,
        baseFeeGwei: 10,
        transactionCount: 50,
        createdContracts: ["0xNewContract0000000000000000000000000001"],
      },
      window,
    );

    expect(result.events.some((e) => e.eventType === "contract_deployment")).toBe(true);
  });

  it("computeZScore returns null for tiny samples", () => {
    expect(computeZScore([1], 1)).toBeNull();
  });
});
