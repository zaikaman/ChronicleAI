// Unit tests: alert publication + community fan-out after registry write
// + treasury-gated suspension of on-chain writes (FR-026)

import type {
  ExecutionLogRepository,
  PublicAlertRepository,
  PublicAlertRow,
} from "@chronicleai/db";
import { describe, expect, it, vi } from "vitest";
import { createAlertPublicationService } from "../services/alert-publication-service.ts";
import type { ChronicleRegistryService } from "../services/chronicle-registry-service.ts";
import type { NotificationService } from "../services/notification-service.ts";
import type { TreasuryRegistryGate } from "../services/treasury-registry-gate.ts";

function baseAlert(overrides: Partial<PublicAlertRow> = {}): PublicAlertRow {
  return {
    id: "alert-1",
    monitored_event_id: "evt-1",
    title: "Whale Swap",
    summary: "250k USDC moved on Uniswap",
    source_references: [],
    audience: "public",
    destinations: null,
    dedupe_key: "dedupe-1",
    confidence: "high",
    delivery_status: "published",
    published_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    generation_provider: "gemini",
    generation_attempt_ids: [],
    registry_tx_hash: null,
    source_event_hash: null,
    content_uri: null,
    content_hash: null,
    gas_used: null,
    gas_used_wei: null,
    keeper_hub_run_id: null,
    explorer_url: null,
    event_type: "large_swap",
    chain_id: 11155111,
    protocol: "uniswap",
    ...overrides,
  };
}

describe("AlertPublicationService community broadcast", () => {
  it("broadcasts to Telegram after successful registry write", async () => {
    const published = baseAlert({
      delivery_status: "published",
      registry_tx_hash: "0xregistry",
    });

    const alertRepo: PublicAlertRepository = {
      create: vi.fn(),
      findById: vi.fn().mockResolvedValue({ ok: true, value: published }),
      findByDedupeKey: vi.fn(),
      list: vi.fn(), listPage: vi.fn(),
      updateDeliveryStatus: vi.fn().mockResolvedValue({ ok: true, value: published }),
      updateGenerationMetadata: vi.fn(),
      updateRegistryMetadata: vi.fn().mockResolvedValue({ ok: true, value: published }),
    };

    const registryService: ChronicleRegistryService = {
      publishAlert: vi.fn().mockResolvedValue({
        success: true,
        txHash: "0xregistry",
        keeperHubRunId: "run-1",
        explorerUrl: "https://sepolia.etherscan.io/tx/0xregistry",
      }),
      publishDigest: vi.fn(),
      recordPayout: vi.fn(),
      publishTradeTicket: vi.fn(),
      recordCapitalMove: vi.fn(),
      publishPremiumReceipt: vi.fn(),
    };

    const sendAlertBroadcast = vi.fn().mockResolvedValue({
      delivered: true,
      destinations: ["log", "telegram"],
      failures: [],
    });

    const notificationService = {
      sendAlertBroadcast,
      sendDigestBroadcast: vi.fn(),
      sendLowBalanceWarning: vi.fn(),
      sendRevenueRoutingNotification: vi.fn(),
      sendTelegramToChat: vi.fn(),
      isTelegramSendConfigured: () => true,
      getConfiguredChannels: () => ({ telegram: true }),
    } satisfies NotificationService;

    const service = createAlertPublicationService(
      alertRepo,
      registryService,
      "https://chronicle.example",
      notificationService,
    );

    const result = await service.publishAlert("alert-1", "0xsource");

    expect(result.success).toBe(true);
    expect(result.registryTxHash).toBe("0xregistry");
    expect(result.message).toContain("telegram");
    expect(sendAlertBroadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        alertId: "alert-1",
        title: "Whale Swap",
        summary: "250k USDC moved on Uniswap",
        eventType: "large_swap",
        registryTxHash: "0xregistry",
        explorerUrl: "https://sepolia.etherscan.io/tx/0xregistry",
        contentUri: expect.stringContaining("alert-1"),
      }),
    );
    expect(result.communityBroadcast?.destinations).toEqual([
      "log",
      "telegram",
    ]);
  });

  it("still publishes when community broadcast throws", async () => {
    const published = baseAlert();
    const alertRepo: PublicAlertRepository = {
      create: vi.fn(),
      findById: vi.fn().mockResolvedValue({ ok: true, value: published }),
      findByDedupeKey: vi.fn(),
      list: vi.fn(), listPage: vi.fn(),
      updateDeliveryStatus: vi.fn().mockResolvedValue({ ok: true, value: published }),
      updateGenerationMetadata: vi.fn(),
      updateRegistryMetadata: vi.fn().mockResolvedValue({ ok: true, value: published }),
    };

    const notificationService = {
      sendAlertBroadcast: vi.fn().mockRejectedValue(new Error("network down")),
      sendDigestBroadcast: vi.fn(),
      sendLowBalanceWarning: vi.fn(),
      sendRevenueRoutingNotification: vi.fn(),
      sendTelegramToChat: vi.fn(),
      isTelegramSendConfigured: () => true,
      getConfiguredChannels: () => ({ telegram: true }),
    } satisfies NotificationService;

    const service = createAlertPublicationService(
      alertRepo,
      null,
      "https://chronicle.example",
      notificationService,
    );

    const result = await service.publishAlert("alert-1");

    expect(result.success).toBe(true);
    expect(result.deliveryStatus).toBe("published");
    expect(result.communityBroadcast?.failures).toContain("community_broadcast_threw");
  });

  it("skips broadcast when notification service is not provided", async () => {
    const published = baseAlert();
    const alertRepo: PublicAlertRepository = {
      create: vi.fn(),
      findById: vi.fn().mockResolvedValue({ ok: true, value: published }),
      findByDedupeKey: vi.fn(),
      list: vi.fn(), listPage: vi.fn(),
      updateDeliveryStatus: vi.fn().mockResolvedValue({ ok: true, value: published }),
      updateGenerationMetadata: vi.fn(),
      updateRegistryMetadata: vi.fn().mockResolvedValue({ ok: true, value: published }),
    };

    const service = createAlertPublicationService(alertRepo, null, undefined, null);
    const result = await service.publishAlert("alert-1");

    expect(result.success).toBe(true);
    expect(result.communityBroadcast).toBeUndefined();
  });

  it("persists content hash and gas used after successful registry write", async () => {
    const published = baseAlert({ registry_tx_hash: "0xgas" });
    const alertRepo: PublicAlertRepository = {
      create: vi.fn(),
      findById: vi.fn().mockResolvedValue({ ok: true, value: published }),
      findByDedupeKey: vi.fn(),
      list: vi.fn(), listPage: vi.fn(),
      updateDeliveryStatus: vi.fn().mockResolvedValue({ ok: true, value: published }),
      updateGenerationMetadata: vi.fn(),
      updateRegistryMetadata: vi.fn().mockResolvedValue({ ok: true, value: published }),
    };

    const contentHash = "0x" + "cd".repeat(32);
    const registryService: ChronicleRegistryService = {
      publishAlert: vi.fn().mockResolvedValue({
        success: true,
        txHash: "0xgas",
        keeperHubRunId: "run-gas",
        explorerUrl: "https://sepolia.etherscan.io/tx/0xgas",
        contentHash,
        gasUsed: "91234",
        gasUsedWei: "91234000000000",
      }),
      publishDigest: vi.fn(),
      recordPayout: vi.fn(),
      publishTradeTicket: vi.fn(),
      recordCapitalMove: vi.fn(),
      publishPremiumReceipt: vi.fn(),
    };

    const service = createAlertPublicationService(
      alertRepo,
      registryService,
      "https://chronicle.example",
    );

    const result = await service.publishAlert("alert-1", "0xsource");

    expect(result.success).toBe(true);
    expect(result.contentHash).toBe(contentHash);
    expect(result.gasUsed).toBe("91234");
    expect(result.gasUsedWei).toBe("91234000000000");
    expect(alertRepo.updateRegistryMetadata).toHaveBeenCalledWith(
      "alert-1",
      expect.objectContaining({
        registryTxHash: "0xgas",
        contentHash,
        gasUsed: "91234",
        gasUsedWei: "91234000000000",
        keeperHubRunId: "run-gas",
      }),
    );
  });

  it("suspends registry write when treasury gate denies and still publishes locally", async () => {
    const published = baseAlert();
    const alertRepo: PublicAlertRepository = {
      create: vi.fn(),
      findById: vi.fn().mockResolvedValue({ ok: true, value: published }),
      findByDedupeKey: vi.fn(),
      list: vi.fn(), listPage: vi.fn(),
      updateDeliveryStatus: vi.fn().mockResolvedValue({ ok: true, value: published }),
      updateGenerationMetadata: vi.fn(),
      updateRegistryMetadata: vi.fn().mockResolvedValue({ ok: true, value: published }),
    };

    const publishAlert = vi.fn();
    const registryService: ChronicleRegistryService = {
      publishAlert,
      publishDigest: vi.fn(),
      recordPayout: vi.fn(),
      publishTradeTicket: vi.fn(),
      recordCapitalMove: vi.fn(),
      publishPremiumReceipt: vi.fn(),
    };

    const sendLowBalanceWarning = vi.fn().mockResolvedValue({
      delivered: true,
      destinations: ["log"],
      failures: [],
    });
    const sendAlertBroadcast = vi.fn().mockResolvedValue({
      delivered: true,
      destinations: ["log"],
      failures: [],
    });
    const notificationService = {
      sendAlertBroadcast,
      sendDigestBroadcast: vi.fn(),
      sendLowBalanceWarning,
      sendRevenueRoutingNotification: vi.fn(),
      sendTelegramToChat: vi.fn(),
      isTelegramSendConfigured: () => false,
      getConfiguredChannels: () => ({ telegram: false }),
    } satisfies NotificationService;

    const treasuryGate: TreasuryRegistryGate = {
      evaluate: vi.fn().mockResolvedValue({
        allowRegistryWrite: false,
        reason: "Available balance (7000) is below safety buffer (10000)",
        availableBalance: 7000,
        safetyBuffer: 10000,
        status: "warning",
        deficitPercentage: 30,
        snapshotId: "snap-warn",
      }),
    };

    const execLogRepo = {
      append: vi.fn().mockResolvedValue({ ok: true, value: {} }),
      listByEntity: vi.fn(),
      listRecent: vi.fn(),
      listPage: vi.fn(),
    } satisfies ExecutionLogRepository;

    const service = createAlertPublicationService(
      alertRepo,
      registryService,
      "https://chronicle.example",
      notificationService,
      treasuryGate,
      execLogRepo,
    );

    const result = await service.publishAlert("alert-1", "0xsource");

    expect(result.success).toBe(true);
    expect(result.deliveryStatus).toBe("published");
    expect(result.registrySuspended).toBe(true);
    expect(result.registryTxHash).toBeUndefined();
    expect(result.message).toMatch(/registry write suspended/i);
    expect(publishAlert).not.toHaveBeenCalled();
    expect(execLogRepo.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action_type: "registry_write",
        entity_type: "public_alert",
        entity_id: "alert-1",
        status: "failed",
        details: expect.objectContaining({ reason: "treasury_gate" }),
      }),
    );
    expect(sendLowBalanceWarning).toHaveBeenCalledWith({
      availableBalance: 7000,
      safetyBuffer: 10000,
      deficitPercentage: 30,
      status: "warning",
    });
    expect(alertRepo.updateRegistryMetadata).toHaveBeenCalledWith(
      "alert-1",
      expect.objectContaining({
        sourceEventHash: "0xsource",
        contentUri: expect.stringContaining("alert-1"),
      }),
    );
    // Soft-fail local publish still fans out without a registry tx hash.
    expect(sendAlertBroadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        alertId: "alert-1",
        registryTxHash: undefined,
      }),
    );
  });

  it("performs registry write when treasury gate allows", async () => {
    const published = baseAlert({ registry_tx_hash: "0xok" });
    const alertRepo: PublicAlertRepository = {
      create: vi.fn(),
      findById: vi.fn().mockResolvedValue({ ok: true, value: published }),
      findByDedupeKey: vi.fn(),
      list: vi.fn(), listPage: vi.fn(),
      updateDeliveryStatus: vi.fn().mockResolvedValue({ ok: true, value: published }),
      updateGenerationMetadata: vi.fn(),
      updateRegistryMetadata: vi.fn().mockResolvedValue({ ok: true, value: published }),
    };

    const publishAlert = vi.fn().mockResolvedValue({
      success: true,
      txHash: "0xok",
      keeperHubRunId: "run-ok",
      explorerUrl: "https://sepolia.etherscan.io/tx/0xok",
    });
    const registryService: ChronicleRegistryService = {
      publishAlert,
      publishDigest: vi.fn(),
      recordPayout: vi.fn(),
      publishTradeTicket: vi.fn(),
      recordCapitalMove: vi.fn(),
      publishPremiumReceipt: vi.fn(),
    };

    const treasuryGate: TreasuryRegistryGate = {
      evaluate: vi.fn().mockResolvedValue({
        allowRegistryWrite: true,
        reason: "Treasury allows registry write",
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
    } satisfies ExecutionLogRepository;

    const service = createAlertPublicationService(
      alertRepo,
      registryService,
      "https://chronicle.example",
      null,
      treasuryGate,
      execLogRepo,
    );

    const result = await service.publishAlert("alert-1", "0xsource");

    expect(result.success).toBe(true);
    expect(result.registrySuspended).toBeUndefined();
    expect(result.registryTxHash).toBe("0xok");
    expect(publishAlert).toHaveBeenCalledOnce();
    expect(execLogRepo.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action_type: "registry_write",
        entity_type: "public_alert",
        entity_id: "alert-1",
        status: "succeeded",
        details: expect.objectContaining({
          method: "publishAlert",
          reason: "registry_write_ok",
          tx_hash: "0xok",
          keeper_hub_run_id: "run-ok",
        }),
      }),
    );
  });

  it("logs registry_write failed when KeeperHub write fails without txHash", async () => {
    const published = baseAlert();
    const alertRepo: PublicAlertRepository = {
      create: vi.fn(),
      findById: vi.fn().mockResolvedValue({ ok: true, value: published }),
      findByDedupeKey: vi.fn(),
      list: vi.fn(),
      listPage: vi.fn(),
      updateDeliveryStatus: vi.fn().mockResolvedValue({ ok: true, value: published }),
      updateGenerationMetadata: vi.fn(),
      updateRegistryMetadata: vi.fn().mockResolvedValue({ ok: true, value: published }),
    };

    const publishAlert = vi.fn().mockResolvedValue({
      success: false,
      errorMessage: "KeeperHub poll timeout",
      keeperHubRunId: "run-fail",
    });
    const registryService: ChronicleRegistryService = {
      publishAlert,
      publishDigest: vi.fn(),
      recordPayout: vi.fn(),
      publishTradeTicket: vi.fn(),
      recordCapitalMove: vi.fn(),
      publishPremiumReceipt: vi.fn(),
    };

    const treasuryGate: TreasuryRegistryGate = {
      evaluate: vi.fn().mockResolvedValue({
        allowRegistryWrite: true,
        reason: "Treasury allows registry write",
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
    } satisfies ExecutionLogRepository;

    const service = createAlertPublicationService(
      alertRepo,
      registryService,
      "https://chronicle.example",
      null,
      treasuryGate,
      execLogRepo,
    );

    const result = await service.publishAlert("alert-1", "0xsource");

    expect(result.success).toBe(true);
    expect(result.registryTxHash).toBeUndefined();
    expect(execLogRepo.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action_type: "registry_write",
        entity_type: "public_alert",
        entity_id: "alert-1",
        status: "failed",
        message: "KeeperHub poll timeout",
        details: expect.objectContaining({
          method: "publishAlert",
          reason: "registry_write_failed",
        }),
      }),
    );
  });
});
