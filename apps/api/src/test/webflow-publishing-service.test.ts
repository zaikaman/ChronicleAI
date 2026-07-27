// Unit tests for Webflow publishing service

import { describe, expect, it } from "vitest";
import { createWebflowPublishingService } from "../services/webflow-publishing-service.ts";

describe("WebflowPublishingService", () => {
  it("handles unconfigured service gracefully", async () => {
    const service = createWebflowPublishingService(undefined, undefined);

    const result = await service.publishDigestArticle({
      title: "Test Digest",
      summary: "Test summary",
      highlights: ["Highlight 1"],
      reportDate: "2026-07-27",
      analysis: undefined,
      registryTxHash: undefined,
    });

    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain("not configured");
  });

  it("handles missing API token gracefully", async () => {
    const service = createWebflowPublishingService(undefined, "coll-123");

    const result = await service.publishDigestArticle({
      title: "Test Digest",
      summary: "Test summary",
      highlights: [],
      reportDate: "2026-07-27",
      analysis: undefined,
      registryTxHash: undefined,
    });

    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain("not configured");
  });

  it("handles missing collection ID gracefully", async () => {
    const service = createWebflowPublishingService("token-123", undefined);

    const result = await service.publishDigestArticle({
      title: "Test Digest",
      summary: "Test summary",
      highlights: [],
      reportDate: "2026-07-27",
      analysis: undefined,
      registryTxHash: undefined,
    });

    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain("not configured");
  });

  it("accepts parameters for a valid publish request", () => {
    const service = createWebflowPublishingService("token-123", "coll-123");

    expect(async () => {
      await service.publishDigestArticle({
        title: "Test Digest",
        summary: "Test summary",
        highlights: ["Highlight 1", "Highlight 2"],
        analysis: "Analysis text",
        reportDate: "2026-07-27",
        registryTxHash: "0xtxhash",
      });
    }).not.toThrow();
  });
});
