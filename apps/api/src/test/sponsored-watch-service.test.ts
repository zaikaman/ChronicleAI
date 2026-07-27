// Unit tests for Sponsored Watch Service
// Tests campaign lifecycle, on-chain registry execution, and event monitoring

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSponsoredWatchService } from "../services/sponsored-watch-service.ts";
import type { Web3Client } from "../services/web3-client-service.ts";

describe("SponsoredWatchService", () => {
  const mockWatchRepo = {
    create: vi.fn(),
    findById: vi.fn(),
    list: vi.fn(),
    listActive: vi.fn(),
    update: vi.fn(),
    updateStatus: vi.fn(),
  };

  const mockExecLogRepo = {
    append: vi.fn(),
    listByEntity: vi.fn(),
    listRecent: vi.fn(),
  };

  const mockWeb3Client: Web3Client = {
    getSignerAddress: vi.fn().mockResolvedValue("0xsigner"),
    publishAlert: vi.fn(),
    publishDigest: vi.fn(),
    createSponsoredWatch: vi.fn().mockResolvedValue({
      watchId: 42,
      txHash: "0x" + "a".repeat(64),
    }),
    publishSponsoredReport: vi.fn().mockResolvedValue("0x" + "b".repeat(64)),
    recordPayout: vi.fn(),
    sendTransfer: vi.fn(),
  };

  const service = createSponsoredWatchService({
    watchRepo: mockWatchRepo as never,
    execLogRepo: mockExecLogRepo as never,
    web3Client: mockWeb3Client,
  });

  const mockWatchRow = {
    id: "watch-001",
    target_contract: "0x1234567890abcdef",
    watch_spec_hash: "0xspec001",
    starts_at: "2026-07-06T00:00:00.000Z",
    ends_at: "2026-07-13T00:00:00.000Z",
    create_tx_hash: null,
    report_tx_hash: null,
    report_content_hash: null,
    content_uri: null,
    status: "accepted",
    created_at: "2026-07-06T00:00:00.000Z",
    updated_at: "2026-07-06T00:00:00.000Z",
  };

  beforeEach(() => {
    vi.resetAllMocks();
    (mockWeb3Client.createSponsoredWatch as ReturnType<typeof vi.fn>).mockResolvedValue({
      watchId: 42,
      txHash: "0x" + "a".repeat(64),
    });
    (mockWeb3Client.publishSponsoredReport as ReturnType<typeof vi.fn>).mockResolvedValue(
      "0x" + "b".repeat(64),
    );
  });

  describe("createSponsoredWatch", () => {
    it("should create a watch with a real on-chain tx hash", async () => {
      mockWatchRepo.create.mockResolvedValue({
        ok: true,
        value: { ...mockWatchRow, create_tx_hash: "0x" + "a".repeat(64) },
      });
      mockExecLogRepo.append.mockResolvedValue({ ok: true, value: {} });

      const result = await service.createSponsoredWatch({
        targetContract: "0x1234567890abcdef",
        watchSpecHash: "0xspec001",
        startsAt: "2026-07-06T00:00:00.000Z",
        endsAt: "2026-07-13T00:00:00.000Z",
      });

      expect(result.create_tx_hash).toBe("0x" + "a".repeat(64));
      expect(result.status).toBe("accepted");
      expect(mockWeb3Client.createSponsoredWatch).toHaveBeenCalled();
      expect(mockWatchRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          target_contract: "0x1234567890abcdef",
          watch_spec_hash: "0xspec001",
          create_tx_hash: "0x" + "a".repeat(64),
          status: "accepted",
        }),
      );
      expect(mockExecLogRepo.append).toHaveBeenCalled();
    });

    it("should throw when web3 client is not configured", async () => {
      const noWeb3 = createSponsoredWatchService({
        watchRepo: mockWatchRepo as never,
        execLogRepo: mockExecLogRepo as never,
        web3Client: null,
      });

      await expect(
        noWeb3.createSponsoredWatch({
          targetContract: "0x1234567890abcdef",
          watchSpecHash: "0xspec001",
          startsAt: "2026-07-06T00:00:00.000Z",
          endsAt: "2026-07-13T00:00:00.000Z",
        }),
      ).rejects.toThrow("Web3 client not configured");
    });

    it("should throw when on-chain createSponsoredWatch fails", async () => {
      (mockWeb3Client.createSponsoredWatch as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("RPC down"),
      );
      mockExecLogRepo.append.mockResolvedValue({ ok: true, value: {} });

      await expect(
        service.createSponsoredWatch({
          targetContract: "0x1234567890abcdef",
          watchSpecHash: "0xspec001",
          startsAt: "2026-07-06T00:00:00.000Z",
          endsAt: "2026-07-13T00:00:00.000Z",
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
          targetContract: "0x1234567890abcdef",
          watchSpecHash: "0xspec001",
          startsAt: "2026-07-06T00:00:00.000Z",
          endsAt: "2026-07-13T00:00:00.000Z",
        }),
      ).rejects.toThrow("DB error");
    });
  });

  describe("completeWatch", () => {
    it("should complete a watch with on-chain report tx hash", async () => {
      mockWatchRepo.updateStatus.mockResolvedValue({
        ok: true,
        value: {
          ...mockWatchRow,
          status: "completed",
          report_content_hash: "0xreporthash",
          report_tx_hash: "0x" + "b".repeat(64),
        },
      });
      mockExecLogRepo.append.mockResolvedValue({ ok: true, value: {} });

      const result = await service.completeWatch("watch-001", "0xreporthash");

      expect(result.status).toBe("completed");
      expect(result.report_content_hash).toBe("0xreporthash");
      expect(result.report_tx_hash).toBe("0x" + "b".repeat(64));
      expect(mockWeb3Client.publishSponsoredReport).toHaveBeenCalled();
      expect(mockWatchRepo.updateStatus).toHaveBeenCalledWith(
        "watch-001",
        "completed",
        expect.objectContaining({
          report_content_hash: "0xreporthash",
          report_tx_hash: "0x" + "b".repeat(64),
        }),
      );
    });

    it("should throw when on-chain publishSponsoredReport fails", async () => {
      (mockWeb3Client.publishSponsoredReport as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("tx reverted"),
      );
      mockExecLogRepo.append.mockResolvedValue({ ok: true, value: {} });

      await expect(service.completeWatch("watch-001", "0xhash")).rejects.toThrow(
        "On-chain publishSponsoredReport failed",
      );
      expect(mockWatchRepo.updateStatus).not.toHaveBeenCalled();
    });

    it("should throw on repository failure during completion", async () => {
      mockWatchRepo.updateStatus.mockResolvedValue({
        ok: false,
        error: new Error("Update failed"),
      });

      await expect(service.completeWatch("watch-001", "0xhash")).rejects.toThrow("Update failed");
    });
  });

  describe("failWatch", () => {
    it("should mark a watch as failed", async () => {
      mockWatchRepo.updateStatus.mockResolvedValue({
        ok: true,
        value: { ...mockWatchRow, status: "failed" },
      });
      mockExecLogRepo.append.mockResolvedValue({ ok: true, value: {} });

      const result = await service.failWatch("watch-001", "Monitoring timeout");

      expect(result.status).toBe("failed");
      expect(mockWatchRepo.updateStatus).toHaveBeenCalledWith("watch-001", "failed");
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
      expect(result[0]?.target_contract).toBe("0x1234567890abcdef");
    });

    it("should throw on repository failure", async () => {
      mockWatchRepo.listActive.mockResolvedValue({
        ok: false,
        error: new Error("List failed"),
      });

      await expect(service.getActiveWatches()).rejects.toThrow("List failed");
    });
  });
});
