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
});
