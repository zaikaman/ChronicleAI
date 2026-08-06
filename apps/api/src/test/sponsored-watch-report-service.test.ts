// Unit tests for sponsored watch report generation + event contract matching

import { describe, expect, it } from "vitest";
import type { MonitoredEventRow } from "@chronicleai/db";
import {
  buildSourceEventRoot,
  createSponsoredWatchReportService,
  decodeTransferAmount,
  describeWatchEvent,
  eventMatchesTargetContract,
  eventMatchesWallet,
  humanizeTokenAmount,
  isPlaceholderSponsoredReport,
  TRANSFER_EVENT_TOPIC0,
} from "../services/sponsored-watch-report-service.ts";

const TARGET = "0x1234567890abcdef1234567890abcdef12345678";

function event(partial: Partial<MonitoredEventRow> & { id: string }): MonitoredEventRow {
  return {
    source: "keeperhub",
    source_event_id: partial.id,
    event_type: "large_swap",
    chain_id: 1,
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

  it("matches wallet Transfer topics from/to", () => {
    const wallet = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
    const padded = `0x${"0".repeat(24)}${wallet.slice(2).toLowerCase()}`;
    const fromMatch = event({
      id: "w1",
      raw_payload: {
        topics: [TRANSFER_EVENT_TOPIC0, padded, `0x${"0".repeat(64)}`],
      },
    });
    const toMatch = event({
      id: "w2",
      raw_payload: {
        topics: [TRANSFER_EVENT_TOPIC0, `0x${"0".repeat(64)}`, padded],
        from: "0x0000000000000000000000000000000000000001",
        to: wallet,
      },
    });
    const miss = event({
      id: "w3",
      raw_payload: {
        topics: [
          TRANSFER_EVENT_TOPIC0,
          `0x${"0".repeat(64)}`,
          `0x${"0".repeat(24)}${"11".repeat(20)}`,
        ],
      },
    });
    expect(eventMatchesWallet(fromMatch, wallet)).toBe(true);
    expect(eventMatchesWallet(toMatch, wallet)).toBe(true);
    expect(eventMatchesWallet(miss, wallet)).toBe(false);
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

  it("uses prior correlation count when live events are gone", async () => {
    const report = await service.generateReport({
      watchId: "watch-orphan-ids",
      targetContract: TARGET,
      watchSpecHash: "0x" + "f".repeat(64),
      startsAt: "2026-07-01T00:00:00.000Z",
      endsAt: "2026-07-08T00:00:00.000Z",
      events: [],
      priorMonitoredCount: 437,
      priorSourceEventIdCount: 437,
    });
    expect(report.summary).toContain("437");
    expect(report.summary.toLowerCase()).not.toContain("no qualifying");
    expect(report.confidence).toBe("medium");
    expect(report.highlights.some((h) => h.includes("437"))).toBe(true);
  });

  it("detects placeholder / ellipsis report bodies", () => {
    expect(
      isPlaceholderSponsoredReport({
        reportTitle: "...",
        reportSummary: "...",
        reportAnalysis: "...",
        reportHighlights: ["...", "..."],
      }),
    ).toBe(true);
    expect(
      isPlaceholderSponsoredReport({
        reportTitle: "Sponsored Watch Report — 0x1234…abcd",
        reportSummary:
          "ChronicleAI observed 12 on-chain events on the target during the campaign window.",
        reportAnalysis: "Detailed analysis of matched swaps and liquidations across the window.",
        reportHighlights: ["1. large swap on uniswap"],
      }),
    ).toBe(false);
  });

  it("falls back to template when LLM returns ellipsis placeholders", async () => {
    const llmService = createSponsoredWatchReportService({
      providerConfigs: {
        gemini: { apiKey: "", model: "x" },
        openai: { apiKey: "", model: "x" },
        groq: { apiKey: "test-key", model: "llama" },
      },
    });

    const { LLM_PROVIDER_CALLERS } = await import("../services/llm-provider-client.ts");
    const original = LLM_PROVIDER_CALLERS.groq;
    LLM_PROVIDER_CALLERS.groq = async () =>
      JSON.stringify({
        title: "...",
        summary: "...",
        highlights: ["...", "..."],
        analysis: "...",
        confidence: "high",
      });

    try {
      const report = await llmService.generateReport({
        watchId: "watch-junk-llm",
        targetContract: TARGET,
        watchSpecHash: "0x" + "e".repeat(64),
        startsAt: "2026-07-01T00:00:00.000Z",
        endsAt: "2026-07-08T00:00:00.000Z",
        events: [event({ id: "evt-1" })],
      });
      expect(report.generationSource).toBe("template");
      expect(report.title).toContain("Sponsored Watch Report");
      expect(report.summary).not.toBe("...");
      expect(isPlaceholderSponsoredReport({
        reportTitle: report.title,
        reportSummary: report.summary,
        reportAnalysis: report.analysis,
        reportHighlights: report.highlights,
      })).toBe(false);
    } finally {
      LLM_PROVIDER_CALLERS.groq = original;
    }
  });
});

describe("watch event description helpers", () => {
  const WALLET = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
  const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";

  it("decodes a 32-byte ERC-20 transfer amount", () => {
    expect(decodeTransferAmount(`0x${'0'.repeat(63)}1`)).toBe(1n);
    expect(decodeTransferAmount(`0x${'0'.repeat(64)}`)).toBe(0n);
    expect(decodeTransferAmount(`0x${'0'.repeat(62)}0a`)).toBe(10n);
    expect(decodeTransferAmount("0x1234")).toBeNull();
    expect(decodeTransferAmount("")).toBeNull();
    expect(decodeTransferAmount(null)).toBeNull();
  });

  it("humanizes token amounts with decimals", () => {
    expect(humanizeTokenAmount(12_500_000_000n, 6)).toBe("12,500");
    expect(humanizeTokenAmount(1_000_000_000_000_000_000n, 18)).toBe("1");
    expect(humanizeTokenAmount(1_234_567n, 6)).toBe("1.234567");
    expect(humanizeTokenAmount(0n, 6)).toBe("0");
  });

  it("describes a received wallet transfer with token and amount", () => {
    const ev = event({
      id: "w-recv",
      event_type: "wallet_transfer",
      asset_symbols: ["USDC"],
      magnitude: { value: 12500, unit: "USD" },
      raw_payload: {
        address: USDC,
        from: "0x1111111111111111111111111111111111111111",
        to: WALLET,
        amountRaw: "12500000000",
        tokenSymbol: "USDC",
        tokenDecimals: 6,
      },
    });
    const line = describeWatchEvent(ev, "wallet", WALLET);
    expect(line).toContain("Transfer");
    expect(line).toContain("12,500 USDC");
    expect(line).toContain("received from");
  });

  it("describes a sent wallet transfer", () => {
    const ev = event({
      id: "w-sent",
      event_type: "wallet_transfer",
      raw_payload: {
        address: USDC,
        from: WALLET,
        to: "0x2222222222222222222222222222222222222222",
        amountRaw: "5000000",
      },
    });
    const line = describeWatchEvent(ev, "wallet", WALLET);
    expect(line).toContain("5 USDC");
    expect(line).toContain("sent to");
  });

  it("shows direction only for unknown tokens (no fabricated symbol or decimals)", () => {
    const ev = event({
      id: "w-unknown",
      event_type: "wallet_transfer",
      raw_payload: {
        address: "0x3333333333333333333333333333333333333333",
        from: "0x1111111111111111111111111111111111111111",
        to: WALLET,
        amountRaw: "1000000000000000000",
      },
    });
    const line = describeWatchEvent(ev, "wallet", WALLET);
    expect(line).toContain("Transfer ·");
    expect(line).toContain("→");
    expect(line).not.toContain("token");
    expect(line).not.toContain("USDC");
  });

  it("falls back to formatEventLine for enriched contract events", () => {
    const ev = event({ id: "c-swap", raw_payload: { address: TARGET } });
    const line = describeWatchEvent(ev, "contract");
    expect(line).toContain("large swap");
    expect(line).toContain("100,000 USD");
  });
});
