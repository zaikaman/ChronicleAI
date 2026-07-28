// Unit tests for digest generation service (LLM multi-provider + template fallback)

import { describe, expect, it, vi, afterEach } from "vitest";
import { createDigestGenerationService } from "../services/digest-generation-service.ts";
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

/** Template path (no provider configs) — used for deterministic ranking tests. */
const templateService = createDigestGenerationService();

describe("DigestGenerationService", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("generates a digest with ranked highlights from events (template path)", async () => {
    const result = await templateService.generateDigest({
      reportDate: "2026-07-07",
      periodStart: new Date(Date.now() - 86400000).toISOString(),
      periodEnd: new Date().toISOString(),
      events: sampleEvents,
    });

    expect(result.title).toContain("ChronicleAI Daily Digest");
    expect(result.summary).toBeTruthy();
    expect(result.highlights.length).toBeGreaterThanOrEqual(3);
    expect(result.sourceEventIds).toContain("evt-001");
    expect(result.confidence).toBe("high");
    expect(result.generationProvider).toBe("template");
  });

  it("generates a no-major-events digest when no events exist", async () => {
    const result = await templateService.generateDigest({
      reportDate: "2026-07-07",
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
    const result = await templateService.generateDigest({
      reportDate: "2026-07-07",
      periodStart: new Date(Date.now() - 86400000).toISOString(),
      periodEnd: new Date().toISOString(),
      events: sampleEvents,
    });

    expect(result.sourceEventIds.length).toBe(3);
  });

  it("separates analysis from facts", async () => {
    const result = await templateService.generateDigest({
      reportDate: "2026-07-07",
      periodStart: new Date(Date.now() - 86400000).toISOString(),
      periodEnd: new Date().toISOString(),
      events: sampleEvents,
    });

    expect(result.summary).toBeTruthy();
    expect(typeof result.analysis).toBe("string");
    expect(result.analysis!.length).toBeGreaterThan(50);
  });

  it("produces consistent output for the same input (template path)", async () => {
    const result1 = await templateService.generateDigest({
      reportDate: "2026-07-07",
      periodStart: new Date(Date.now() - 86400000).toISOString(),
      periodEnd: new Date().toISOString(),
      events: sampleEvents,
    });

    const result2 = await templateService.generateDigest({
      reportDate: "2026-07-07",
      periodStart: new Date(Date.now() - 86400000).toISOString(),
      periodEnd: new Date().toISOString(),
      events: sampleEvents,
    });

    expect(result1.title).toBe(result2.title);
    expect(result1.sourceEventIds).toEqual(result2.sourceEventIds);
  });

  it("ranks events by significance score descending (template path)", async () => {
    const highScoreEvent = {
      ...sampleEvents[0]!,
      id: "high",
      significanceScore: 0.9,
    };
    const mediumScoreEvent = {
      ...sampleEvents[0]!,
      id: "medium",
      significanceScore: 0.5,
    };
    const lowScoreEvent = {
      ...sampleEvents[0]!,
      id: "low",
      significanceScore: 0.1,
    };

    const events = [lowScoreEvent, highScoreEvent, mediumScoreEvent];

    const result = await templateService.generateDigest({
      reportDate: "2026-07-07",
      periodStart: new Date(Date.now() - 86400000).toISOString(),
      periodEnd: new Date().toISOString(),
      events,
    });

    expect(result.highlights.length).toBe(3);
    expect(result.highlights[0]).toContain("significance: 90%");
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
          entity_type: data.entity_type,
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
      reportDate: "2026-07-07",
      periodStart: new Date(Date.now() - 86400000).toISOString(),
      periodEnd: new Date().toISOString(),
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

  it("falls back to template when all LLM providers fail", async () => {
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

    const result = await service.generateDigest({
      reportDate: "2026-07-07",
      periodStart: new Date(Date.now() - 86400000).toISOString(),
      periodEnd: new Date().toISOString(),
      events: sampleEvents,
    });

    expect(result.generationProvider).toBe("template");
    expect(result.title).toContain("ChronicleAI Daily Digest");
    expect(result.highlights.length).toBeGreaterThanOrEqual(3);
    expect(result.sourceEventIds).toContain("evt-001");
  });

  it("skips providers with empty API keys and falls back to template", async () => {
    const service = createDigestGenerationService(
      emptyProviderConfigs,
      createMockLlmAttemptRepo(),
    );

    const result = await service.generateDigest({
      reportDate: "2026-07-07",
      periodStart: new Date(Date.now() - 86400000).toISOString(),
      periodEnd: new Date().toISOString(),
      events: sampleEvents,
    });

    expect(result.generationProvider).toBe("template");
    expect(result.summary).toBeTruthy();
  });

  it("falls through invalid Gemini JSON and lands on template when later keys are empty", async () => {
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

    const result = await service.generateDigest({
      reportDate: "2026-07-07",
      periodStart: new Date(Date.now() - 86400000).toISOString(),
      periodEnd: new Date().toISOString(),
      events: sampleEvents,
    });

    expect(callCount).toBe(1);
    expect(result.generationProvider).toBe("template");
    expect(result.highlights.length).toBeGreaterThanOrEqual(3);
  });
});

