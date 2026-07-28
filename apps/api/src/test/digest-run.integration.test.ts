// Integration tests for digest run

import type {
  DailyDigestInsert,
  DailyDigestRepository,
  DailyDigestRow,
  ExecutionLogInsert,
  ExecutionLogRepository,
  MonitoredEventRepository,
} from "@chronicleai/db";
import { describe, expect, it } from "vitest";
import { DigestRunHandler } from "../keeperhub/digest-run-handler.ts";
import { createChronicleRegistryService } from "../services/chronicle-registry-service.ts";
import { createDigestEventSelectionService } from "../services/digest-event-selection-service.ts";
import type { DigestGenerationService } from "../services/digest-generation-service.ts";
import { createDigestPublicationService } from "../services/digest-publication-service.ts";
import { createDigestWindowService } from "../services/digest-window-service.ts";
import { createSmtpEmailService } from "../services/smtp-email-service.ts";

function makeDigestRow(overrides: Partial<DailyDigestRow> = {}): DailyDigestRow {
  return {
    id: "digest-test-001",
    report_date: "2026-07-07",
    period_start: new Date().toISOString(),
    period_end: new Date().toISOString(),
    title: "Test Digest",
    summary: "Test summary",
    highlights: ["test"],
    analysis: null,
    source_event_ids: [],
    audience: "public",
    publication_status: "draft" as const,
    published_at: null,
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
    ...overrides,
  };
}

describe("DigestRunHandler", () => {
  // Capture create payloads for status/CHECK assertions (loose bag avoids CFA traps).
  const createCapture: { payload: Record<string, unknown> | null } = {
    payload: null,
  };

  // Create mock repositories for testing
  const mockDigestRepo: DailyDigestRepository = {
    async create(data: DailyDigestInsert) {
      createCapture.payload = data as unknown as Record<string, unknown>;
      return { ok: true, value: makeDigestRow() };
    },
    async findById() {
      return { ok: true, value: makeDigestRow() };
    },
    async findByWindow() {
      return null;
    },
    async findLatestPublic() {
      return { ok: true, value: null };
    },
    async updatePublicationStatus(id, status, publishedAt) {
      return {
        ok: true,
        value: makeDigestRow({
          id,
          publication_status: status as DailyDigestRow["publication_status"],
          published_at: publishedAt ?? null,
        }),
      };
    },
    async updateRegistryMetadata(id, _metadata) {
      return { ok: true, value: makeDigestRow({ id }) };
    },
    async list() {
      return { ok: true, value: [] };
    },
  };

  const mockEventRepo: MonitoredEventRepository = {
    async create(_data) {
      return { ok: true, value: { id: "evt-test-001" } as never };
    },
    async findById() {
      return { ok: true, value: null as unknown as never };
    },
    async findBySourceAndEventId() {
      return null;
    },
    async updateStatus() {
      return { ok: true, value: null as unknown as never };
    },
    async list() {
      return { ok: true, value: [] };
    },
    async listInWindow() {
      return { ok: true, value: [] };
    },
  };

  const mockExecLogRepo: ExecutionLogRepository = {
    async append(_data: ExecutionLogInsert) {
      return {
        ok: true,
        value: {
          id: "log-test-001",
          action_type: _data.action_type,
          entity_type: _data.entity_type ?? null,
          entity_id: _data.entity_id ?? null,
          status: _data.status,
          message: _data.message ?? null,
          details: _data.details ?? {},
          started_at: new Date().toISOString(),
          completed_at: null,
          created_at: new Date().toISOString(),
        } as never,
      };
    },
    async listByEntity() {
      return { ok: true, value: [] };
    },
    async listRecent() {
      return { ok: true, value: [] };
    },
    async listPage() {
      return { ok: true, value: { items: [], page: 1, limit: 20, total: 0, totalPages: 0, hasNextPage: false, hasPreviousPage: false } };
    },
  };

  // Integration tests inject a deterministic LLM-shaped generation service
  // (template fallback has been removed from production generation).
  const mockGenerationService: DigestGenerationService = {
    async generateDigest(params) {
      const noEvents = params.events.length === 0;
      return {
        title: `ChronicleAI Daily Digest — ${params.reportDate}`,
        summary: noEvents
          ? "No significant on-chain events were detected during the reporting period."
          : `Monitored ${params.events.length} qualifying on-chain events.`,
        highlights: noEvents
          ? ["No major events detected during this reporting period."]
          : params.events.slice(0, 5).map((e) => `${e.eventType} (${e.id})`),
        analysis: noEvents
          ? "Monitoring continued with no threshold breaches."
          : "Activity concentrated across monitored venues during the window.",
        sections: {
          capitalDirection: "Net flows balanced.",
          exchangeAndProtocolFlows: "CEX net flat.",
          stressBoard: "No material stress.",
          storyOfTheDay: "Quiet window.",
          coverageNote: "",
        },
        sourceEventIds: params.events.map((e) => e.id),
        confidence: noEvents ? "high" : "medium",
        generationProvider: "gemini",
      };
    },
  };

  const handler = new DigestRunHandler({
    digestRepo: mockDigestRepo,
    eventRepo: mockEventRepo,
    execLogRepo: mockExecLogRepo,
    windowService: createDigestWindowService(mockDigestRepo),
    eventSelectionService: createDigestEventSelectionService(mockEventRepo),
    generationService: mockGenerationService,
    publicationService: createDigestPublicationService(
      mockDigestRepo,
      createChronicleRegistryService(null),
      "http://localhost:5173",
      createSmtpEmailService({
        host: undefined,
        port: undefined,
        user: undefined,
        pass: undefined,
        fromAddress: undefined,
        resolveRecipients: async () => [],
      }),
    ),
  });

  it("handles valid digest run request", async () => {
    createCapture.payload = null;
    const now = Date.now();
    const result = await handler.runDigest({
      periodStart: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
      periodEnd: new Date(now).toISOString(),
    });

    expect(result.accepted).toBe(true);
    expect(result.statusCode).toBe(201);
    expect(result.digestId).toBeTruthy();
    // DB CHECK allows only null | succeeded | failed (not 'ready').
    const inserted = createCapture.payload;
    expect(inserted).not.toBeNull();
    expect(inserted!["market_narrative_status"]).toBe("succeeded");
    expect(inserted!["market_narrative_provider"]).toBe("gemini");
    expect(inserted!["market_narrative"]).toMatchObject({
      type: "digest_sections",
      version: 1,
    });
  });

  it("handles no-events digest generation", async () => {
    createCapture.payload = null;
    const now = Date.now();
    const result = await handler.runDigest({
      periodStart: new Date(now - 48 * 60 * 60 * 1000).toISOString(),
      periodEnd: new Date(now - 25 * 60 * 60 * 1000).toISOString(),
    });

    expect(result.accepted).toBe(true);
    expect(result.statusCode).toBe(201);
    expect(result.message).toContain("Digest generated");
    const inserted = createCapture.payload;
    expect(inserted).not.toBeNull();
    expect(inserted!["market_narrative_status"]).toBe("succeeded");
  });

  it("rejects reversed window", async () => {
    const result = await handler.runDigest({
      periodStart: new Date().toISOString(),
      periodEnd: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    });

    expect(result.accepted).toBe(false);
    expect(result.statusCode).toBe(400);
  });

  it("rejects invalid dates", async () => {
    const result = await handler.runDigest({
      periodStart: "not-a-date",
      periodEnd: "also-not-a-date",
    });

    expect(result.accepted).toBe(false);
    expect(result.statusCode).toBe(400);
  });

  it("rejects future window", async () => {
    const result = await handler.runDigest({
      periodStart: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      periodEnd: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    });

    expect(result.accepted).toBe(false);
    expect(result.statusCode).toBe(400);
  });
});
