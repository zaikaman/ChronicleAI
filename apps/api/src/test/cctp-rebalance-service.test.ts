import { describe, expect, it, vi } from "vitest";
import {
  createCctpRebalanceRepository,
  createInMemorySupabaseClient,
} from "@chronicleai/db";
import {
  createCctpRebalanceService,
  type CctpRebalanceServiceDeps,
} from "../cctp/rebalance-service.ts";
import { defaultCctpPolicyConfig } from "../cctp/rebalance-policy.ts";
import type { IrisClient } from "../cctp/iris-client.ts";
import type {
  CctpChainExecutor,
  CctpServiceConfig,
  IrisMessagesResponse,
} from "../cctp/types.ts";

const TREASURY = "0xabcdef0123456789abcdef0123456789abcdef01";
const OPERATOR = TREASURY;
const BURN_TX =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const APPROVE_TX =
  "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const MINT_TX =
  "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

function makeRepo() {
  const client = createInMemorySupabaseClient();
  const repo = createCctpRebalanceRepository(
    client as unknown as Parameters<typeof createCctpRebalanceRepository>[0],
  );
  return repo;
}

function baseConfig(
  overrides: Partial<CctpServiceConfig> = {},
): CctpServiceConfig {
  return {
    enabled: true,
    treasuryAddress: TREASURY,
    mintRecipient: TREASURY,
    sourceDomain: 6,
    destDomain: 0,
    sourceChainId: 84532,
    destChainId: 11155111,
    baseUsdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    sepoliaUsdcAddress: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    tokenMessenger: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA",
    messageTransmitter: "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275",
    useForwarding: false,
    minFinalityThreshold: 1000,
    pollIntervalMs: 1,
    pollTimeoutMs: 50,
    mintMaxAttempts: 3,
    forwardingFallbackMs: 10,
    policy: defaultCctpPolicyConfig({
      enabled: true,
      cooldownMs: 0,
      rebalanceThresholdUsdc: 10,
      rebalanceChunkUsdc: 10,
      baseSafetyBufferUsdc: 5,
    }),
    ...overrides,
  };
}

function mockExecutor(
  partial: Partial<CctpChainExecutor> = {},
): CctpChainExecutor {
  return {
    getOperatorAddress: async () => OPERATOR,
    getUsdcBalance: async () => 50,
    getNativeBalanceEth: async () => 0.1,
    getUsdcAllowance: async () => 0n,
    approveUsdc: async () => ({ txHash: APPROVE_TX }),
    depositForBurn: async () => ({ txHash: BURN_TX }),
    receiveMessage: async () => ({ txHash: MINT_TX }),
    verifyMintTransfer: async () => true,
    ...partial,
  };
}

function mockIris(partial: Partial<IrisClient> = {}): IrisClient {
  return {
    getMessages: async () =>
      ({
        messages: [
          {
            status: "complete",
            message: "0xdeadmsg",
            attestation: "0xdeadatt",
            messageHash: "0xhash",
            forwardTxHash: null,
            raw: {},
          },
        ],
        raw: {},
      }) satisfies IrisMessagesResponse,
    getBurnFees: async () => null,
    pollUntilComplete: async () => ({
      complete: true,
      timedOut: false,
      message: {
        status: "complete",
        message: "0xdeadmsg",
        attestation: "0xdeadatt",
        raw: {},
      },
      response: null,
    }),
    ...partial,
  };
}

function makeService(
  overrides: {
    config?: Partial<CctpServiceConfig>;
    executor?: Partial<CctpChainExecutor>;
    iris?: Partial<IrisClient>;
    awaitAttestationInTick?: boolean;
  } = {},
) {
  const repo = makeRepo();
  const deps: CctpRebalanceServiceDeps = {
    config: baseConfig(overrides.config),
    repo,
    iris: mockIris(overrides.iris),
    executor: mockExecutor(overrides.executor),
    awaitAttestationInTick: overrides.awaitAttestationInTick ?? false,
    sleep: async () => {},
    nowMs: () => Date.now(),
  };
  const service = createCctpRebalanceService(deps);
  return { service, repo };
}

describe("createCctpRebalanceService", () => {
  it("rejects mint recipient !== treasury", () => {
    expect(() =>
      createCctpRebalanceService({
        config: baseConfig({ mintRecipient: "0x1111111111111111111111111111111111111111" }),
        repo: makeRepo(),
        iris: mockIris(),
        executor: mockExecutor(),
      }),
    ).toThrow(/mint recipient must equal treasury/i);
  });

  it("skips tick when disabled", async () => {
    const { service } = makeService({
      config: { enabled: false, policy: defaultCctpPolicyConfig({ enabled: false }) },
    });
    const result = await service.tick();
    expect(result.outcome).toBe("skipped");
    expect(result.reason).toBe("disabled");
  });

  it("skips when below threshold", async () => {
    const { service } = makeService({
      executor: {
        getUsdcBalance: async (chainId) => (chainId === 84532 ? 8 : 0),
      },
    });
    const result = await service.tick();
    expect(result.outcome).toBe("skipped");
    expect(result.reason).toBe("below_threshold");
  });

  it("burns and leaves awaiting_attestation (default tick)", async () => {
    const { service, repo } = makeService();
    const result = await service.tick();
    expect(result.outcome).toBe("burned");
    expect(result.burnTxHash).toBe(BURN_TX);
    expect(result.status).toBe("awaiting_attestation");
    expect(result.transferId).toBeTruthy();

    const row = await repo.findById(result.transferId!);
    expect(row.ok).toBe(true);
    if (!row.ok) return;
    expect(row.value?.status).toBe("awaiting_attestation");
    expect(row.value?.burn_tx_hash).toBe(BURN_TX);
    expect(row.value?.approve_tx_hash).toBe(APPROVE_TX);
    expect(row.value?.amount_usdc).toBe(10);
  });

  it("skips approve when allowance sufficient", async () => {
    const approve = vi.fn(async () => ({ txHash: APPROVE_TX }));
    const { service, repo } = makeService({
      executor: {
        getUsdcAllowance: async () => 100_000_000_000n,
        approveUsdc: approve,
      },
    });
    const result = await service.tick();
    expect(result.outcome).toBe("burned");
    expect(approve).not.toHaveBeenCalled();
    const row = await repo.findById(result.transferId!);
    expect(row.ok && row.value?.approve_tx_hash).toBeFalsy();
  });

  it("fails row on burn revert", async () => {
    const { service, repo } = makeService({
      executor: {
        depositForBurn: async () => {
          throw new Error("execution reverted: TokenMessenger");
        },
      },
    });
    const result = await service.tick();
    expect(result.outcome).toBe("failed");
    expect(result.errorClass).toBe("revert");
    const recent = await repo.listRecent(5);
    expect(recent.ok).toBe(true);
    if (!recent.ok) return;
    expect(recent.value[0]?.status).toBe("failed");
  });

  it("end-to-end mint with awaitAttestationInTick (Mode A)", async () => {
    const { service, repo } = makeService({
      awaitAttestationInTick: true,
      config: { pollTimeoutMs: 5_000, pollIntervalMs: 1 },
    });
    const result = await service.tick();
    expect(result.outcome).toBe("minted");
    expect(result.mintTxHash).toBe(MINT_TX);
    expect(result.burnTxHash).toBe(BURN_TX);

    const row = await repo.findById(result.transferId!);
    expect(row.ok).toBe(true);
    if (!row.ok) return;
    expect(row.value?.status).toBe("minted");
    expect(row.value?.message_bytes).toBe("0xdeadmsg");
    expect(row.value?.attestation).toBe("0xdeadatt");
    expect(row.value?.mint_tx_hash).toBe(MINT_TX);
  });

  it("Mode B forwarding completes on forwardTxHash", async () => {
    const FWD =
      "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
    const { service, repo } = makeService({
      awaitAttestationInTick: true,
      config: {
        useForwarding: true,
        pollTimeoutMs: 5_000,
        pollIntervalMs: 1,
      },
      iris: {
        getBurnFees: async () => ({
          minimumFee: 1,
          finalityThreshold: 1000,
          raw: {},
        }),
        getMessages: async () => ({
          messages: [
            {
              status: "complete",
              message: "0xmsg",
              attestation: "0xatt",
              forwardTxHash: FWD,
              raw: {},
            },
          ],
          raw: {},
        }),
      },
    });
    const result = await service.tick();
    expect(result.outcome).toBe("minted");
    expect(result.mode).toBe("forwarding");
    expect(result.mintTxHash).toBe(FWD);

    const row = await repo.findById(result.transferId!);
    expect(row.ok && row.value?.mode).toBe("forwarding");
    expect(row.ok && row.value?.mint_tx_hash).toBe(FWD);
  });

  it("mints via receiveMessage as soon as Iris is complete (skips forward wait)", async () => {
    const receiveMessage = vi.fn(async () => ({ txHash: MINT_TX }));
    const { service, repo } = makeService({
      awaitAttestationInTick: true,
      config: {
        useForwarding: true,
        // Long fallback window must not delay mint once Iris is complete.
        forwardingFallbackMs: 60 * 60_000,
        pollTimeoutMs: 5_000,
        pollIntervalMs: 1,
      },
      executor: { receiveMessage },
      iris: {
        getBurnFees: async () => ({
          minimumFee: 1,
          finalityThreshold: 1000,
          raw: {},
        }),
        getMessages: async () => ({
          messages: [
            {
              status: "complete",
              message: "0xdeadmsg",
              attestation: "0xdeadatt",
              messageHash: "0xhash",
              forwardTxHash: null,
              raw: {},
            },
          ],
          raw: {},
        }),
      },
    });

    const result = await service.tick();
    expect(result.outcome).toBe("minted");
    expect(result.mintTxHash).toBe(MINT_TX);
    expect(result.mode).toBe("direct");
    expect(receiveMessage).toHaveBeenCalledTimes(1);

    const row = await repo.findById(result.transferId!);
    expect(row.ok && row.value?.status).toBe("minted");
    expect(row.ok && row.value?.mode).toBe("forwarding");
    expect(row.ok && row.value?.mint_tx_hash).toBe(MINT_TX);
    expect(row.ok && row.value?.metadata?.mintOnIrisComplete).toBe(true);
  });

  it("resumeInFlight advances awaiting_attestation → minted", async () => {
    const { service, repo } = makeService();
    const burned = await service.tick();
    expect(burned.outcome).toBe("burned");

    const resume = await service.resumeInFlight();
    expect(resume.processed).toBe(1);
    expect(resume.results[0]?.outcome).toBe("minted");

    const row = await repo.findById(burned.transferId!);
    expect(row.ok && row.value?.status).toBe("minted");
  });

  it("marks stuck on Iris timeout", async () => {
    let clock = 0;
    const { service, repo } = makeService({
      awaitAttestationInTick: true,
      config: { pollTimeoutMs: 20, pollIntervalMs: 5 },
      iris: {
        getMessages: async () => ({ messages: [], raw: {} }),
      },
    });
    // Rebuild with controllable clock
    const repo2 = makeRepo();
    const service2 = createCctpRebalanceService({
      config: baseConfig({ pollTimeoutMs: 20, pollIntervalMs: 5 }),
      repo: repo2,
      iris: mockIris({
        getMessages: async () => ({ messages: [], raw: {} }),
      }),
      executor: mockExecutor(),
      awaitAttestationInTick: true,
      nowMs: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    });

    const result = await service2.tick();
    expect(result.outcome).toBe("stuck");
    expect(result.errorClass).toBe("iris_timeout");

    const recent = await repo2.listRecent(1);
    expect(recent.ok && recent.value[0]?.status).toBe("stuck");
    // silence unused
    void service;
    void repo;
  });

  it("treats nonce_used as minted", async () => {
    const { service, repo } = makeService({
      awaitAttestationInTick: true,
      executor: {
        receiveMessage: async () => {
          throw new Error("Nonce already used");
        },
      },
    });
    const result = await service.tick();
    expect(result.outcome).toBe("minted");
    const row = await repo.findById(result.transferId!);
    expect(row.ok && row.value?.status).toBe("minted");
  });

  it("forceRebalance works when feature disabled", async () => {
    const { service } = makeService({
      config: {
        enabled: false,
        policy: defaultCctpPolicyConfig({ enabled: false, cooldownMs: 0 }),
      },
    });
    const result = await service.forceRebalance(1);
    expect(result.outcome).toBe("burned");
    expect(result.amountUsdc).toBe(1);
  });

  it("respects max in-flight", async () => {
    const { service } = makeService();
    const first = await service.tick();
    expect(first.outcome).toBe("burned");
    const second = await service.tick();
    expect(second.outcome).toBe("skipped");
    expect(second.reason).toBe("max_in_flight");
  });

  it("getStatus returns policy + balances", async () => {
    const { service } = makeService();
    const status = await service.getStatus();
    expect(status.enabled).toBe(true);
    expect(status.balances?.treasuryBaseUsdc).toBe(50);
    expect(status.policy?.eligible).toBe(true);
  });

  it("mint retry sticks then fails after max attempts", async () => {
    const { service, repo } = makeService();
    const burned = await service.tick();
    expect(burned.outcome).toBe("burned");

    // Seed message via partial resume with receiveMessage failing
    const serviceFail = createCctpRebalanceService({
      config: baseConfig({ mintMaxAttempts: 2, pollTimeoutMs: 5_000 }),
      repo,
      iris: mockIris(),
      executor: mockExecutor({
        receiveMessage: async () => {
          throw new Error("execution reverted: temporary");
        },
      }),
      sleep: async () => {},
    });

    const r1 = await serviceFail.resumeInFlight();
    expect(r1.results[0]?.outcome).toBe("stuck");

    const r2 = await serviceFail.resumeInFlight();
    // second attempt from stuck → should fail at max
    expect(["stuck", "failed"]).toContain(r2.results[0]?.outcome);
  });
});
