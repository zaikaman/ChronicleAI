/**
 * LangChain model factory + structured schema contracts.
 * Guards OpenAI strict json_schema compatibility and Gemini base URL normalization.
 */

import { describe, expect, it } from "vitest";
import { toJsonSchema } from "@langchain/core/utils/json_schema";
import {
  alertContentSchema,
  deskProposalSchema,
  digestContentSchema,
  failureClassificationSchema,
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
});
