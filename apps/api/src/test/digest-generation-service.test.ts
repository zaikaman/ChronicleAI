// Unit tests for digest generation service (LLM multi-provider, no template fallback)

import { describe, expect, it, vi, afterEach } from "vitest";
import {
  buildDigestPromptForTest,
  computeDigestStats,
  createDigestGenerationService,
  DigestGenerationError,
  flattenSectionsToAnalysis,
  parseSectionsFromAnalysis,
} from "../services/digest-generation-service.ts";
import type { LLMGenerationAttemptRepository } from "@chronicleai/db";

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

function createMockLlmAttemptRepo(): LLMGenerationAttemptRepository {
  return {
    async create(data) {
      return {
        ok: true as const,
        value: {
          id: "attempt-001",
          entity_type: data.entity_type ?? "daily_digest",
          entity_id: data.entity_id ?? null,
          monitored_event_id: data.monitored_event_id,
          provider: data.provider,
          attempt_order: data.attempt_order,
          status: data.status,
          latency_ms: data.latency_ms ?? 0,
          failure_reason: data.failure_reason ?? null,
          response_metadata: data.response_metadata ?? null,
          created_at: new Date().toISOString(),
        },
      };
    },
    async listByMonitoredEvent() {
      return { ok: true as const, value: [] };
    },
    async listByEntity() {
      return { ok: true as const, value: [] };
    },
  };
}

const emptyProviderConfigs = {
  gemini: { apiKey: "", model: "gemini-2.0-flash" },
  openai: { apiKey: "", model: "gpt-4o-mini" },
  groq: { apiKey: "", model: "llama-3.3-70b-versatile" },
};

const configuredProviders = {
  gemini: { apiKey: "gemini-test-key", model: "gemini-2.0-flash" },
  openai: { apiKey: "openai-test-key", model: "gpt-4o-mini" },
  groq: { apiKey: "groq-test-key", model: "llama-3.3-70b-versatile" },
};

const baseParams = {
  reportDate: "2026-07-07",
  periodStart: new Date(Date.now() - 86400000).toISOString(),
  periodEnd: new Date().toISOString(),
};

describe("DigestGenerationService", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uses Gemini LLM response when provider succeeds", async () => {
    const llmBody = {
      title: "ChronicleAI Daily Digest — LLM Edition",
      summary:
        "A busy session of DeFi activity with large swaps and liquidations dominating the tape.",
      highlights: [
        "Uniswap saw a $2.5M ETH/USDC swap",
        "Aave liquidations exceeded $1.2M",
        "Gas spiked to 850 gwei",
      ],
      analysis:
        "Liquidity concentration and elevated gas suggest competitive MEV and risk-off liquidations across major venues.",
      confidence: "high",
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          candidates: [{ content: { parts: [{ text: JSON.stringify(llmBody) }] } }],
        }),
      })),
    );

    const attempts: Array<{
      entity_type?: string;
      monitored_event_id: string;
      provider: string;
      status: string;
    }> = [];
    const llmAttemptRepo: LLMGenerationAttemptRepository = {
      async create(data) {
        attempts.push({
          ...(data.entity_type !== undefined ? { entity_type: data.entity_type } : {}),
          monitored_event_id: data.monitored_event_id,
          provider: data.provider,
          status: data.status,
        });
        return {
          ok: true as const,
          value: {
            id: `attempt-${attempts.length}`,
            entity_type: data.entity_type ?? "daily_digest",
            entity_id: data.entity_id ?? null,
            monitored_event_id: data.monitored_event_id,
            provider: data.provider,
            attempt_order: data.attempt_order,
            status: data.status,
            latency_ms: data.latency_ms ?? 0,
            failure_reason: data.failure_reason ?? null,
            response_metadata: data.response_metadata ?? null,
            created_at: new Date().toISOString(),
          },
        };
      },
      async listByMonitoredEvent() {
        return { ok: true as const, value: [] };
      },
      async listByEntity() {
        return { ok: true as const, value: [] };
      },
    };

    const service = createDigestGenerationService(configuredProviders, llmAttemptRepo);
    const result = await service.generateDigest({
      ...baseParams,
      events: sampleEvents,
    });

    expect(result.generationProvider).toBe("gemini");
    expect(result.title).toBe(llmBody.title);
    expect(result.summary).toContain("DeFi activity");
    expect(result.highlights).toHaveLength(3);
    expect(result.analysis).toContain("MEV");
    expect(result.sourceEventIds).toEqual(["evt-001", "evt-002", "evt-003"]);
    expect(result.confidence).toBe("high");

    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.entity_type).toBe("daily_digest");
    expect(attempts[0]?.monitored_event_id).toBe("evt-001"); // highest significance
    expect(attempts[0]?.provider).toBe("gemini");
    expect(attempts[0]?.status).toBe("succeeded");
  });

  it("generates a no-major-events digest when LLM returns empty-window content", async () => {
    const llmBody = {
      title: "ChronicleAI Daily Digest — Quiet Markets",
      summary:
        "No significant on-chain events were detected during the reporting period. Monitoring continued normally.",
      highlights: [
        "No major events crossed configured thresholds",
        "Gas and volume stayed within expected bands",
        "Operations remain nominal",
      ],
      analysis: "The absence of threshold breaches suggests orderly market conditions.",
      confidence: "high",
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          candidates: [{ content: { parts: [{ text: JSON.stringify(llmBody) }] } }],
        }),
      })),
    );

    const service = createDigestGenerationService(configuredProviders, createMockLlmAttemptRepo());
    const result = await service.generateDigest({
      ...baseParams,
      events: [],
    });

    expect(result.generationProvider).toBe("gemini");
    expect(result.title).toContain("ChronicleAI Daily Digest");
    expect(result.sourceEventIds).toEqual([]);
    expect(result.highlights.length).toBeGreaterThanOrEqual(1);
  });

  it("throws DigestGenerationError when all LLM providers fail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("Mock network failure");
      }),
    );

    // Gemini uses fetch (mocked to fail). Leave OpenAI/Groq keys empty so the
    // OpenAI SDK does not attempt real network calls during unit tests.
    const service = createDigestGenerationService(
      {
        gemini: { apiKey: "gemini-test-key", model: "gemini-2.0-flash" },
        openai: { apiKey: "", model: "gpt-4o-mini" },
        groq: { apiKey: "", model: "llama-3.3-70b-versatile" },
      },
      createMockLlmAttemptRepo(),
    );

    await expect(
      service.generateDigest({
        ...baseParams,
        events: sampleEvents,
      }),
    ).rejects.toBeInstanceOf(DigestGenerationError);

    try {
      await service.generateDigest({
        ...baseParams,
        events: sampleEvents,
      });
    } catch (error) {
      expect(error).toBeInstanceOf(DigestGenerationError);
      const genError = error as DigestGenerationError;
      expect(genError.message).toContain("all LLM providers failed");
      expect(genError.attempts.length).toBe(3);
      expect(genError.attempts.every((a) => !a.success)).toBe(true);
    }
  });

  it("throws when all API keys are empty", async () => {
    const service = createDigestGenerationService(
      emptyProviderConfigs,
      createMockLlmAttemptRepo(),
    );

    await expect(
      service.generateDigest({
        ...baseParams,
        events: sampleEvents,
      }),
    ).rejects.toMatchObject({
      name: "DigestGenerationError",
      message: expect.stringContaining("all LLM providers failed"),
    });
  });

  it("falls through invalid Gemini JSON and throws when later keys are empty", async () => {
    let callCount = 0;

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        callCount += 1;
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => ({
            candidates: [{ content: { parts: [{ text: "not-json-at-all" }] } }],
          }),
        };
      }),
    );

    const service = createDigestGenerationService(
      {
        gemini: { apiKey: "gemini-key", model: "gemini-2.0-flash" },
        openai: { apiKey: "", model: "gpt-4o-mini" },
        groq: { apiKey: "", model: "llama-3.3-70b-versatile" },
      },
      createMockLlmAttemptRepo(),
    );

    await expect(
      service.generateDigest({
        ...baseParams,
        events: sampleEvents,
      }),
    ).rejects.toBeInstanceOf(DigestGenerationError);

    expect(callCount).toBe(1);
  });

  it("includes source event ids from input when LLM succeeds", async () => {
    const llmBody = {
      title: "ChronicleAI Daily Digest — Sources",
      summary: "Multiple venues printed large flow during the session.",
      highlights: ["Swap", "Liquidation", "Gas"],
      analysis: "Cross-venue risk signals concentrated around ETH collateral.",
      confidence: "medium",
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          candidates: [{ content: { parts: [{ text: JSON.stringify(llmBody) }] } }],
        }),
      })),
    );

    const service = createDigestGenerationService(configuredProviders, createMockLlmAttemptRepo());
    const result = await service.generateDigest({
      ...baseParams,
      events: sampleEvents,
    });

    expect(result.sourceEventIds.length).toBe(3);
    expect(result.sourceEventIds).toEqual(["evt-001", "evt-002", "evt-003"]);
  });

  it("precomputes DigestStats from mixed event types", () => {
    const stats = computeDigestStats([
      {
        id: "1",
        eventType: "cex_inflow",
        chainId: 1,
        protocol: "Binance",
        assetSymbols: ["USDC"],
        magnitude: { value: 2_000_000, unit: "USD" },
        transactionHash: null,
        significanceScore: 0.9,
        capturedAt: new Date().toISOString(),
        rawPayload: {
          flowContext: {
            fromRole: "unknown",
            toRole: "exchange",
            toLabel: "Binance",
            direction: "unknown",
          },
        },
      },
      {
        id: "2",
        eventType: "stablecoin_mint",
        chainId: 1,
        protocol: "Circle",
        assetSymbols: ["USDC"],
        magnitude: { value: 10_000_000, unit: "USD" },
        transactionHash: null,
        significanceScore: 0.8,
        capturedAt: new Date().toISOString(),
        rawPayload: {
          flowContext: {
            fromRole: "treasury",
            toRole: "unknown",
            direction: "supply_expand",
          },
        },
      },
      {
        id: "3",
        eventType: "large_swap",
        chainId: 1,
        protocol: "Uniswap V3",
        assetSymbols: ["ETH", "USDC"],
        magnitude: { value: 1_000_000, unit: "USD" },
        transactionHash: null,
        significanceScore: 0.7,
        capturedAt: new Date().toISOString(),
        rawPayload: {
          flowContext: {
            fromRole: "unknown",
            toRole: "unknown",
            direction: "de_risk",
          },
        },
      },
      {
        id: "4",
        eventType: "liquidation",
        chainId: 1,
        protocol: "Aave V3",
        assetSymbols: ["ETH"],
        magnitude: { value: 100_000, unit: "USD" },
        transactionHash: null,
        significanceScore: 0.6,
        capturedAt: new Date().toISOString(),
      },
    ]);

    expect(stats.cexInUsd).toBe(2_000_000);
    expect(stats.mintUsd).toBe(10_000_000);
    expect(stats.swapUsd).toBe(1_000_000);
    expect(stats.liquidationUsd).toBe(100_000);
    expect(stats.liquidationCount).toBe(1);
    expect(stats.netDeRiskUsd).toBe(1_000_000);
  });

  it("embeds DIGEST STATS and section keys in the prompt", () => {
    const prompt = buildDigestPromptForTest({
      ...baseParams,
      events: sampleEvents,
    });
    expect(prompt).toContain("DIGEST STATS");
    expect(prompt).toContain("capitalDirection");
    expect(prompt).toContain("exchangeAndProtocolFlows");
    expect(prompt).toContain("stressBoard");
    expect(prompt).toContain("storyOfTheDay");
    expect(prompt).toContain("coverageNote");
  });

  it("flattens and re-parses digest sections", () => {
    const sections = {
      capitalDirection: "Net de-risk into stables.",
      exchangeAndProtocolFlows: "No qualifying CEX flow today.",
      stressBoard: "Two liquidations, no cluster.",
      storyOfTheDay: "Quiet rotation day.",
      coverageNote: "Swaps under $500k filtered.",
    };
    const analysis = flattenSectionsToAnalysis(sections);
    expect(analysis).toContain("## Capital direction");
    expect(analysis).toContain("## Stress board");
    const parsed = parseSectionsFromAnalysis(analysis);
    expect(parsed?.capitalDirection).toContain("de-risk");
    expect(parsed?.coverageNote).toContain("filtered");
  });

  it("parses sectioned LLM response and flattens into analysis", async () => {
    const llmBody = {
      title: "ChronicleAI Daily Digest — Flow Desk",
      summary: "Mixed capital flows with a CEX print and elevated liquidations.",
      highlights: ["CEX inflow", "Liq cluster", "Quiet mints"],
      analysis: "See sections.",
      sections: {
        capitalDirection: "De-risk bias on the day.",
        exchangeAndProtocolFlows: "Binance saw $2M USDC in.",
        stressBoard: "One liquidation cluster printed.",
        storyOfTheDay: "Stress followed CEX inflow.",
        coverageNote: "Small swaps filtered.",
      },
      confidence: "high",
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          candidates: [{ content: { parts: [{ text: JSON.stringify(llmBody) }] } }],
        }),
      })),
    );

    const service = createDigestGenerationService(configuredProviders, createMockLlmAttemptRepo());
    const result = await service.generateDigest({
      ...baseParams,
      events: sampleEvents,
    });

    expect(result.sections?.capitalDirection).toContain("De-risk");
    expect(result.analysis).toContain("## Capital direction");
    expect(result.analysis).toContain("## Story of the day");
  });
});
