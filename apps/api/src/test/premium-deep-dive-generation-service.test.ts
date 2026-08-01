import type { MonitoredEventRow } from "@chronicleai/db";
import { describe, expect, it, vi, afterEach } from "vitest";
import * as langchainAgents from "../agents/langchain/index.ts";
import { createPremiumDeepDiveGenerationService } from "../services/premium-deep-dive-generation-service.ts";

function makeEvent(id: string): MonitoredEventRow {
  return {
    id,
    source: "test",
    source_event_id: id,
    event_type: "large_swap",
    chain_id: 11155111,
    protocol: "Uniswap",
    asset_symbols: ["WETH", "USDC"],
    magnitude: { value: 200_000, unit: "USD" },
    transaction_hash: `0x${id}`,
    observed_at: null,
    captured_at: "2026-07-28T12:00:00.000Z",
    significance_score: 0.9,
    raw_payload: {},
    status: "qualified",
    created_at: "2026-07-28T12:00:00.000Z",
    updated_at: "2026-07-28T12:00:00.000Z",
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createPremiumDeepDiveGenerationService", () => {
  it("falls back to deterministic content when no provider configs", async () => {
    const service = createPremiumDeepDiveGenerationService(null);
    const result = await service.generateNarrative({
      kind: "cluster",
      label: "uniswap",
      events: [makeEvent("e1"), makeEvent("e2")],
      defaultSummaryPublic: "Default teaser",
      fallback: {
        sections: [{ title: "Executive Summary", body: "Fallback body" }],
        analysis: "Fallback analysis",
      },
    });

    expect(result.usedLlm).toBe(false);
    expect(result.generationProvider).toBe("deterministic_fallback");
    expect(result.summaryPublic).toBe("Default teaser");
    expect(result.analysis).toBe("Fallback analysis");
  });

  it("uses first successful LLM provider response", async () => {
    const structured = {
      summaryPublic: "LLM teaser about Uniswap cluster",
      sections: [
        { title: "Executive Summary", body: "LLM executive" },
        { title: "Key Findings", findings: ["Finding A", "Finding B"] },
      ],
      analysis: "LLM deep analysis of the cluster across three swaps.",
      confidence: "high",
    };

    vi.spyOn(langchainAgents, "createChatModel").mockReturnValue({} as never);
    vi.spyOn(langchainAgents, "invokeStructuredAgent").mockResolvedValue({
      structured,
      rawText: JSON.stringify(structured),
      toolCallCount: 0,
    });

    const service = createPremiumDeepDiveGenerationService({
      gemini: { apiKey: "", model: "gemini-test" },
      openai: { apiKey: "", model: "gpt" },
      groq: { apiKey: "test-key", model: "groq-test" },
    });

    const result = await service.generateNarrative({
      kind: "cluster",
      label: "uniswap",
      events: [makeEvent("e1"), makeEvent("e2"), makeEvent("e3")],
      defaultSummaryPublic: "Default teaser",
      fallback: {
        sections: [{ title: "Executive Summary", body: "Fallback" }],
        analysis: "Fallback analysis",
      },
    });

    expect(result.usedLlm).toBe(true);
    expect(result.generationProvider).toBe("groq");
    expect(result.summaryPublic).toContain("LLM teaser");
    expect(result.sections[0]?.body).toBe("LLM executive");
    expect(result.analysis).toContain("LLM deep analysis");
    expect(langchainAgents.invokeStructuredAgent).toHaveBeenCalled();
  });

  it("rejects placeholder content and falls through to OpenAI", async () => {
    const placeholder = {
      summaryPublic: "...",
      sections: [
        { title: "Executive Summary", body: "...", findings: ["...", "..."] },
        { title: "Key Findings", body: "...", findings: ["..."] },
        { title: "Risk Notes", body: "...", findings: ["..."] },
      ],
      analysis: "...",
      confidence: "medium",
    };
    const openAiNarrative = {
      summaryPublic: "Three CoW Protocol swaps formed a concentrated Ethereum flow cluster.",
      sections: [
        {
          title: "Executive Summary",
          body: "Three qualified swaps total roughly $3.1 million and concentrate activity in USDC and WETH.",
          findings: ["The largest event represents the majority of observed notional."],
        },
        {
          title: "Risk Notes",
          body: "The events show concentration, but the supplied fields do not identify the counterparties or intent.",
          findings: ["Treat the cluster as directional flow evidence rather than a confirmed trade thesis."],
        },
      ],
      analysis:
        "The cluster is notable for its notional concentration and short observation window. The available event fields support a flow-composition reading, but they do not establish whether the activity reflects rebalancing, execution routing, or a single coordinated actor.",
      confidence: "medium",
    };

    vi.spyOn(langchainAgents, "createChatModel").mockReturnValue({} as never);
    const invokeSpy = vi
      .spyOn(langchainAgents, "invokeStructuredAgent")
      .mockImplementation(async (params) => {
        if (params.provider === "groq") {
          return {
            structured: placeholder,
            rawText: JSON.stringify(placeholder),
            toolCallCount: 0,
          };
        }
        return {
          structured: openAiNarrative,
          rawText: JSON.stringify(openAiNarrative),
          toolCallCount: 0,
        };
      });

    const service = createPremiumDeepDiveGenerationService({
      gemini: { apiKey: "", model: "gemini-test" },
      openai: { apiKey: "openai-key", model: "gpt-test" },
      groq: { apiKey: "groq-key", model: "groq-test" },
    });

    const result = await service.generateNarrative({
      kind: "cluster",
      label: "cow protocol",
      events: [makeEvent("e1"), makeEvent("e2"), makeEvent("e3")],
      defaultSummaryPublic: "Default teaser",
      fallback: {
        sections: [{ title: "Executive Summary", body: "Fallback" }],
        analysis: "Fallback analysis",
      },
    });

    expect(result.usedLlm).toBe(true);
    expect(result.generationProvider).toBe("openai");
    expect(result.analysis).toContain("notional concentration");
    expect(invokeSpy.mock.calls.map(([params]) => params.provider)).toEqual([
      "groq",
      "openai",
    ]);
  });

  it("falls back when all providers return invalid JSON", async () => {
    vi.spyOn(langchainAgents, "createChatModel").mockReturnValue({} as never);
    vi.spyOn(langchainAgents, "invokeStructuredAgent").mockResolvedValue({
      structured: { not: "valid" },
      rawText: "not json at all",
      toolCallCount: 0,
    });

    const service = createPremiumDeepDiveGenerationService({
      gemini: { apiKey: "g", model: "m" },
      openai: { apiKey: "o", model: "m" },
      groq: { apiKey: "r", model: "m" },
    });

    const result = await service.generateNarrative({
      kind: "cascade",
      label: "aave",
      events: [makeEvent("l1")],
      defaultSummaryPublic: "Cascade teaser",
      fallback: {
        sections: [{ title: "Executive Summary", body: "Det body" }],
        analysis: "Det analysis",
      },
    });

    expect(result.usedLlm).toBe(false);
    expect(result.generationProvider).toBe("deterministic_fallback");
    expect(result.analysis).toBe("Det analysis");
  });
});
