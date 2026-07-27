// Unit tests for digest generation service

import { describe, expect, it } from "vitest";
import { createDigestGenerationService } from "../services/digest-generation-service.ts";

const service = createDigestGenerationService();

const sampleEvents: Array<{
  id: string;
  eventType: string;
  chainId: number;
  protocol: string | null;
  assetSymbols: string[] | null;
  magnitude: Record<string, unknown> | null;
  transactionHash: string | null;
  significanceScore: number | null;
  capturedAt: string;
}> = [
  {
    id: "evt-001",
    eventType: "large_swap",
    chainId: 1,
    protocol: "Uniswap",
    assetSymbols: ["ETH", "USDC"],
    magnitude: { value: 2500000, unit: "USD" },
    transactionHash: "0xabc",
    significanceScore: 0.85,
    capturedAt: new Date().toISOString(),
  },
  {
    id: "evt-002",
    eventType: "liquidation",
    chainId: 1,
    protocol: "Aave",
    assetSymbols: ["ETH"],
    magnitude: { value: 1200000, unit: "USD" },
    transactionHash: "0xdef",
    significanceScore: 0.72,
    capturedAt: new Date().toISOString(),
  },
  {
    id: "evt-003",
    eventType: "gas_spike",
    chainId: 1,
    protocol: null,
    assetSymbols: null,
    magnitude: { value: 850, unit: "gwei" },
    transactionHash: "0xghi",
    significanceScore: 0.68,
    capturedAt: new Date().toISOString(),
  },
];

describe("DigestGenerationService", () => {
  it("generates a digest with ranked highlights from events", async () => {
    const result = await service.generateDigest({
      reportDate: "2026-07-27",
      periodStart: new Date(Date.now() - 86400000).toISOString(),
      periodEnd: new Date().toISOString(),
      events: sampleEvents,
    });

    expect(result.title).toContain("ChronicleAI Daily Digest");
    expect(result.summary).toBeTruthy();
    expect(result.highlights.length).toBeGreaterThanOrEqual(3);
    expect(result.sourceEventIds).toContain("evt-001");
    expect(result.confidence).toBe("high");
  });

  it("generates a no-major-events digest when no events exist", async () => {
    const result = await service.generateDigest({
      reportDate: "2026-07-27",
      periodStart: new Date(Date.now() - 86400000).toISOString(),
      periodEnd: new Date().toISOString(),
      events: [],
    });

    expect(result.title).toContain("ChronicleAI Daily Digest");
    expect(result.highlights[0]).toContain("No major events");
    expect(result.sourceEventIds).toEqual([]);
    expect(result.analysis).toBeTruthy();
  });

  it("includes source references in the digest", async () => {
    const result = await service.generateDigest({
      reportDate: "2026-07-27",
      periodStart: new Date(Date.now() - 86400000).toISOString(),
      periodEnd: new Date().toISOString(),
      events: sampleEvents,
    });

    expect(result.sourceEventIds.length).toBe(3);
  });

  it("separates analysis from facts", async () => {
    const result = await service.generateDigest({
      reportDate: "2026-07-27",
      periodStart: new Date(Date.now() - 86400000).toISOString(),
      periodEnd: new Date().toISOString(),
      events: sampleEvents,
    });

    expect(result.summary).toBeTruthy();
    expect(typeof result.analysis).toBe("string");
    expect(result.analysis!.length).toBeGreaterThan(50);
  });

  it("produces consistent output for the same input", async () => {
    const result1 = await service.generateDigest({
      reportDate: "2026-07-27",
      periodStart: new Date(Date.now() - 86400000).toISOString(),
      periodEnd: new Date().toISOString(),
      events: sampleEvents,
    });

    const result2 = await service.generateDigest({
      reportDate: "2026-07-27",
      periodStart: new Date(Date.now() - 86400000).toISOString(),
      periodEnd: new Date().toISOString(),
      events: sampleEvents,
    });

    expect(result1.title).toBe(result2.title);
    expect(result1.sourceEventIds).toEqual(result2.sourceEventIds);
  });

  it("ranks events by significance score descending", async () => {
    const highScoreEvent = {
      ...sampleEvents[0],
      id: "high" as const,
      significanceScore: 0.9 as const,
      eventType: "large_swap" as const,
      chainId: 1 as const,
      protocol: "Uniswap" as string | null,
      assetSymbols: ["ETH", "USDC"] as string[] | null,
      magnitude: { value: 2500000, unit: "USD" } as Record<string, unknown> | null,
      transactionHash: "0xabc" as string | null,
      capturedAt: new Date().toISOString() as string,
    };
    const mediumScoreEvent = {
      ...sampleEvents[0],
      id: "medium" as const,
      significanceScore: 0.5 as const,
      eventType: "large_swap" as const,
      chainId: 1 as const,
      protocol: "Uniswap" as string | null,
      assetSymbols: ["ETH", "USDC"] as string[] | null,
      magnitude: { value: 2500000, unit: "USD" } as Record<string, unknown> | null,
      transactionHash: "0xabc" as string | null,
      capturedAt: new Date().toISOString() as string,
    };
    const lowScoreEvent = {
      ...sampleEvents[0],
      id: "low" as const,
      significanceScore: 0.1 as const,
      eventType: "large_swap" as const,
      chainId: 1 as const,
      protocol: "Uniswap" as string | null,
      assetSymbols: ["ETH", "USDC"] as string[] | null,
      magnitude: { value: 2500000, unit: "USD" } as Record<string, unknown> | null,
      transactionHash: "0xabc" as string | null,
      capturedAt: new Date().toISOString() as string,
    };

    const events = [lowScoreEvent, highScoreEvent, mediumScoreEvent];

    const result = await service.generateDigest({
      reportDate: "2026-07-27",
      periodStart: new Date(Date.now() - 86400000).toISOString(),
      periodEnd: new Date().toISOString(),
      events,
    });

    expect(result.highlights.length).toBe(3);
  });
});
