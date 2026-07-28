// Unit tests: digest publication with treasury-gated registry writes (FR-026)

import type {
  DailyDigestRepository,
  DailyDigestRow,
  ExecutionLogRepository,
} from "@chronicleai/db";
import { describe, expect, it, vi } from "vitest";
import type { ChronicleRegistryService } from "../services/chronicle-registry-service.ts";
import { createDigestPublicationService } from "../services/digest-publication-service.ts";
import type { NotificationService } from "../services/notification-service.ts";
import type { SmtpEmailService } from "../services/smtp-email-service.ts";
import type { TreasuryRegistryGate } from "../services/treasury-registry-gate.ts";

function baseDigest(overrides: Partial<DailyDigestRow> = {}): DailyDigestRow {
  return {
    id: "digest-1",
    title: "Daily Chronicle",
    summary: "Markets moved.",
    highlights: ["swap"],
    analysis: null,
    report_date: "2026-07-09",
    period_start: "2026-07-08T00:00:00.000Z",
    period_end: "2026-07-09T00:00:00.000Z",
    source_event_ids: [],
    audience: "public",
    source_event_root: null,
    publication_status: "published",
    published_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    registry_tx_hash: null,
    content_uri: null,
    content_hash: null,
    gas_used: null,
    gas_used_wei: null,
    keeper_hub_run_id: null,
    explorer_url: null,
    ...overrides,
  };
}

describe("DigestPublicationService treasury gate", () => {
  it("suspends registry write when treasury is below buffer and still dispatches soft channels", async () => {
    const row = baseDigest();
    const digestRepo: DailyDigestRepository = {
      create: vi.fn(),
      findById: vi.fn(),
      findByWindow: vi.fn(),
      findLatestPublic: vi.fn(),
      list: vi.fn(),
      updatePublicationStatus: vi.fn().mockResolvedValue({ ok: true, value: row }),
      updateRegistryMetadata: vi.fn().mockResolvedValue({ ok: true, value: row }),
    };

    const publishDigest = vi.fn();
    const registryService: ChronicleRegistryService = {
      publishAlert: vi.fn(),
      publishDigest,
      recordPayout: vi.fn(),
      publishTradeTicket: vi.fn(),
      recordCapitalMove: vi.fn(),
      publishPremiumReceipt: vi.fn(),
    };

    const smtpService = {
      sendDigestBulletin: vi.fn().mockResolvedValue({
        success: true,
        recipientsReached: 1,
      }),
      sendAlertNotification: vi.fn(),
    } satisfies SmtpEmailService;

    const sendLowBalanceWarning = vi.fn().mockResolvedValue({
      delivered: true,
      destinations: ["log"],
      failures: [],
    });
    const sendDigestBroadcast = vi.fn().mockResolvedValue({
      delivered: true,
      destinations: ["log", "telegram"],
      failures: [],
    });
    const notificationService = {
      sendAlertBroadcast: vi.fn(),
      sendDigestBroadcast,
      sendLowBalanceWarning,
      sendRevenueRoutingNotification: vi.fn(),
      getConfiguredChannels: () => ({ telegram: true }),
    } satisfies NotificationService;

    const treasuryGate: TreasuryRegistryGate = {
      evaluate: vi.fn().mockResolvedValue({
        allowRegistryWrite: false,
        reason: "Available balance (3000) is below safety buffer (10000)",
        availableBalance: 3000,
        safetyBuffer: 10000,
        status: "critical",
        deficitPercentage: 70,
        snapshotId: "snap-crit",
      }),
    };

    const execLogRepo = {
      append: vi.fn().mockResolvedValue({ ok: true, value: {} }),
      listByEntity: vi.fn(),
      listRecent: vi.fn(),
      listPage: vi.fn(),
    } satisfies ExecutionLogRepository;

    const service = createDigestPublicationService(
      digestRepo,
      registryService,
      "https://chronicle.example",
      smtpService,
      notificationService,
      treasuryGate,
      execLogRepo,
    );

    const result = await service.publishDigest({
      id: "digest-1",
      title: "Daily Chronicle",
      summary: "Markets moved.",
      highlights: ["swap"],
      reportDate: "2026-07-09",
      sourceEventRoot: "root-1",
    });

    expect(result.success).toBe(true);
    expect(result.registrySuspended).toBe(true);
    expect(result.registryTxHash).toBeUndefined();
    expect(result.publicationStatus).toBe("partial_failure");
    expect(result.errorMessage).toMatch(/suspended/i);
    expect(publishDigest).not.toHaveBeenCalled();
    expect(execLogRepo.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action_type: "registry_write",
        entity_type: "daily_digest",
        entity_id: "digest-1",
        status: "failed",
        details: expect.objectContaining({ reason: "treasury_gate" }),
      }),
    );
    expect(sendLowBalanceWarning).toHaveBeenCalledWith({
      availableBalance: 3000,
      safetyBuffer: 10000,
      deficitPercentage: 70,
      status: "critical",
    });
    expect(smtpService.sendDigestBulletin).toHaveBeenCalledOnce();
    expect(sendDigestBroadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        digestId: "digest-1",
        registryTxHash: undefined,
      }),
    );
  });

  it("writes registry when treasury gate allows", async () => {
    const row = baseDigest({ registry_tx_hash: "0xdigest" });
    const digestRepo: DailyDigestRepository = {
      create: vi.fn(),
      findById: vi.fn(),
      findByWindow: vi.fn(),
      findLatestPublic: vi.fn(),
      list: vi.fn(),
      updatePublicationStatus: vi.fn().mockResolvedValue({ ok: true, value: row }),
      updateRegistryMetadata: vi.fn().mockResolvedValue({ ok: true, value: row }),
    };

    const publishDigest = vi.fn().mockResolvedValue({
      success: true,
      txHash: "0xdigest",
      keeperHubRunId: "run-d1",
      explorerUrl: "https://sepolia.etherscan.io/tx/0xdigest",
    });
    const registryService: ChronicleRegistryService = {
      publishAlert: vi.fn(),
      publishDigest,
      recordPayout: vi.fn(),
      publishTradeTicket: vi.fn(),
      recordCapitalMove: vi.fn(),
      publishPremiumReceipt: vi.fn(),
    };

    const smtpService = {
      sendDigestBulletin: vi.fn().mockResolvedValue({
        success: true,
        recipientsReached: 0,
      }),
      sendAlertNotification: vi.fn(),
    } satisfies SmtpEmailService;

    const treasuryGate: TreasuryRegistryGate = {
      evaluate: vi.fn().mockResolvedValue({
        allowRegistryWrite: true,
        reason: "ok",
        availableBalance: 50_000,
        safetyBuffer: 10_000,
        status: "healthy",
      }),
    };

    const execLogRepo = {
      append: vi.fn().mockResolvedValue({ ok: true, value: {} }),
      listByEntity: vi.fn(),
      listRecent: vi.fn(),
      listPage: vi.fn(),
    };

    const service = createDigestPublicationService(
      digestRepo,
      registryService,
      "https://chronicle.example",
      smtpService,
      null,
      treasuryGate,
      execLogRepo as never,
    );

    const result = await service.publishDigest({
      id: "digest-1",
      title: "Daily Chronicle",
      summary: "Markets moved.",
      highlights: [],
      reportDate: "2026-07-09",
    });

    expect(result.success).toBe(true);
    expect(result.registrySuspended).toBeUndefined();
    expect(result.registryTxHash).toBe("0xdigest");
    expect(result.publicationStatus).toBe("published");
    expect(publishDigest).toHaveBeenCalledOnce();
    expect(execLogRepo.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action_type: "registry_write",
        entity_type: "daily_digest",
        entity_id: "digest-1",
        status: "succeeded",
        details: expect.objectContaining({
          method: "publishDigest",
          keeper_hub_run_id: "run-d1",
          tx_hash: "0xdigest",
        }),
      }),
    );
  });
});
