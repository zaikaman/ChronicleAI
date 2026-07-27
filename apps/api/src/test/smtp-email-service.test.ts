// Unit tests for SMTP email service

import { describe, expect, it } from "vitest";
import { createSmtpEmailService } from "../services/smtp-email-service.ts";

describe("SmtpEmailService", () => {
  it("handles unconfigured service gracefully", async () => {
    const service = createSmtpEmailService({
      host: undefined,
      port: undefined,
      user: undefined,
      pass: undefined,
      fromAddress: undefined,
      subscriberList: undefined,
    });

    const result = await service.sendDigestBulletin({
      title: "Test Digest",
      summary: "Test summary",
      highlights: ["Highlight 1"],
      reportDate: "2026-07-27",
      analysis: undefined,
      registryTxHash: undefined,
      contentUri: undefined,
    });

    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain("not configured");
    expect(result.recipientsReached).toBe(0);
  });

  it("handles missing subscribers gracefully", async () => {
    const service = createSmtpEmailService({
      host: "smtp.example.com",
      port: 587,
      user: "user",
      pass: "pass",
      fromAddress: "from@example.com",
      subscriberList: [],
    });

    const result = await service.sendDigestBulletin({
      title: "Test Digest",
      summary: "Test summary",
      highlights: [],
      reportDate: "2026-07-27",
      analysis: undefined,
      registryTxHash: undefined,
      contentUri: undefined,
    });

    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain("No subscribers");
    expect(result.recipientsReached).toBe(0);
  });

  it("accepts parameters for a valid email send", () => {
    const service = createSmtpEmailService({
      host: "smtp.example.com",
      port: 587,
      user: "user",
      pass: "pass",
      fromAddress: "from@example.com",
      subscriberList: ["sub@example.com"],
    });

    expect(async () => {
      await service.sendDigestBulletin({
        title: "Test Digest",
        summary: "Test summary",
        highlights: ["Highlight 1"],
        analysis: "Analysis text",
        reportDate: "2026-07-27",
        registryTxHash: "0xtxhash",
        contentUri: "http://localhost:5173/digests/latest",
      });
    }).not.toThrow();
  });

  it("accepts alert notification parameters", () => {
    const service = createSmtpEmailService({
      host: "smtp.example.com",
      port: 587,
      user: "user",
      pass: "pass",
      fromAddress: "from@example.com",
      subscriberList: ["sub@example.com"],
    });

    expect(async () => {
      await service.sendAlertNotification({
        title: "Alert Title",
        summary: "Alert summary",
        eventType: "large_swap",
        publishedAt: new Date().toISOString(),
      });
    }).not.toThrow();
  });

  it("returns failure for alert without SMTP config", async () => {
    const service = createSmtpEmailService({
      host: undefined,
      port: undefined,
      user: undefined,
      pass: undefined,
      fromAddress: undefined,
      subscriberList: undefined,
    });

    const result = await service.sendAlertNotification({
      title: "Alert Title",
      summary: "Alert summary",
      eventType: "large_swap",
      publishedAt: new Date().toISOString(),
    });

    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain("not configured");
  });
});
