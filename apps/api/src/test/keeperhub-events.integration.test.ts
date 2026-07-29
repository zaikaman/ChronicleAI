// Integration tests for KeeperHub event ingestion flow

import { describe, expect, it, vi } from "vitest";

describe("KeeperHub Event Ingestion - Integration", () => {
  // These tests verify the orchestration flow without needing a real database

  it("creates monitored event repository successfully", async () => {
    const { createMonitoredEventRepository } = await import("@chronicleai/db");

    const mockSupabase = {
      from: () => ({
        insert: () => ({
          data: [{ id: "test-id-1" }],
          error: null,
          select: () => ({
            single: () => Promise.resolve({ data: { id: "test-id-1" }, error: null }),
          }),
        }),
        select: () => ({
          eq: () => Promise.resolve({ data: [], error: null }),
          order: () => Promise.resolve({ data: [], error: null }),
          limit: () => Promise.resolve({ data: [], error: null }),
          single: () => Promise.resolve({ data: null, error: null }),
          range: () => Promise.resolve({ data: [], error: null }),
        }),
        update: () => ({
          eq: () => ({
            select: () => ({
              single: () => Promise.resolve({ data: { id: "test-id" }, error: null }),
            }),
          }),
        }),
        eq: () => ({
          order: () => ({
            range: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
      }),
    };

    const repo = createMonitoredEventRepository(mockSupabase as never);
    expect(repo).toBeDefined();
    expect(typeof repo.create).toBe("function");
    expect(typeof repo.findBySourceAndEventId).toBe("function");
    expect(typeof repo.updateStatus).toBe("function");
  });

  it("creates public alert repository successfully", async () => {
    const { createPublicAlertRepository } = await import("@chronicleai/db");

    function mockInsert() {
      return {
        select: () => ({
          single: async () => ({ data: { id: "test-id" }, error: null }),
        }),
      };
    }

    const mockSupabase = {
      from: () => ({
        insert: () => mockInsert(),
        select: () => ({
          eq: () => Promise.resolve({ data: [], error: null }),
          order: () => Promise.resolve({ data: [], error: null }),
          limit: () => Promise.resolve({ data: [], error: null }),
          single: () => Promise.resolve({ data: { id: "test-id" }, error: null }),
        }),
        update: () => ({
          eq: () => ({
            select: () => ({
              single: () => Promise.resolve({ data: { id: "test-id" }, error: null }),
            }),
          }),
        }),
      }),
    };

    const repo = createPublicAlertRepository(mockSupabase as never);
    expect(repo).toBeDefined();
    expect(typeof repo.findByDedupeKey).toBe("function");
    expect(typeof repo.list).toBe("function");
  });

  it("qualifying event qualification returns correct result", async () => {
    const { createEventQualificationService } = await import(
      "../services/event-qualification-service.ts"
    );

    const service = createEventQualificationService();

    const result = service.qualify({
      eventType: "large_swap",
      magnitude: { value: 2_500_000, unit: "USD" },
      chainId: 1,
    });

    expect(result.qualified).toBe(true);
    expect(result.score).toBeGreaterThan(0.5);
  });

  it("ignored event qualification returns ignored correctly", async () => {
    const { createEventQualificationService } = await import(
      "../services/event-qualification-service.ts"
    );

    const service = createEventQualificationService();

    const result = service.qualify({
      eventType: "large_swap",
      magnitude: { value: 100, unit: "USD" },
      chainId: 1,
    });

    expect(result.qualified).toBe(false);
  });

  it("generates deterministic dedupe keys for same sourceEventId", async () => {
    const { createAlertDedupeService } = await import("../services/alert-dedupe-service.ts");

    const service = createAlertDedupeService();

    const key1 = service.generateDedupeKey({
      sourceEventId: "test-001",
      source: "keeperhub",
      eventType: "liquidation",
    });

    const key2 = service.generateDedupeKey({
      sourceEventId: "test-001",
      source: "keeperhub",
      eventType: "liquidation",
    });

    expect(key1).toBe(key2);
  });

  it("all providers fail does not produce alert content", async () => {
    const langchainAgents = await import("../agents/langchain/index.ts");
    vi.spyOn(langchainAgents, "createChatModel").mockReturnValue({} as never);
    vi.spyOn(langchainAgents, "invokeStructuredAgent").mockRejectedValue(
      new Error("Mock network failure"),
    );

    const { createPublicAlertContentService } = await import(
      "../services/public-alert-content-service.ts"
    );
    const { createLLMGenerationAttemptRepository } = await import("@chronicleai/db");

    function mockInsert() {
      return {
        select: () => ({
          single: async () => ({ data: { id: "test-attempt" }, error: null }),
        }),
      };
    }

    const mockSupabase = {
      from: () => ({
        insert: () => mockInsert(),
        select: () => ({
          eq: () => ({
            order: () => Promise.resolve({ data: [], error: null }),
            limit: () => Promise.resolve({ data: [], error: null }),
          }),
          order: () => Promise.resolve({ data: [], error: null }),
          limit: () => Promise.resolve({ data: [], error: null }),
          single: () => Promise.resolve({ data: { id: "test-attempt" }, error: null }),
        }),
      }),
    };

    const llmAttemptRepo = createLLMGenerationAttemptRepository(mockSupabase as never);

    const service = createPublicAlertContentService(
      {
        gemini: { apiKey: "gemini_key", model: "gemini-2.0-flash" },
        openai: { apiKey: "openai_key", model: "gpt-4o-mini" },
        groq: { apiKey: "groq_key", model: "llama-3.3-70b-versatile" },
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
    expect(result.content).toBeUndefined();
    expect(result.attempts.length).toBeGreaterThanOrEqual(1);
  });
});
