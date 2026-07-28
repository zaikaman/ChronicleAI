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
        baseFeeGwei: 75,
        transactionCount: 120,
        createdContracts: [],
      },
      window,
    );

    expect(result.events.some((e) => e.eventType === "gas_spike")).toBe(true);
    const gas = result.events.find((e) => e.eventType === "gas_spike");
    expect(gas?.magnitude?.value).toBe(75);
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
        baseFeeGwei: 25,
        transactionCount: 100,
        createdContracts: [],
      },
      window,
    );
    expect(result.events.some((e) => e.eventType === "gas_spike")).toBe(false);
  });

  it("emits volume_anomaly after enough samples when z-score is high", () => {
    const window = new TransactionVolumeWindow(100);
    // Seed a long stable baseline (~100 txs). Z-score includes the current
    // sample, so n must be large enough that a spike can clear ≥3σ
    // (theoretical max |z| ≈ √(n−1) when the outlier is in-sample).
    for (let i = 0; i < 20; i++) {
      window.push(1, 100 + (i % 3));
    }

    const result = analyzeBlockStats(
      {
        chainId: 1,
        blockNumber: 200,
        blockHash: "0xvol",
        timestamp: 1_700_000_100,
        baseFeeGwei: 2,
        transactionCount: 500,
        createdContracts: [],
      },
      window,
    );

    expect(result.volumeZScore).not.toBeNull();
    expect(Math.abs(result.volumeZScore as number)).toBeGreaterThanOrEqual(3.0);
    expect(result.events.some((e) => e.eventType === "volume_anomaly")).toBe(true);
  });

  it("emits contract_deployment for created contracts (qualification is separate)", () => {
    const window = new TransactionVolumeWindow(100);
    const result = analyzeBlockStats(
      {
        chainId: 1,
        blockNumber: 300,
        blockHash: "0xdep",
        timestamp: 1_700_000_200,
        // Keep base fee below gas_spike threshold so this test isolates deploys
        baseFeeGwei: 25,
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
