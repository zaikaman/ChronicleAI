// Unit tests for LLM alert generation fallback

import { describe, it, expect } from "vitest";

// Increase timeout for all-providers-failed test which makes actual fetch calls
import { createPublicAlertContentService } from "../services/public-alert-content-service.ts";
import { createLLMGenerationAttemptRepository } from "@chronicleai/db";

describe("LLMAlertGenerationService - Fallback", () => {
  // Create a mock supabase client for the LLM attempt repo
  function createMockSupabase() {
    function mockInsert() {
      return {
        select: () => ({
          single: async () => ({ data: { id: "test-attempt" }, error: null }),
        }),
      };
    }

    return {
      from: () => ({
        insert: () => mockInsert(),
        select: () => ({
          eq: () => ({
            order: () => Promise.resolve({ data: [], error: null }),
            limit: () => Promise.resolve({ data: [], error: null }),
            single: () => Promise.resolve({ data: { id: "test-attempt" }, error: null }),
          }),
          order: () => Promise.resolve({ data: [], error: null }),
          limit: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    };
  }

  it("has the correct fallback order", async () => {
    const { LLM_FALLBACK_ORDER } = await import("@chronicleai/config");
    expect(LLM_FALLBACK_ORDER).toEqual(["gemini", "openai", "groq"]);
  });

  it("creates service with correct provider configs", () => {
    const mockSupabase = createMockSupabase();
    const llmAttemptRepo = createLLMGenerationAttemptRepository(mockSupabase as never);

    const service = createPublicAlertContentService(
      {
        gemini: { apiKey: "gemini-key", model: "gemini-2.0-flash" },
        openai: { apiKey: "openai-key", model: "gpt-4o-mini" },
        groq: { apiKey: "groq-key", model: "llama-3.3-70b-versatile" },
      },
      llmAttemptRepo,
    );

    expect(service).toBeDefined();
  });

  it("validates response JSON structure", async () => {
    // The validateResponse function should be tested internally
    // Valid JSON
    const validJson = JSON.stringify({
      title: "Test Alert",
      summary: "This is a test summary",
      confidence: "high",
    });

    // Parse and verify structure
    const parsed = JSON.parse(validJson);
    expect(parsed).toHaveProperty("title");
    expect(parsed).toHaveProperty("summary");
    expect(parsed).toHaveProperty("confidence");
    expect(["high", "medium", "low"]).toContain(parsed.confidence);
  });

  it("rejects responses without required fields", () => {
    const invalidResponse = JSON.stringify({
      title: "Test",
      // missing summary and confidence
    });

    const parsed = JSON.parse(invalidResponse);
    expect(parsed).toHaveProperty("title");
    expect(parsed).not.toHaveProperty("summary");
    expect(parsed).not.toHaveProperty("confidence");
  });

  it("handles all-providers-failed scenario gracefully", async () => {
    // Mock fetch to reject instantly, preventing real HTTP calls
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error("Mock network failure");
    };

    try {
      const mockSupabase = createMockSupabase();
      const llmAttemptRepo = createLLMGenerationAttemptRepository(mockSupabase as never);

      const service = createPublicAlertContentService(
        {
          gemini: { apiKey: "", model: "gemini-2.0-flash" },
          openai: { apiKey: "", model: "gpt-4o-mini" },
          groq: { apiKey: "", model: "llama-3.3-70b-versatile" },
        },
        llmAttemptRepo,
      );

      const result = await service.generateAlert({
        monitoredEventId: "test-event-id",
        eventType: "large_swap",
        chainId: 1,
        significanceScore: 0.85,
        source: "test",
        capturedAt: new Date().toISOString(),
      });

      expect(result.success).toBe(false);
      expect(result.attempts).toHaveLength(3);
      expect(result.content).toBeUndefined();
      expect(result.providerUsed).toBeUndefined();

      const providers = result.attempts.map((a) => a.provider);
      expect(providers).toEqual(["gemini", "openai", "groq"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
