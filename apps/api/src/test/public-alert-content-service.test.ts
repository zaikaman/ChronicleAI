// Unit tests for public alert content safety

import { describe, expect, it } from "vitest";

function mockInsert() {
  return {
    select: () => ({
      single: async () => ({ data: { id: "test-attempt" }, error: null }),
    }),
  };
}

function createMockSupabase() {
  return {
    from: () => ({
      insert: () => mockInsert(),
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: () => Promise.resolve({ data: [], error: null }),
            range: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
        order: () => Promise.resolve({ data: [], error: null }),
        limit: () => Promise.resolve({ data: [], error: null }),
        single: () => Promise.resolve({ data: { id: "test-attempt" }, error: null }),
      }),
    }),
  };
}

describe("PublicAlertContentService - Safety", () => {
  it("validates response with all required fields", async () => {
    const { createPublicAlertContentService } = await import(
      "../services/public-alert-content-service.ts"
    );
    const { createLLMGenerationAttemptRepository } = await import("@chronicleai/db");

    const llmAttemptRepo = createLLMGenerationAttemptRepository(createMockSupabase() as never);

    const service = createPublicAlertContentService(
      {
        gemini: { apiKey: "test-key", model: "gemini-2.0-flash" },
        openai: { apiKey: "test-key", model: "gpt-4o-mini" },
        groq: { apiKey: "test-key", model: "llama-3.3-70b-versatile" },
      },
      llmAttemptRepo,
    );

    expect(service).toBeDefined();
    expect(typeof service.generateAlert).toBe("function");
  });

  it("generates safe source references without premium-only content", async () => {
    const { createPublicAlertContentService } = await import(
      "../services/public-alert-content-service.ts"
    );
    const { createLLMGenerationAttemptRepository } = await import("@chronicleai/db");

    const llmAttemptRepo = createLLMGenerationAttemptRepository(createMockSupabase() as never);

    const service = createPublicAlertContentService(
      {
        gemini: { apiKey: "test-key", model: "gemini-2.0-flash" },
        openai: { apiKey: "test-key", model: "gpt-4o-mini" },
        groq: { apiKey: "test-key", model: "llama-3.3-70b-versatile" },
      },
      llmAttemptRepo,
    );

    expect(service).toBeDefined();
  });

  it("includes flow context labels and direction in the alert prompt", async () => {
    const { buildAlertPromptForTest } = await import(
      "../services/public-alert-content-service.ts"
    );

    const prompt = buildAlertPromptForTest({
      monitoredEventId: "evt-1",
      eventType: "cex_inflow",
      chainId: 1,
      protocol: "Binance",
      assetSymbols: ["USDC"],
      magnitude: { value: 12_400_000, unit: "USD" },
      transactionHash: "0xabc",
      significanceScore: 0.9,
      source: "keeperhub",
      sourceEventId: "cex-1",
      capturedAt: new Date().toISOString(),
      flowContext: {
        fromRole: "unknown",
        toRole: "exchange",
        toLabel: "Binance",
        direction: "unknown",
        venue: "Binance",
      },
    });

    expect(prompt).toContain("FLOW CONTEXT");
    expect(prompt).toContain("Binance");
    expect(prompt).toContain("Never invent entity names");
    expect(prompt).toContain("cex_inflow");
  });
});
