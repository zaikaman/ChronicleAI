// Unit tests for sponsored watch report generation + event contract matching

import { describe, expect, it } from "vitest";
import type { MonitoredEventRow } from "@chronicleai/db";
import {
  buildSourceEventRoot,
  createSponsoredWatchReportService,
  eventMatchesTargetContract,
} from "../services/sponsored-watch-report-service.ts";

const TARGET = "0x1234567890abcdef1234567890abcdef12345678";

function event(partial: Partial<MonitoredEventRow> & { id: string }): MonitoredEventRow {
  return {
    source: "keeperhub",
    source_event_id: partial.id,
    event_type: "large_swap",
    chain_id: 11155111,
    protocol: "uniswap",
    asset_symbols: ["USDC"],
    magnitude: { value: 100000, unit: "USD" },
    transaction_hash: "0x" + "ab".repeat(32),
    observed_at: null,
    captured_at: "2026-07-08T00:00:00.000Z",
    significance_score: 0.8,
    raw_payload: { address: TARGET },
    status: "qualified",
    created_at: "2026-07-08T00:00:00.000Z",
    updated_at: "2026-07-08T00:00:00.000Z",
    ...partial,
  };
}

describe("sponsored-watch-report-service", () => {
  const service = createSponsoredWatchReportService();

  it("builds a stable empty source event root", () => {
    const a = buildSourceEventRoot([]);
    const b = buildSourceEventRoot([]);
    expect(a).toBe(b);
    expect(a.startsWith("0x")).toBe(true);
    expect(a.length).toBe(66);
  });

  it("builds a deterministic root from event ids regardless of input order", () => {
    const a = buildSourceEventRoot(["b", "a", "c"]);
    const b = buildSourceEventRoot(["c", "a", "b"]);
    expect(a).toBe(b);
  });

  it("matches events by contract address in raw payload", () => {
    const match = event({ id: "1", raw_payload: { contractAddress: TARGET } });
    const miss = event({
      id: "2",
      raw_payload: { address: "0x0000000000000000000000000000000000000001" },
    });
    expect(eventMatchesTargetContract(match, TARGET)).toBe(true);
    expect(eventMatchesTargetContract(miss, TARGET)).toBe(false);
  });

  it("generates a report with sourceEventRoot and reportContentHash", async () => {
    const report = await service.generateReport({
      watchId: "watch-1",
      targetContract: TARGET,
      watchSpecHash: "0x" + "c".repeat(64),
      startsAt: "2026-07-01T00:00:00.000Z",
      endsAt: "2026-07-08T00:00:00.000Z",
      events: [event({ id: "evt-1" }), event({ id: "evt-2", significance_score: 0.95 })],
    });

    expect(report.sourceEventIds).toEqual(["evt-1", "evt-2"]);
    expect(report.sourceEventRoot).toBe(buildSourceEventRoot(["evt-1", "evt-2"]));
    expect(report.reportContentHash.startsWith("0x")).toBe(true);
    expect(report.highlights.length).toBeGreaterThan(0);
    expect(report.title).toContain("Sponsored Watch Report");
    expect(report.summary).toContain("2 on-chain event");
    expect(report.generationSource).toBe("template");
  });

  it("generates an empty-window report when no events match", async () => {
    const report = await service.generateReport({
      watchId: "watch-empty",
      targetContract: TARGET,
      watchSpecHash: "0x" + "d".repeat(64),
      startsAt: "2026-07-01T00:00:00.000Z",
      endsAt: "2026-07-08T00:00:00.000Z",
      events: [],
    });

    expect(report.sourceEventIds).toEqual([]);
    expect(report.sourceEventRoot).toBe(buildSourceEventRoot([]));
    expect(report.summary.toLowerCase()).toContain("no qualifying");
    expect(report.confidence).toBe("high");
  });
});
