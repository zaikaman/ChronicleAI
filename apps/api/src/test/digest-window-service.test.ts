// Unit tests for digest window service

import type { DailyDigestRepository } from "@chronicleai/db";
import { describe, expect, it } from "vitest";
import { createDigestWindowService } from "../services/digest-window-service.ts";

function createMockDigestRepo(existingWindow?: {
  periodStart: string;
  periodEnd: string;
}): DailyDigestRepository {
  return {
    async findByWindow(periodStart: string, periodEnd: string) {
      if (
        existingWindow &&
        existingWindow.periodStart === periodStart &&
        existingWindow.periodEnd === periodEnd
      ) {
        return {
          id: "existing-digest-id",
          report_date: "2026-07-06",
          period_start: periodStart,
          period_end: periodEnd,
          title: "Existing Digest",
          summary: "Already exists",
          highlights: ["test"],
          analysis: null,
          source_event_ids: [],
          audience: "public",
          publication_status: "published" as const,
          published_at: new Date().toISOString(),
          registry_tx_hash: null,
          keeper_hub_run_id: null,
          explorer_url: null,
          source_event_root: null,
          content_uri: null,
          content_hash: null,
          gas_used: null,
          gas_used_wei: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
      }
      return null;
    },
  } as DailyDigestRepository;
}

describe("DigestWindowService", () => {
  it("validates a valid window", () => {
    const repo = createMockDigestRepo();
    const service = createDigestWindowService(repo);

    const now = Date.now();
    const result = service.validateWindow({
      periodStart: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
      periodEnd: new Date(now).toISOString(),
    });

    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("rejects window with periodStart after periodEnd", () => {
    const repo = createMockDigestRepo();
    const service = createDigestWindowService(repo);

    const now = Date.now();
    const result = service.validateWindow({
      periodStart: new Date(now).toISOString(),
      periodEnd: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toContain("periodStart must be before periodEnd");
  });

  it("rejects window with invalid dates", () => {
    const repo = createMockDigestRepo();
    const service = createDigestWindowService(repo);

    const result = service.validateWindow({
      periodStart: "not-a-date",
      periodEnd: "also-not-a-date",
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toContain("valid ISO date");
  });

  it("rejects missing periodStart", () => {
    const repo = createMockDigestRepo();
    const service = createDigestWindowService(repo);

    const result = service.validateWindow({
      periodStart: "",
      periodEnd: new Date().toISOString(),
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toContain("required");
  });

  it("rejects window exceeding max duration", () => {
    const repo = createMockDigestRepo();
    const service = createDigestWindowService(repo);

    const result = service.validateWindow({
      periodStart: new Date(Date.now() - 100 * 60 * 60 * 1000).toISOString(),
      periodEnd: new Date().toISOString(),
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toContain("exceeds maximum duration");
  });

  it("rejects future window", () => {
    const repo = createMockDigestRepo();
    const service = createDigestWindowService(repo);

    const result = service.validateWindow({
      periodStart: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      periodEnd: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toContain("future");
  });

  it("detects duplicate window", async () => {
    const now = Date.now();
    const periodStart = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const periodEnd = new Date(now).toISOString();

    const repo = createMockDigestRepo({ periodStart, periodEnd });
    const service = createDigestWindowService(repo);

    const result = await service.checkDuplicate({ periodStart, periodEnd });

    expect(result.valid).toBe(false);
    expect(result.reason).toContain("already exists");
    expect(result.existingDigestId).toBe("existing-digest-id");
    expect(result.existingPublicationStatus).toBe("published");
    expect(result.existingDigest?.id).toBe("existing-digest-id");
    expect(result.existingDigest?.publicationStatus).toBe("published");
    expect(result.existingDigest?.title).toBe("Existing Digest");
  });

  it("passes duplicate check for unique window", async () => {
    const repo = createMockDigestRepo();
    const service = createDigestWindowService(repo);

    const now = Date.now();
    const result = await service.checkDuplicate({
      periodStart: new Date(now - 48 * 60 * 60 * 1000).toISOString(),
      periodEnd: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
    });

    expect(result.valid).toBe(true);
  });
});
