/**
 * Treasury transfers use the public KeeperHub workflow path.
 */
import { describe, expect, it, vi } from "vitest";
import { createCapitalManager } from "../desk/capital-manager.ts";
import type { DeskPolicyConfig } from "../desk/types.ts";
import {
  isKeeperHubTransferConfigured,
  resolveTreasuryTransferPath,
} from "../services/web3-client-service.ts";
import type { Web3Client } from "../services/web3-client-service.ts";
import type { ParaTreasuryClient } from "../services/para-treasury-client.ts";
import type { ServerEnv } from "@chronicleai/config";

function policy(overrides: Partial<DeskPolicyConfig> = {}): DeskPolicyConfig {
  return {
    targetAumUsdc: 50,
    maxAumUsdc: 100,
    minAumUsdc: 20,
    topupChunkUsdc: 10,
    minFreeUsdc: 10,
    inventoryTopupUsdc: 10,
    preferUnwindForFreeUsdc: true,
    profitSweepUsdc: 20,
    topupCooldownMs: 0,
    postMaintenanceSweepCooldownMs: 0,
    hfWarn: 1.2,
    hfCritical: 1.05,
    basisBps: 30,
    apyDeltaBps: 50,
    maxTradeUsdc: 25,
    killHeartbeatMs: 60_000,
    failedRunCooldownMs: 0,
    oracleMaxStalenessMs: 60_000,
    apyConsecutivePolls: 2,
    apyAbsurdBps: 5000,
    rebalanceIntervalMs: 0,
    maintenanceNotionalUsdc: 10,
    gasElevatedGwei: 50,
    eventMicrotradeEnabled: false,
    eventMicrotradeUsdc: 5,
    eventMicrotradeCooldownMs: 0,
    eventMicrotradeLookbackMs: 0,
    paused: false,
    ...overrides,
  };
}

function mockCapitalMoves() {
  return {
    create: vi.fn().mockImplementation(async (row: Record<string, unknown>) => ({
      ok: true as const,
      value: {
        id: "move-1",
        created_at: new Date().toISOString(),
        ...row,
      },
    })),
    update: vi.fn().mockResolvedValue({ ok: true, value: { id: "move-1" } }),
    findLatestByDirection: vi.fn().mockResolvedValue({ ok: true, value: null }),
    listRecent: vi.fn().mockResolvedValue({ ok: true, value: [] }),
  };
}

function baseEnv(overrides: Partial<ServerEnv> = {}): ServerEnv {
  return {
    nodeEnv: "test",
    port: 3001,
    databaseUrl: "postgres://test",
    treasuryPrivateTransferThresholdUsdc: 50,
    deskUsePrivateMempool: true,
    deskPrivateMempoolStrict: true,
    registryUsePrivateMempool: true,
    routingProviderLabel: "flashbots_protect",
    keeperhubApiBaseUrl: "https://kh.example",
    keeperhubApiKey: "kh_test_key",
    chronicleRegistryAddress: "0x" + "11".repeat(20),
    keeperhubWorkflowTransfer: "wf-transfer-1",
    deskUsdcAddress: "0x" + "22".repeat(20),
    ...overrides,
  } as ServerEnv;
}

describe("resolveTreasuryTransferPath / isKeeperHubTransferConfigured", () => {
  it("detects KH transfer config when workflow + USDC + KH write ready", () => {
    expect(isKeeperHubTransferConfigured(baseEnv())).toBe(true);
    expect(
      isKeeperHubTransferConfigured(
        baseEnv({ keeperhubWorkflowTransfer: undefined }),
      ),
    ).toBe(false);
    expect(
      isKeeperHubTransferConfigured(baseEnv({ deskUsdcAddress: "not-an-address" })),
    ).toBe(false);
  });

  it("selects public KeeperHub at every amount when fully configured", () => {
    expect(resolveTreasuryTransferPath(baseEnv(), 50, { paraAvailable: true })).toBe(
      "keeperhub",
    );
    expect(resolveTreasuryTransferPath(baseEnv(), 12, { paraAvailable: true })).toBe(
      "keeperhub",
    );
  });
});

describe("capital manager top-up path selection", () => {
  const desk = "0x1111111111111111111111111111111111111111";
  const treasury = "0x2222222222222222222222222222222222222222";

  it("routes large top-up through web3 (KH-backed) not Para alone", async () => {
    const paraSend = vi.fn();
    const web3Send = vi.fn().mockResolvedValue({
      txHash: "0xabc",
      explorerUrl: "https://sepolia.etherscan.io/tx/0xabc",
      keeperHubRunId: "run-kh-1",
    });

    const paraTreasury = {
      sendTransfer: paraSend,
    } as unknown as ParaTreasuryClient;

    const web3 = {
      sendTransfer: web3Send,
      verifyTransfer: vi.fn().mockResolvedValue({ valid: true }),
      isKeeperHubBacked: () => true,
      isParaTreasuryBacked: () => true,
    } as unknown as Web3Client;

    const manager = createCapitalManager({
      config: policy(),
      deskWalletAddress: desk,
      treasuryAddress: treasury,
      capitalMoves: mockCapitalMoves() as never,
      paraTreasury,
      web3,
      treasuryPrivateTransferThresholdUsdc: 50,
    });

    const result = await manager.executeTopup(75, "test_large_topup");
    expect(result.errorMessage).toBeUndefined();
    expect(web3Send).toHaveBeenCalledWith(
      desk.toLowerCase(),
      75,
      expect.stringMatching(/^chronicle-desk-topup-/),
    );
    expect(paraSend).not.toHaveBeenCalled();
    expect(result.keeperHubRunId).toBe("run-kh-1");
    expect(result.txHash).toBe("0xabc");
  });

  it("routes small top-ups through KeeperHub when both clients exist", async () => {
    const paraSend = vi.fn().mockResolvedValue({
      txHash: "0xpara",
      explorerUrl: "https://sepolia.etherscan.io/tx/0xpara",
    });
    const web3Send = vi.fn().mockResolvedValue({
      txHash: "0xkeeperhub-small",
      explorerUrl: "https://sepolia.etherscan.io/tx/0xkeeperhub-small",
      keeperHubRunId: "run-kh-small",
    });

    const manager = createCapitalManager({
      config: policy(),
      deskWalletAddress: desk,
      treasuryAddress: treasury,
      capitalMoves: mockCapitalMoves() as never,
      paraTreasury: { sendTransfer: paraSend } as unknown as ParaTreasuryClient,
      web3: {
        sendTransfer: web3Send,
        verifyTransfer: vi.fn().mockResolvedValue({ valid: true }),
        isKeeperHubBacked: () => true,
        isParaTreasuryBacked: () => true,
      } as unknown as Web3Client,
      treasuryPrivateTransferThresholdUsdc: 50,
    });

    const result = await manager.executeTopup(10, "test_small_topup");
    expect(result.errorMessage).toBeUndefined();
    expect(web3Send).toHaveBeenCalledWith(
      desk.toLowerCase(),
      10,
      expect.stringMatching(/^chronicle-desk-topup-/),
    );
    expect(paraSend).not.toHaveBeenCalled();
  });

  it("uses web3 when Para is absent even for small amounts", async () => {
    const web3Send = vi.fn().mockResolvedValue({
      txHash: "0xweb3",
      keeperHubRunId: "run-2",
    });

    const manager = createCapitalManager({
      config: policy(),
      deskWalletAddress: desk,
      treasuryAddress: treasury,
      capitalMoves: mockCapitalMoves() as never,
      web3: {
        sendTransfer: web3Send,
        verifyTransfer: vi.fn().mockResolvedValue({ valid: true }),
        isKeeperHubBacked: () => true,
        isParaTreasuryBacked: () => false,
      } as unknown as Web3Client,
      treasuryPrivateTransferThresholdUsdc: 50,
    });

    const result = await manager.executeTopup(5, "test_web3_only");
    expect(result.errorMessage).toBeUndefined();
    expect(web3Send).toHaveBeenCalledWith(
      desk.toLowerCase(),
      5,
      expect.stringMatching(/^chronicle-desk-topup-/),
    );
  });

  it("rejects a KeeperHub receipt that is not treasury to desk", async () => {
    const capitalMoves = mockCapitalMoves();
    const web3Send = vi.fn().mockResolvedValue({
      txHash: "0xwrong-transfer",
      keeperHubRunId: "run-wrong-transfer",
    });

    const manager = createCapitalManager({
      config: policy(),
      deskWalletAddress: desk,
      treasuryAddress: treasury,
      capitalMoves: capitalMoves as never,
      web3: {
        sendTransfer: web3Send,
        verifyTransfer: vi.fn().mockResolvedValue({
          valid: false,
          error: "Observed desk-to-desk transfer",
        }),
        isKeeperHubBacked: () => true,
        isParaTreasuryBacked: () => false,
      } as unknown as Web3Client,
      treasuryPrivateTransferThresholdUsdc: 50,
    });

    const result = await manager.executeTopup(10, "test_wrong_transfer");

    expect(result.errorMessage).toBe("Observed desk-to-desk transfer");
    expect(capitalMoves.create).not.toHaveBeenCalled();
  });
});
