/**
 * LangChain model factory + structured schema contracts.
 * Guards OpenAI strict json_schema compatibility, Gemini base URL normalization,
 * and Groq JSON Object Mode (no json_schema) structured extraction.
 */

import { describe, expect, it, vi } from "vitest";
import { toJsonSchema } from "@langchain/core/utils/json_schema";
import { LLM_FALLBACK_ORDER } from "@chronicleai/config";
import {
  alertContentSchema,
  deskProposalSchema,
  digestContentSchema,
  estimateTokens,
  failureClassificationSchema,
  fitPromptToTokenBudget,
  invokeStructuredAgent,
  normalizeGeminiBaseUrl,
  premiumNarrativeSchema,
  signalFusionSchema,
  ticketNarrativeSchema,
} from "../agents/langchain/index.ts";

function assertStrictObjectSchema(schema: Record<string, unknown>, path = "root"): void {
  expect(schema.type, `${path} type`).toBe("object");
  expect(schema.additionalProperties, `${path} additionalProperties`).toBe(false);

  const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
  expect(properties, `${path} properties`).toBeTruthy();
  const keys = Object.keys(properties ?? {});
  const required = schema.required as string[] | undefined;
  expect(required, `${path} required`).toBeTruthy();
  expect([...(required ?? [])].sort(), `${path} required covers all keys`).toEqual(
    [...keys].sort(),
  );

  for (const [key, prop] of Object.entries(properties ?? {})) {
    if (prop.type === "object" || (Array.isArray(prop.anyOf) && prop.anyOf.some((p: { type?: string }) => p.type === "object"))) {
      if (prop.type === "object") {
        assertStrictObjectSchema(prop, `${path}.${key}`);
      }
    }
    if (prop.type === "array" && prop.items && typeof prop.items === "object") {
      const items = prop.items as Record<string, unknown>;
      if (items.type === "object") {
        assertStrictObjectSchema(items, `${path}.${key}[]`);
      }
    }
  }
}

describe("normalizeGeminiBaseUrl", () => {
  it("strips trailing /v1beta so the Google SDK does not double the path", () => {
    expect(normalizeGeminiBaseUrl("https://v98store.com/v1beta")).toBe(
      "https://v98store.com",
    );
    expect(normalizeGeminiBaseUrl("https://v98store.com/v1beta/")).toBe(
      "https://v98store.com",
    );
  });

  it("strips trailing /v1 and bare trailing slashes", () => {
    expect(normalizeGeminiBaseUrl("https://proxy.example/v1")).toBe(
      "https://proxy.example",
    );
    expect(normalizeGeminiBaseUrl("https://generativelanguage.googleapis.com/")).toBe(
      "https://generativelanguage.googleapis.com",
    );
  });

  it("returns undefined for blank input", () => {
    expect(normalizeGeminiBaseUrl(undefined)).toBeUndefined();
    expect(normalizeGeminiBaseUrl("")).toBeUndefined();
    expect(normalizeGeminiBaseUrl("   ")).toBeUndefined();
  });
});

describe("structured response schemas are OpenAI-strict compatible", () => {
  const schemas = {
    alertContentSchema,
    digestContentSchema,
    premiumNarrativeSchema,
    deskProposalSchema,
    failureClassificationSchema,
    signalFusionSchema,
    ticketNarrativeSchema,
  } as const;

  for (const [name, zodSchema] of Object.entries(schemas)) {
    it(`${name} has every property required`, () => {
      const json = toJsonSchema(zodSchema) as Record<string, unknown>;
      assertStrictObjectSchema(json, name);
    });
  }

  it("deskProposalSchema allows null strategy", () => {
    const json = toJsonSchema(deskProposalSchema) as {
      properties: { strategy: Record<string, unknown> };
    };
    expect(json.properties.strategy).toMatchObject({
      anyOf: expect.arrayContaining([
        expect.objectContaining({ type: "null" }),
      ]),
    });
  });

  it("deskProposalSchema requires version:1 (prompt emits it; additionalProperties is false)", () => {
    const json = toJsonSchema(deskProposalSchema) as {
      properties: { version: Record<string, unknown> };
      required: string[];
      additionalProperties: boolean;
    };
    expect(json.additionalProperties).toBe(false);
    expect(json.required).toContain("version");
    expect(json.properties.version).toMatchObject({
      const: 1,
      type: "number",
    });

    // Mirrors the Heroku failure mode: Gemini followed the prompt and included
    // version, but the old schema rejected it under providerStrategy validation.
    const withVersion = deskProposalSchema.safeParse({
      version: 1,
      action: "propose",
      strategy: "yield_rotation",
      notionalUsdc: 15,
      priority: 0.8,
      confidence: 0.9,
      thesis: "The current freeUsdc of 8.37 is below the inventory floor.",
      riskNotes: [],
      legsHint: ["aave_withdraw_link", "link_to_usdc"],
      declineReasons: [],
    });
    expect(withVersion.success).toBe(true);

    const withoutVersion = deskProposalSchema.safeParse({
      action: "propose",
      strategy: "yield_rotation",
      notionalUsdc: 15,
      priority: 0.8,
      confidence: 0.9,
      thesis: "The current freeUsdc of 8.37 is below the inventory floor.",
      riskNotes: [],
      legsHint: ["aave_withdraw_link", "link_to_usdc"],
      declineReasons: [],
    });
    expect(withoutVersion.success).toBe(false);
  });
});

describe("LLM fallback order", () => {
  it("is Gemini → Groq → OpenAI", () => {
    expect(LLM_FALLBACK_ORDER).toEqual(["gemini", "groq", "openai"]);
  });
});

describe("invokeStructuredAgent groq JSON Object Mode", () => {
  it("uses response_format json_object and validates with Zod (not json_schema)", async () => {
    const proposal = {
      version: 1 as const,
      action: "hold" as const,
      strategy: null,
      notionalUsdc: 0,
      priority: 0,
      confidence: 0.5,
      thesis: "No actionable edge.",
      riskNotes: [] as string[],
      legsHint: [] as string[],
      declineReasons: ["no_edge"] as string[],
    };

    const withConfig = vi.fn((config: Record<string, unknown>) => {
      expect(config).toEqual({
        response_format: { type: "json_object" },
      });
      return {
        invoke: vi.fn(async () => ({
          content: JSON.stringify(proposal),
        })),
      };
    });

    const model = {
      withConfig,
      invoke: vi.fn(async () => {
        throw new Error("unbound invoke should not be used for groq");
      }),
    };

    const result = await invokeStructuredAgent({
      model: model as never,
      systemPrompt: "You are the desk agent.",
      userPrompt: "Propose an action.",
      responseFormat: deskProposalSchema,
      provider: "groq",
    });

    expect(withConfig).toHaveBeenCalledOnce();
    expect(result.structured).toMatchObject(proposal);
    expect(result.toolCallCount).toBe(0);
  });

  it("rejects invalid groq JSON against the schema", async () => {
    const model = {
      withConfig: () => ({
        invoke: vi.fn(async () => ({
          content: JSON.stringify({ action: "hold" }),
        })),
      }),
    };

    await expect(
      invokeStructuredAgent({
        model: model as never,
        systemPrompt: "sys",
        userPrompt: "user",
        responseFormat: deskProposalSchema,
        provider: "groq",
      }),
    ).rejects.toThrow(/schema validation/i);
  });

  it("fitPromptToTokenBudget truncates prompt when userPrompt exceeds token limit", () => {
    const systemPrompt = "System prompt context";
    const userPrompt = "A".repeat(30000); // 30,000 chars ≈ 9,375 tokens
    const schemaHint = "Schema hint context";

    const fitted = fitPromptToTokenBudget(userPrompt, systemPrompt, schemaHint, 6000);
    expect(estimateTokens(fitted + systemPrompt + schemaHint)).toBeLessThanOrEqual(6100);
    expect(fitted).toContain("[Context truncated");
  });

  it("fitPromptToTokenBudget preserves prompt when within token budget", () => {
    const systemPrompt = "System prompt";
    const userPrompt = "Normal small user prompt";
    const fitted = fitPromptToTokenBudget(userPrompt, systemPrompt, "", 6000);
    expect(fitted).toBe(userPrompt);
  });
});
