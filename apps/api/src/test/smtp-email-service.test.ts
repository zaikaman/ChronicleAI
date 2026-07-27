// Unit tests for SMTP email service (DB-backed recipient resolution)

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
      resolveRecipients: async () => ["sub@example.com"],
    });

    const result = await service.sendDigestBulletin({
      title: "Test Digest",
      summary: "Test summary",
      highlights: ["Highlight 1"],
      reportDate: "2026-07-07",
      analysis: undefined,
      registryTxHash: undefined,
      contentUri: undefined,
    });

    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain("not configured");
    expect(result.recipientsReached).toBe(0);
  });

  it("treats zero active subscribers as success with zero reached", async () => {
    const service = createSmtpEmailService({
      host: "smtp.example.com",
      port: 587,
      user: "user",
      pass: "pass",
      fromAddress: "from@example.com",
      resolveRecipients: async () => [],
    });

    const result = await service.sendDigestBulletin({
      title: "Test Digest",
      summary: "Test summary",
      highlights: [],
      reportDate: "2026-07-07",
      analysis: undefined,
      registryTxHash: undefined,
      contentUri: undefined,
    });

    expect(result.success).toBe(true);
    expect(result.recipientsReached).toBe(0);
  });

  it("surfaces subscriber resolution failures", async () => {
    const service = createSmtpEmailService({
      host: "smtp.example.com",
      port: 587,
      user: "user",
      pass: "pass",
      fromAddress: "from@example.com",
      resolveRecipients: async () => {
        throw new Error("database unavailable");
      },
    });

    const result = await service.sendDigestBulletin({
      title: "Test Digest",
      summary: "Test summary",
      highlights: [],
      reportDate: "2026-07-07",
      analysis: undefined,
      registryTxHash: undefined,
      contentUri: undefined,
    });

    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain("database unavailable");
  });

  it("requests digest channel when sending a digest", async () => {
    const channels: string[] = [];
    const service = createSmtpEmailService({
      host: "smtp.example.com",
      port: 587,
      user: "user",
      pass: "pass",
      fromAddress: "from@example.com",
      resolveRecipients: async (channel) => {
        channels.push(channel);
        return [];
      },
    });

    await service.sendDigestBulletin({
      title: "Test Digest",
      summary: "Test summary",
      highlights: ["Highlight 1"],
      analysis: "Analysis text",
      reportDate: "2026-07-07",
      registryTxHash: "0xtxhash",
      contentUri: "http://localhost:5173/digests/latest",
    });

    expect(channels).toEqual(["digest"]);
  });

  it("requests alert channel when sending an alert", async () => {
    const channels: string[] = [];
    const service = createSmtpEmailService({
      host: "smtp.example.com",
      port: 587,
      user: "user",
      pass: "pass",
      fromAddress: "from@example.com",
      resolveRecipients: async (channel) => {
        channels.push(channel);
        return [];
      },
    });

    await service.sendAlertNotification({
      title: "Alert Title",
      summary: "Alert summary",
      eventType: "large_swap",
      publishedAt: new Date().toISOString(),
    });

    expect(channels).toEqual(["alert"]);
  });

  it("returns failure for alert without SMTP config", async () => {
    const service = createSmtpEmailService({
      host: undefined,
      port: undefined,
      user: undefined,
      pass: undefined,
      fromAddress: undefined,
      resolveRecipients: async () => ["sub@example.com"],
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
