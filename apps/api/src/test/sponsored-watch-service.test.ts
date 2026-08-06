// Unit tests for Sponsored Watch Service
// Tests campaign lifecycle, on-chain registry execution, monitoring, and auto-complete

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSponsoredWatchService } from "../services/sponsored-watch-service.ts";
import type { Web3Client } from "../services/web3-client-service.ts";

describe("SponsoredWatchService", () => {
  const mockWatchRepo = {
    create: vi.fn(),
    findById: vi.fn(),
    list: vi.fn(),
    listActive: vi.fn(),
    listDueForCompletion: vi.fn(),
    listCompletedNeedingReportRepair: vi.fn(),
    listDueForActivation: vi.fn(),
    listInMonitoringWindow: vi.fn(),
    update: vi.fn(),
    updateStatus: vi.fn(),
  };

  const mockExecLogRepo = {
    append: vi.fn(),
    listByEntity: vi.fn(),
    listRecent: vi.fn(),
    listPage: vi.fn(),
  };

  const mockEventRepo = {
    create: vi.fn(),
    findById: vi.fn(),
    findBySourceAndEventId: vi.fn(),
    updateStatus: vi.fn(),
    list: vi.fn(),
      listInWindow: vi.fn(),
  };

  const mockWeb3Client: Web3Client = {
    getSignerAddress: vi.fn().mockResolvedValue("0xsigner"),
    getTreasuryAddress: vi.fn().mockResolvedValue("0xtreasury"),
    getTreasuryProvider: vi.fn().mockResolvedValue("keeperhub"),
    isKeeperHubBacked: vi.fn().mockReturnValue(true),
    isParaTreasuryBacked: vi.fn().mockReturnValue(false),
    publishAlert: vi.fn(),
    publishDigest: vi.fn(),
    createSponsoredWatch: vi.fn().mockResolvedValue({
      watchId: 42,
      txHash: "0x" + "a".repeat(64),
      keeperHubRunId: "exec_watch_create",
      explorerUrl: "https://sepolia.etherscan.io/tx/0x" + "a".repeat(64),
    }),
    publishSponsoredReport: vi.fn().mockResolvedValue({
      txHash: "0x" + "b".repeat(64),
      keeperHubRunId: "exec_watch_report",
      explorerUrl: "https://sepolia.etherscan.io/tx/0x" + "b".repeat(64),
    }),
    publishPremiumReceipt: vi.fn(),
    recordPayout: vi.fn(),
    publishTradeTicket: vi.fn(),
    recordCapitalMove: vi.fn(),
    sendTransfer: vi.fn(),
  };

  const service = createSponsoredWatchService({
    watchRepo: mockWatchRepo as never,
    execLogRepo: mockExecLogRepo as never,
    eventRepo: mockEventRepo as never,
    web3Client: mockWeb3Client,
    frontendOrigin: "https://chronicle.example",
  });

  const mockWatchRow = {
    id: "11111111-1111-1111-1111-111111111111",
    target_contract: "0x1234567890abcdef1234567890abcdef12345678",
    watch_spec_hash: "0x" + "c".repeat(64),
    starts_at: "2026-07-06T00:00:00.000Z",
    ends_at: "2026-07-28T00:00:00.000Z",
    create_tx_hash: "0x" + "a".repeat(64),
    report_tx_hash: null,
    report_content_hash: null,
    content_uri: null,
    create_keeper_hub_run_id: "exec_watch_create",
    create_explorer_url: "https://sepolia.etherscan.io/tx/0x" + "a".repeat(64),
    report_keeper_hub_run_id: null,
    report_explorer_url: null,
    on_chain_watch_id: 42,
    source_event_ids: [] as string[],
    source_event_root: null as string | null,
    report_title: null,
    report_summary: null,
    report_highlights: [] as string[],
    report_analysis: null,
    last_monitored_at: null,
    monitored_event_count: 0,
    target_kind: "contract" as const,
    telegram_chat_id: null as string | null,
    visibility: "public" as const,
    last_alert_sent_at: null as string | null,
    status: "accepted",
    created_at: "2026-07-06T00:00:00.000Z",
    updated_at: "2026-07-06T00:00:00.000Z",
  };

  beforeEach(() => {
    vi.resetAllMocks();
    (mockWeb3Client.isKeeperHubBacked as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (mockWeb3Client.createSponsoredWatch as ReturnType<typeof vi.fn>).mockResolvedValue({
      watchId: 42,
      txHash: "0x" + "a".repeat(64),
      keeperHubRunId: "exec_watch_create",
      explorerUrl: "https://sepolia.etherscan.io/tx/0x" + "a".repeat(64),
    });
    (mockWeb3Client.publishSponsoredReport as ReturnType<typeof vi.fn>).mockResolvedValue({
      txHash: "0x" + "b".repeat(64),
      keeperHubRunId: "exec_watch_report",
      explorerUrl: "https://sepolia.etherscan.io/tx/0x" + "b".repeat(64),
    });
    mockExecLogRepo.append.mockResolvedValue({ ok: true, value: {} });
    mockEventRepo.listInWindow.mockResolvedValue({ ok: true, value: [] });
    mockWatchRepo.listCompletedNeedingReportRepair.mockResolvedValue({ ok: true, value: [] });
  });

  describe("createSponsoredWatch", () => {
    it("should create a watch with a real on-chain tx hash and on_chain_watch_id", async () => {
      // Use a window that always covers "now" so initial status is monitoring.
      const startsAt = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
      const endsAt = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString();

      mockWatchRepo.create.mockResolvedValue({
        ok: true,
        value: {
          ...mockWatchRow,
          create_tx_hash: "0x" + "a".repeat(64),
          on_chain_watch_id: 42,
          status: "monitoring",
          starts_at: startsAt,
          ends_at: endsAt,
        },
      });

      const result = await service.createSponsoredWatch({
        targetContract: "0x1234567890abcdef1234567890abcdef12345678",
        watchSpecHash: "0x" + "c".repeat(64),
        startsAt,
        endsAt,
      });

      expect(result.create_tx_hash).toBe("0x" + "a".repeat(64));
      expect(result.on_chain_watch_id).toBe(42);
      expect(mockWeb3Client.createSponsoredWatch).toHaveBeenCalled();
      expect(mockWatchRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          target_contract: "0x1234567890abcdef1234567890abcdef12345678",
          watch_spec_hash: "0x" + "c".repeat(64),
          create_tx_hash: "0x" + "a".repeat(64),
          on_chain_watch_id: 42,
          status: "monitoring",
          starts_at: startsAt,
          ends_at: endsAt,
          target_kind: "contract",
          visibility: "public",
        }),
      );
      expect(mockExecLogRepo.append).toHaveBeenCalled();
    });

    it("persists wallet + private fields when provided", async () => {
      const startsAt = new Date(Date.now() - 60_000).toISOString();
      const endsAt = new Date(Date.now() + 3_600_000).toISOString();
      mockWatchRepo.create.mockResolvedValue({
        ok: true,
        value: {
          ...mockWatchRow,
          target_kind: "wallet",
          visibility: "private",
          telegram_chat_id: "777",
          status: "monitoring",
          starts_at: startsAt,
          ends_at: endsAt,
        },
      });

      await service.createSponsoredWatch({
        targetContract: "0x1234567890abcdef1234567890abcdef12345678",
        watchSpecHash: "0x" + "c".repeat(64),
        startsAt,
        endsAt,
        targetKind: "wallet",
        visibility: "private",
        telegramChatId: "777",
      });

      expect(mockWatchRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          target_kind: "wallet",
          visibility: "private",
          telegram_chat_id: "777",
        }),
      );
    });

    it("rejects private watches without telegram chat id", async () => {
      await expect(
        service.createSponsoredWatch({
          targetContract: "0x1234567890abcdef1234567890abcdef12345678",
          watchSpecHash: "0x" + "c".repeat(64),
          startsAt: "2026-07-06T00:00:00.000Z",
          endsAt: "2026-07-28T00:00:00.000Z",
          visibility: "private",
        }),
      ).rejects.toThrow(/telegram_chat_id/);
    });

    it("should throw when web3 client is not configured", async () => {
      const noWeb3 = createSponsoredWatchService({
        watchRepo: mockWatchRepo as never,
        execLogRepo: mockExecLogRepo as never,
        web3Client: null,
      });

      await expect(
        noWeb3.createSponsoredWatch({
          targetContract: "0x1234567890abcdef1234567890abcdef12345678",
          watchSpecHash: "0x" + "c".repeat(64),
          startsAt: "2026-07-06T00:00:00.000Z",
          endsAt: "2026-07-28T00:00:00.000Z",
        }),
      ).rejects.toThrow("Web3 client not configured");
    });

    it("should throw when on-chain createSponsoredWatch fails", async () => {
      (mockWeb3Client.createSponsoredWatch as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("RPC down"),
      );

      await expect(
        service.createSponsoredWatch({
          targetContract: "0x1234567890abcdef1234567890abcdef12345678",
          watchSpecHash: "0x" + "c".repeat(64),
          startsAt: "2026-07-06T00:00:00.000Z",
          endsAt: "2026-07-28T00:00:00.000Z",
        }),
      ).rejects.toThrow("On-chain createSponsoredWatch failed");

      expect(mockWatchRepo.create).not.toHaveBeenCalled();
    });

    it("should throw on repository failure", async () => {
      mockWatchRepo.create.mockResolvedValue({
        ok: false,
        error: new Error("DB error"),
      });

      await expect(
        service.createSponsoredWatch({
          targetContract: "0x1234567890abcdef1234567890abcdef12345678",
          watchSpecHash: "0x" + "c".repeat(64),
          startsAt: "2026-07-06T00:00:00.000Z",
          endsAt: "2026-07-28T00:00:00.000Z",
        }),
      ).rejects.toThrow("DB error");
    });
  });

  describe("completeWatch", () => {
    it("should complete a watch with on-chain report tx hash and sourceEventRoot", async () => {
      mockWatchRepo.findById.mockResolvedValue({
        ok: true,
        value: { ...mockWatchRow, status: "monitoring" },
      });
      mockWatchRepo.updateStatus.mockResolvedValue({
        ok: true,
        value: {
          ...mockWatchRow,
          status: "completed",
          report_content_hash: "0xreporthash",
          report_tx_hash: "0x" + "b".repeat(64),
          source_event_root: "0xroot",
        },
      });

      const result = await service.completeWatch(mockWatchRow.id, {
        reportContentHash: "0xreporthash",
        sourceEventRoot: "0xroot",
        sourceEventIds: ["evt-1"],
        reportTitle: "Test report",
      });

      expect(result.status).toBe("completed");
      expect(result.report_content_hash).toBe("0xreporthash");
      expect(result.report_tx_hash).toBe("0x" + "b".repeat(64));
      expect(mockWeb3Client.publishSponsoredReport).toHaveBeenCalledWith(
        42,
        "0xreporthash",
        "0xroot",
        `https://chronicle.example/premium/watches/${mockWatchRow.id}`,
      );
      expect(mockWatchRepo.updateStatus).toHaveBeenCalledWith(
        mockWatchRow.id,
        "completed",
        expect.objectContaining({
          report_content_hash: "0xreporthash",
          report_tx_hash: "0x" + "b".repeat(64),
          source_event_root: "0xroot",
          content_uri: `https://chronicle.example/premium/watches/${mockWatchRow.id}`,
        }),
      );
    });

    it("should throw when FRONTEND_ORIGIN is missing for report content URI", async () => {
      const noOrigin = createSponsoredWatchService({
        watchRepo: mockWatchRepo as never,
        execLogRepo: mockExecLogRepo as never,
        web3Client: mockWeb3Client,
      });
      mockWatchRepo.findById.mockResolvedValue({
        ok: true,
        value: { ...mockWatchRow, status: "monitoring" },
      });

      await expect(
        noOrigin.completeWatch(mockWatchRow.id, {
          reportContentHash: "0xhash",
          sourceEventRoot: "0xroot",
        }),
      ).rejects.toThrow("FRONTEND_ORIGIN is required");
      expect(mockWeb3Client.publishSponsoredReport).not.toHaveBeenCalled();
    });

    it("should throw when on-chain publishSponsoredReport fails", async () => {
      mockWatchRepo.findById.mockResolvedValue({
        ok: true,
        value: { ...mockWatchRow, status: "monitoring" },
      });
      (mockWeb3Client.publishSponsoredReport as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("tx reverted"),
      );

      await expect(
        service.completeWatch(mockWatchRow.id, {
          reportContentHash: "0xhash",
          sourceEventRoot: "0xroot",
        }),
      ).rejects.toThrow("On-chain publishSponsoredReport failed");
      expect(mockWatchRepo.updateStatus).not.toHaveBeenCalled();
    });

    it("should throw when on_chain_watch_id is missing", async () => {
      mockWatchRepo.findById.mockResolvedValue({
        ok: true,
        value: { ...mockWatchRow, on_chain_watch_id: null, status: "monitoring" },
      });

      await expect(
        service.completeWatch(mockWatchRow.id, {
          reportContentHash: "0xhash",
          sourceEventRoot: "0xroot",
        }),
      ).rejects.toThrow("on_chain_watch_id");
    });

    it("should throw on repository failure during completion", async () => {
      mockWatchRepo.findById.mockResolvedValue({
        ok: true,
        value: { ...mockWatchRow, status: "monitoring" },
      });
      mockWatchRepo.updateStatus.mockResolvedValue({
        ok: false,
        error: new Error("Update failed"),
      });

      await expect(
        service.completeWatch(mockWatchRow.id, {
          reportContentHash: "0xhash",
          sourceEventRoot: "0xroot",
        }),
      ).rejects.toThrow("Update failed");
    });
  });

  describe("failWatch", () => {
    it("should mark a watch as failed", async () => {
      mockWatchRepo.updateStatus.mockResolvedValue({
        ok: true,
        value: { ...mockWatchRow, status: "failed" },
      });

      const result = await service.failWatch(mockWatchRow.id, "Monitoring timeout");

      expect(result.status).toBe("failed");
      expect(mockWatchRepo.updateStatus).toHaveBeenCalledWith(mockWatchRow.id, "failed");
    });
  });

  describe("getActiveWatches", () => {
    it("should return active watches from repository", async () => {
      mockWatchRepo.listActive.mockResolvedValue({
        ok: true,
        value: [mockWatchRow],
      });

      const result = await service.getActiveWatches();

      expect(result).toHaveLength(1);
      expect(result[0]?.target_contract).toBe("0x1234567890abcdef1234567890abcdef12345678");
    });

    it("should throw on repository failure", async () => {
      mockWatchRepo.listActive.mockResolvedValue({
        ok: false,
        error: new Error("List failed"),
      });

      await expect(service.getActiveWatches()).rejects.toThrow("List failed");
    });
  });

  describe("processCampaignCycle", () => {
    it("does not overlap a slow cycle with the next invocation", async () => {
      let releaseFirstList: (() => void) | undefined;
      const firstList = new Promise<void>((resolve) => {
        releaseFirstList = resolve;
      });

      mockWatchRepo.listDueForActivation
        .mockImplementationOnce(async () => {
          await firstList;
          return { ok: true, value: [] };
        })
        .mockResolvedValue({ ok: true, value: [] });
      mockWatchRepo.listInMonitoringWindow.mockResolvedValue({ ok: true, value: [] });
      mockWatchRepo.listDueForCompletion.mockResolvedValue({ ok: true, value: [] });

      const firstCycle = service.processCampaignCycle(new Date("2026-07-28T12:00:00.000Z"));
      await Promise.resolve();

      const secondCycle = service.processCampaignCycle(new Date("2026-07-28T12:01:00.000Z"));
      expect(mockWatchRepo.listDueForActivation).toHaveBeenCalledTimes(1);

      releaseFirstList?.();
      await Promise.all([firstCycle, secondCycle]);

      await service.processCampaignCycle(new Date("2026-07-28T12:02:00.000Z"));
      expect(mockWatchRepo.listDueForActivation).toHaveBeenCalledTimes(2);
    });

    it("should activate, monitor, and complete ended campaigns", async () => {
      const monitoringWatch = {
        ...mockWatchRow,
        status: "monitoring",
        starts_at: "2026-07-01T00:00:00.000Z",
        ends_at: "2026-07-20T00:00:00.000Z",
      };
      const endedWatch = {
        ...mockWatchRow,
        id: "22222222-2222-2222-2222-222222222222",
        status: "monitoring",
        starts_at: "2026-07-01T00:00:00.000Z",
        ends_at: "2026-07-05T00:00:00.000Z",
      };
      const acceptedWatch = {
        ...mockWatchRow,
        id: "33333333-3333-3333-3333-333333333333",
        status: "accepted",
        starts_at: "2026-07-08T00:00:00.000Z",
        ends_at: "2026-07-28T00:00:00.000Z",
      };

      mockWatchRepo.listDueForActivation.mockResolvedValue({
        ok: true,
        value: [acceptedWatch],
      });
      mockWatchRepo.listInMonitoringWindow.mockResolvedValue({
        ok: true,
        value: [monitoringWatch],
      });
      mockWatchRepo.listDueForCompletion.mockResolvedValue({
        ok: true,
        value: [endedWatch],
      });
      mockWatchRepo.listCompletedNeedingReportRepair.mockResolvedValue({
        ok: true,
        value: [],
      });
      mockWatchRepo.updateStatus.mockImplementation(async (id: string, status: string) => ({
        ok: true,
        value: { ...mockWatchRow, id, status },
      }));
      mockWatchRepo.update.mockResolvedValue({
        ok: true,
        value: { ...monitoringWatch, monitored_event_count: 0 },
      });
      mockWatchRepo.findById.mockResolvedValue({
        ok: true,
        value: endedWatch,
      });

      const target = "0x1234567890abcdef1234567890abcdef12345678";
      mockEventRepo.listInWindow.mockResolvedValue({
        ok: true,
        value: [
          {
            id: "evt-match-1",
            source: "keeperhub",
            source_event_id: "src-1",
            event_type: "large_swap",
            chain_id: 11155111,
            protocol: "uniswap",
            asset_symbols: ["USDC", "WETH"],
            magnitude: { value: 250000, unit: "USD" },
            transaction_hash: "0x" + "11".repeat(32),
            observed_at: null,
            captured_at: "2026-07-03T12:00:00.000Z",
            significance_score: 0.9,
            raw_payload: { address: target, eventName: "Swap" },
            status: "qualified",
            created_at: "2026-07-03T12:00:00.000Z",
            updated_at: "2026-07-03T12:00:00.000Z",
          },
        ],
      });

      const cycle = await service.processCampaignCycle(new Date("2026-07-28T12:00:00.000Z"));

      expect(cycle.activated).toBe(1);
      expect(cycle.monitored).toBe(1);
      expect(cycle.completed).toBe(1);
      expect(cycle.repaired).toBe(0);
      expect(cycle.failed).toBe(0);
      expect(mockWeb3Client.publishSponsoredReport).toHaveBeenCalled();
      const publishArgs = (mockWeb3Client.publishSponsoredReport as ReturnType<typeof vi.fn>).mock
        .calls[0];
      // watchId, reportContentHash, sourceEventRoot, reportUri
      expect(publishArgs?.[0]).toBe(42);
      expect(typeof publishArgs?.[1]).toBe("string");
      expect(typeof publishArgs?.[2]).toBe("string");
      expect(publishArgs?.[3]).toContain("/premium/watches/");
    });

    it("repairs completed watches stuck with ellipsis placeholder narrative", async () => {
      const junkWatch = {
        ...mockWatchRow,
        id: "6c71fb9b-f71f-4632-b940-ca65e0ce128b",
        status: "completed",
        ends_at: "2026-07-05T00:00:00.000Z",
        report_tx_hash: "0x" + "b".repeat(64),
        report_content_hash: "0x" + "d".repeat(64),
        report_title: "...",
        report_summary: "...",
        report_highlights: ["...", "..."],
        report_analysis: "...",
        monitored_event_count: 2,
      };

      mockWatchRepo.listDueForActivation.mockResolvedValue({ ok: true, value: [] });
      mockWatchRepo.listInMonitoringWindow.mockResolvedValue({ ok: true, value: [] });
      mockWatchRepo.listDueForCompletion.mockResolvedValue({ ok: true, value: [] });
      mockWatchRepo.listCompletedNeedingReportRepair.mockResolvedValue({
        ok: true,
        value: [junkWatch],
      });
      mockWatchRepo.update.mockImplementation(async (id: string, update: Record<string, unknown>) => ({
        ok: true,
        value: { ...junkWatch, id, ...update },
      }));
      mockEventRepo.listInWindow.mockResolvedValue({
        ok: true,
        value: [
          {
            id: "evt-1",
            source: "keeperhub",
            source_event_id: "src-1",
            event_type: "large_swap",
            chain_id: 11155111,
            protocol: "uniswap",
            asset_symbols: ["USDC"],
            magnitude: { value: 100000, unit: "USD" },
            transaction_hash: "0x" + "11".repeat(32),
            observed_at: null,
            captured_at: "2026-07-03T12:00:00.000Z",
            significance_score: 0.9,
            raw_payload: { address: mockWatchRow.target_contract },
            status: "qualified",
            created_at: "2026-07-03T12:00:00.000Z",
            updated_at: "2026-07-03T12:00:00.000Z",
          },
        ],
      });

      const cycle = await service.processCampaignCycle(new Date("2026-07-28T12:00:00.000Z"));

      expect(cycle.repaired).toBe(1);
      expect(cycle.failed).toBe(0);
      expect(mockWatchRepo.update).toHaveBeenCalled();
      const updateArg = mockWatchRepo.update.mock.calls[0]?.[1] as {
        report_title?: string;
        report_summary?: string;
      };
      expect(updateArg.report_title).toContain("Sponsored Watch Report");
      expect(updateArg.report_summary).not.toBe("...");
      // Must not re-publish on-chain when only repairing narrative
      expect(mockWeb3Client.publishSponsoredReport).not.toHaveBeenCalled();
    });

    it("private watch alerts Telegram only (no public_alert create)", async () => {
      const privateWatch = {
        ...mockWatchRow,
        status: "monitoring",
        visibility: "private" as const,
        telegram_chat_id: "999001",
        source_event_ids: [] as string[],
        starts_at: "2026-07-01T00:00:00.000Z",
        ends_at: "2026-07-28T00:00:00.000Z",
      };
      const newEventId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
      const sendTelegramToChat = vi.fn().mockResolvedValue({
        delivered: true,
        destinations: ["telegram:999001"],
        failures: [],
      });
      const alertCreate = vi.fn();
      const publishAlert = vi.fn();

      const privateService = createSponsoredWatchService({
        watchRepo: mockWatchRepo as never,
        execLogRepo: mockExecLogRepo as never,
        eventRepo: mockEventRepo as never,
        web3Client: mockWeb3Client,
        frontendOrigin: "https://chronicle.example",
        notificationService: {
          sendTelegramToChat,
          sendAlertBroadcast: vi.fn(),
          sendDigestBroadcast: vi.fn(),
          sendLowBalanceWarning: vi.fn(),
          sendRevenueRoutingNotification: vi.fn(),
          getConfiguredChannels: () => ({ telegram: true }),
          isTelegramSendConfigured: () => true,
        } as never,
        alertRepo: { create: alertCreate, findByDedupeKey: vi.fn().mockResolvedValue(null) } as never,
        alertPublicationService: { publishAlert } as never,
      });

      mockWatchRepo.listDueForActivation.mockResolvedValue({ ok: true, value: [] });
      mockWatchRepo.listInMonitoringWindow.mockResolvedValue({
        ok: true,
        value: [privateWatch],
      });
      mockWatchRepo.listDueForCompletion.mockResolvedValue({ ok: true, value: [] });
      mockWatchRepo.listCompletedNeedingReportRepair.mockResolvedValue({
        ok: true,
        value: [],
      });
      mockWatchRepo.update.mockImplementation(async (id: string, update: Record<string, unknown>) => ({
        ok: true,
        value: { ...privateWatch, id, ...update },
      }));
      mockWatchRepo.findById.mockResolvedValue({
        ok: true,
        value: privateWatch,
      });
      mockEventRepo.listInWindow.mockResolvedValue({
        ok: true,
        value: [
          {
            id: newEventId,
            source: "keeperhub",
            source_event_id: "src-priv",
            event_type: "large_swap",
            chain_id: 11155111,
            protocol: "uniswap",
            asset_symbols: ["USDC"],
            magnitude: null,
            transaction_hash: "0x" + "22".repeat(32),
            observed_at: null,
            captured_at: "2026-07-10T00:00:00.000Z",
            significance_score: 0.8,
            raw_payload: { address: privateWatch.target_contract },
            status: "qualified",
            created_at: "2026-07-10T00:00:00.000Z",
            updated_at: "2026-07-10T00:00:00.000Z",
          },
        ],
      });

      const cycle = await privateService.processCampaignCycle(
        new Date("2026-07-10T12:00:00.000Z"),
      );

      expect(cycle.monitored).toBe(1);
      expect(sendTelegramToChat).toHaveBeenCalledWith(
        expect.objectContaining({ chatId: "999001" }),
      );
      expect(alertCreate).not.toHaveBeenCalled();
      expect(publishAlert).not.toHaveBeenCalled();
      expect(mockExecLogRepo.append).toHaveBeenCalledWith(
        expect.objectContaining({
          action_type: "generate_alert",
          entity_id: privateWatch.id,
          status: "succeeded",
        }),
      );
    });

    it("public watch creates alert and calls publishAlert (registry path)", async () => {
      const publicWatch = {
        ...mockWatchRow,
        status: "monitoring",
        visibility: "public" as const,
        source_event_ids: [] as string[],
        starts_at: "2026-07-01T00:00:00.000Z",
        ends_at: "2026-07-28T00:00:00.000Z",
      };
      const newEventId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
      const alertCreate = vi.fn().mockResolvedValue({
        ok: true,
        value: { id: "alert-pub-1" },
      });
      const publishAlert = vi.fn().mockResolvedValue({
        success: true,
        deliveryStatus: "published",
        message: "ok",
        registryTxHash: "0x" + "ee".repeat(32),
        explorerUrl: "https://sepolia.etherscan.io/tx/0xee",
      });

      const publicService = createSponsoredWatchService({
        watchRepo: mockWatchRepo as never,
        execLogRepo: mockExecLogRepo as never,
        eventRepo: mockEventRepo as never,
        web3Client: mockWeb3Client,
        frontendOrigin: "https://chronicle.example",
        notificationService: {
          sendTelegramToChat: vi.fn(),
          sendAlertBroadcast: vi.fn(),
          sendDigestBroadcast: vi.fn(),
          sendLowBalanceWarning: vi.fn(),
          sendRevenueRoutingNotification: vi.fn(),
          getConfiguredChannels: () => ({ telegram: true }),
          isTelegramSendConfigured: () => true,
        } as never,
        alertRepo: { create: alertCreate, findByDedupeKey: vi.fn().mockResolvedValue(null) } as never,
        alertPublicationService: { publishAlert } as never,
      });

      mockWatchRepo.listDueForActivation.mockResolvedValue({ ok: true, value: [] });
      mockWatchRepo.listInMonitoringWindow.mockResolvedValue({
        ok: true,
        value: [publicWatch],
      });
      mockWatchRepo.listDueForCompletion.mockResolvedValue({ ok: true, value: [] });
      mockWatchRepo.listCompletedNeedingReportRepair.mockResolvedValue({
        ok: true,
        value: [],
      });
      mockWatchRepo.update.mockImplementation(async (id: string, update: Record<string, unknown>) => ({
        ok: true,
        value: { ...publicWatch, id, ...update },
      }));
      mockWatchRepo.findById.mockResolvedValue({
        ok: true,
        value: publicWatch,
      });
      mockEventRepo.listInWindow.mockResolvedValue({
        ok: true,
        value: [
          {
            id: newEventId,
            source: "keeperhub",
            source_event_id: "src-pub",
            event_type: "large_swap",
            chain_id: 11155111,
            protocol: "uniswap",
            asset_symbols: ["USDC"],
            magnitude: null,
            transaction_hash: "0x" + "33".repeat(32),
            observed_at: null,
            captured_at: "2026-07-10T00:00:00.000Z",
            significance_score: 0.8,
            raw_payload: { address: publicWatch.target_contract },
            status: "qualified",
            created_at: "2026-07-10T00:00:00.000Z",
            updated_at: "2026-07-10T00:00:00.000Z",
          },
        ],
      });

      const cycle = await publicService.processCampaignCycle(
        new Date("2026-07-10T12:00:00.000Z"),
      );

      expect(cycle.monitored).toBe(1);
      expect(alertCreate).toHaveBeenCalled();
      expect(publishAlert).toHaveBeenCalledWith("alert-pub-1", newEventId);
      expect(mockExecLogRepo.append).toHaveBeenCalledWith(
        expect.objectContaining({
          action_type: "publish_alert",
          status: "succeeded",
        }),
      );
    });

    it("throttles alert delivery when a watch alerted recently", async () => {
      const recentlyAlertedWatch = {
        ...mockWatchRow,
        status: "monitoring",
        visibility: "public" as const,
        source_event_ids: [] as string[],
        last_alert_sent_at: new Date().toISOString(), // within throttle window
        starts_at: "2026-07-01T00:00:00.000Z",
        ends_at: "2026-07-28T00:00:00.000Z",
      };
      const newEventId = "cccccccc-cccc-cccc-cccc-cccccccccccc";
      const alertCreate = vi.fn();
      const publishAlert = vi.fn();

      const throttledService = createSponsoredWatchService({
        watchRepo: mockWatchRepo as never,
        execLogRepo: mockExecLogRepo as never,
        eventRepo: mockEventRepo as never,
        web3Client: mockWeb3Client,
        frontendOrigin: "https://chronicle.example",
        notificationService: {
          sendTelegramToChat: vi.fn(),
          sendAlertBroadcast: vi.fn(),
          sendDigestBroadcast: vi.fn(),
          sendLowBalanceWarning: vi.fn(),
          sendRevenueRoutingNotification: vi.fn(),
          getConfiguredChannels: () => ({ telegram: true }),
          isTelegramSendConfigured: () => true,
        } as never,
        alertRepo: { create: alertCreate, findByDedupeKey: vi.fn().mockResolvedValue(null) } as never,
        alertPublicationService: { publishAlert } as never,
      });

      mockWatchRepo.listDueForActivation.mockResolvedValue({ ok: true, value: [] });
      mockWatchRepo.listInMonitoringWindow.mockResolvedValue({
        ok: true,
        value: [recentlyAlertedWatch],
      });
      mockWatchRepo.listDueForCompletion.mockResolvedValue({ ok: true, value: [] });
      mockWatchRepo.listCompletedNeedingReportRepair.mockResolvedValue({
        ok: true,
        value: [],
      });
      mockWatchRepo.update.mockImplementation(
        async (id: string, update: Record<string, unknown>) => ({
          ok: true,
          value: { ...recentlyAlertedWatch, id, ...update },
        }),
      );
      mockWatchRepo.findById.mockResolvedValue({
        ok: true,
        value: recentlyAlertedWatch,
      });
      mockEventRepo.listInWindow.mockResolvedValue({
        ok: true,
        value: [
          {
            id: newEventId,
            source: "keeperhub",
            source_event_id: "src-throttle",
            event_type: "large_swap",
            chain_id: 11155111,
            protocol: "uniswap",
            asset_symbols: ["USDC"],
            magnitude: null,
            transaction_hash: "0x" + "44".repeat(32),
            observed_at: null,
            captured_at: "2026-07-10T00:00:00.000Z",
            significance_score: 0.8,
            raw_payload: { address: recentlyAlertedWatch.target_contract },
            status: "qualified",
            created_at: "2026-07-10T00:00:00.000Z",
            updated_at: "2026-07-10T00:00:00.000Z",
          },
        ],
      });

      const cycle = await throttledService.processCampaignCycle(
        new Date("2026-07-10T12:00:00.000Z"),
      );

      expect(cycle.monitored).toBe(1);
      // No registry write / publication while throttled.
      expect(alertCreate).not.toHaveBeenCalled();
      expect(publishAlert).not.toHaveBeenCalled();
      // Events still fold into the cursor so they are not re-alerted later.
      const updateArg = mockWatchRepo.update.mock.calls[0]?.[1] as {
        source_event_ids?: string[];
        last_alert_sent_at?: string;
      };
      expect(updateArg.source_event_ids).toContain(newEventId);
      expect(updateArg.last_alert_sent_at).toBeTruthy();
      expect(mockExecLogRepo.append).toHaveBeenCalledWith(
        expect.objectContaining({
          action_type: "generate_alert",
          status: "succeeded",
          details: expect.objectContaining({ throttled: true }),
        }),
      );
    });

    it("reuses an existing alert row by dedupe key instead of re-inserting on retry", async () => {
      const publicWatch = {
        ...mockWatchRow,
        status: "monitoring",
        visibility: "public" as const,
        source_event_ids: [] as string[],
        starts_at: "2026-07-01T00:00:00.000Z",
        ends_at: "2026-07-28T00:00:00.000Z",
      };
      const newEventId = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
      const existingAlert = { id: "alert-already-created" };
      const alertCreate = vi.fn(); // must NOT be called — row already exists
      const publishAlert = vi.fn().mockResolvedValue({
        success: true,
        deliveryStatus: "published",
        message: "ok",
        registryTxHash: "0x" + "ff".repeat(32),
        explorerUrl: "https://sepolia.etherscan.io/tx/0xff",
      });

      const reuseService = createSponsoredWatchService({
        watchRepo: mockWatchRepo as never,
        execLogRepo: mockExecLogRepo as never,
        eventRepo: mockEventRepo as never,
        web3Client: mockWeb3Client,
        frontendOrigin: "https://chronicle.example",
        notificationService: {
          sendTelegramToChat: vi.fn(),
          sendAlertBroadcast: vi.fn(),
          sendDigestBroadcast: vi.fn(),
          sendLowBalanceWarning: vi.fn(),
          sendRevenueRoutingNotification: vi.fn(),
          getConfiguredChannels: () => ({ telegram: true }),
          isTelegramSendConfigured: () => true,
        } as never,
        alertRepo: {
          create: alertCreate,
          findByDedupeKey: vi.fn().mockResolvedValue(existingAlert),
        } as never,
        alertPublicationService: { publishAlert } as never,
      });

      mockWatchRepo.listDueForActivation.mockResolvedValue({ ok: true, value: [] });
      mockWatchRepo.listInMonitoringWindow.mockResolvedValue({
        ok: true,
        value: [publicWatch],
      });
      mockWatchRepo.listDueForCompletion.mockResolvedValue({ ok: true, value: [] });
      mockWatchRepo.listCompletedNeedingReportRepair.mockResolvedValue({
        ok: true,
        value: [],
      });
      mockWatchRepo.update.mockImplementation(
        async (id: string, update: Record<string, unknown>) => ({
          ok: true,
          value: { ...publicWatch, id, ...update },
        }),
      );
      mockWatchRepo.findById.mockResolvedValue({ ok: true, value: publicWatch });
      mockEventRepo.listInWindow.mockResolvedValue({
        ok: true,
        value: [
          {
            id: newEventId,
            source: "keeperhub",
            source_event_id: "src-reuse",
            event_type: "large_swap",
            chain_id: 11155111,
            protocol: "uniswap",
            asset_symbols: ["USDC"],
            magnitude: null,
            transaction_hash: "0x" + "66".repeat(32),
            observed_at: null,
            captured_at: "2026-07-10T00:00:00.000Z",
            significance_score: 0.8,
            raw_payload: { address: publicWatch.target_contract },
            status: "qualified",
            created_at: "2026-07-10T00:00:00.000Z",
            updated_at: "2026-07-10T00:00:00.000Z",
          },
        ],
      });

      const cycle = await reuseService.processCampaignCycle(
        new Date("2026-07-10T12:00:00.000Z"),
      );

      expect(cycle.monitored).toBe(1);
      expect(alertCreate).not.toHaveBeenCalled();
      // Publication is retried on the existing row and the cursor advances.
      expect(publishAlert).toHaveBeenCalledWith("alert-already-created", newEventId);
      const updateArg = mockWatchRepo.update.mock.calls[0]?.[1] as {
        source_event_ids?: string[];
      };
      expect(updateArg.source_event_ids).toContain(newEventId);
    });

    it("retries failed alert delivery without committing the cursor", async () => {
      const privateWatch = {
        ...mockWatchRow,
        status: "monitoring",
        visibility: "private" as const,
        telegram_chat_id: "999002",
        source_event_ids: [] as string[],
        starts_at: "2026-07-01T00:00:00.000Z",
        ends_at: "2026-07-28T00:00:00.000Z",
      };
      const newEventId = "dddddddd-dddd-dddd-dddd-dddddddddddd";
      // First delivery fails (transient Telegram error), second succeeds.
      const sendTelegramToChat = vi
        .fn()
        .mockResolvedValueOnce({
          delivered: false,
          destinations: [],
          failures: ["telegram:chat not found"],
        })
        .mockResolvedValueOnce({
          delivered: true,
          destinations: ["telegram:999002"],
          failures: [],
        });

      const retryService = createSponsoredWatchService({
        watchRepo: mockWatchRepo as never,
        execLogRepo: mockExecLogRepo as never,
        eventRepo: mockEventRepo as never,
        web3Client: mockWeb3Client,
        frontendOrigin: "https://chronicle.example",
        notificationService: {
          sendTelegramToChat,
          sendAlertBroadcast: vi.fn(),
          sendDigestBroadcast: vi.fn(),
          sendLowBalanceWarning: vi.fn(),
          sendRevenueRoutingNotification: vi.fn(),
          getConfiguredChannels: () => ({ telegram: true }),
          isTelegramSendConfigured: () => true,
        } as never,
        alertRepo: {
          create: vi.fn(),
          findByDedupeKey: vi.fn().mockResolvedValue(null),
        } as never,
        alertPublicationService: { publishAlert: vi.fn() } as never,
      });

      mockWatchRepo.listDueForActivation.mockResolvedValue({ ok: true, value: [] });
      mockWatchRepo.listInMonitoringWindow.mockResolvedValue({
        ok: true,
        value: [privateWatch],
      });
      mockWatchRepo.listDueForCompletion.mockResolvedValue({ ok: true, value: [] });
      mockWatchRepo.listCompletedNeedingReportRepair.mockResolvedValue({
        ok: true,
        value: [],
      });
      // findById keeps returning the *original* row (cursor never advances).
      mockWatchRepo.findById.mockResolvedValue({ ok: true, value: privateWatch });
      mockWatchRepo.update.mockImplementation(
        async (id: string, update: Record<string, unknown>) => ({
          ok: true,
          value: { ...privateWatch, id, ...update },
        }),
      );
      mockEventRepo.listInWindow.mockResolvedValue({
        ok: true,
        value: [
          {
            id: newEventId,
            source: "keeperhub",
            source_event_id: "src-retry",
            event_type: "large_swap",
            chain_id: 11155111,
            protocol: "uniswap",
            asset_symbols: ["USDC"],
            magnitude: null,
            transaction_hash: "0x" + "55".repeat(32),
            observed_at: null,
            captured_at: "2026-07-10T00:00:00.000Z",
            significance_score: 0.8,
            raw_payload: { address: privateWatch.target_contract },
            status: "qualified",
            created_at: "2026-07-10T00:00:00.000Z",
            updated_at: "2026-07-10T00:00:00.000Z",
          },
        ],
      });

      const first = await retryService.processCampaignCycle(
        new Date("2026-07-10T12:00:00.000Z"),
      );
      const second = await retryService.processCampaignCycle(
        new Date("2026-07-10T12:01:00.000Z"),
      );

      expect(first.monitored).toBe(1);
      expect(second.monitored).toBe(1);
      // Failed delivery did not advance the cursor → same events re-delivered.
      expect(sendTelegramToChat).toHaveBeenCalledTimes(2);
      // The failed tick kept prior source_event_ids and did not set the alert cursor.
      const failedUpdate = mockWatchRepo.update.mock.calls[0]?.[1] as {
        source_event_ids?: string[];
        last_alert_sent_at?: string;
      };
      expect(failedUpdate.source_event_ids).toEqual([]);
      expect(failedUpdate.last_alert_sent_at).toBeUndefined();
      // The successful tick finally committed the cursor.
      const okUpdate = mockWatchRepo.update.mock.calls[1]?.[1] as {
        source_event_ids?: string[];
        last_alert_sent_at?: string;
      };
      expect(okUpdate.source_event_ids).toContain(newEventId);
      expect(okUpdate.last_alert_sent_at).toBeTruthy();
    });
  });
});
