import { describe, expect, it } from "vitest";
import {
  buildDeskRoutingDetails,
  buildKillSwitchRoutingDetails,
  buildPrivateRoutingDetails,
  buildRegistryRoutingDetails,
  buildTransferRoutingDetails,
  executionRoutingForDigest,
  extractRoutingFromDetails,
  isAmountAtOrAbovePrivateTransferThreshold,
  isKeeperHubTransferPath,
  PRIVATE_ROUTING_CHAIN_ID,
  publicPrivateRoutingStatus,
  routingBadgeLabel,
  routingExecutionPathCopy,
  routingPolicyForClass,
  selectTreasuryTransferPath,
} from "../services/routing-metadata.ts";

describe("routing-metadata", () => {
  const baseEnv = {
    deskUsePrivateMempool: true,
    deskPrivateMempoolStrict: true,
    registryUsePrivateMempool: true,
    routingProviderLabel: "flashbots_protect",
  };

  it("buildPrivateRoutingDetails emits requested private_mempool with unknown applied", () => {
    const details = buildPrivateRoutingDetails({
      enabled: true,
      strict: true,
      provider: "flashbots_protect",
      chainId: PRIVATE_ROUTING_CHAIN_ID,
    });
    expect(details).toEqual({
      routing: "private_mempool",
      routingStrict: true,
      routingProvider: "flashbots_protect",
      chainId: 11_155_111,
      routingRequested: "private_mempool",
      routingApplied: "unknown",
    });
  });

  it("buildPrivateRoutingDetails emits public when policy disabled", () => {
    const details = buildPrivateRoutingDetails({
      enabled: false,
      strict: true,
      provider: "flashbots_protect",
      chainId: PRIVATE_ROUTING_CHAIN_ID,
    });
    expect(details.routing).toBe("public");
    expect(details.routingRequested).toBe("public");
    expect(details.routingApplied).toBe("public");
    expect(details.routingStrict).toBe(false);
  });

  it("kill_switch always private + strict regardless of desk flag", () => {
    const policy = routingPolicyForClass(
      { ...baseEnv, deskUsePrivateMempool: false },
      "kill_switch",
    );
    expect(policy.enabled).toBe(true);
    expect(policy.strict).toBe(true);
    const details = buildKillSwitchRoutingDetails(baseEnv);
    expect(details.routing).toBe("private_mempool");
    expect(details.routingStrict).toBe(true);
  });

  it("registry class follows REGISTRY_USE_PRIVATE_MEMPOOL", () => {
    const off = buildRegistryRoutingDetails({
      ...baseEnv,
      registryUsePrivateMempool: false,
    });
    expect(off.routing).toBe("public");
    const on = buildRegistryRoutingDetails(baseEnv);
    expect(on.routing).toBe("private_mempool");
  });

  it("desk class follows DESK_USE_PRIVATE_MEMPOOL", () => {
    expect(buildDeskRoutingDetails(baseEnv).routing).toBe("private_mempool");
    expect(
      buildDeskRoutingDetails({ ...baseEnv, deskUsePrivateMempool: false }).routing,
    ).toBe("public");
  });

  it("extractRoutingFromDetails parses stored log details", () => {
    const details = buildDeskRoutingDetails(baseEnv);
    const extracted = extractRoutingFromDetails({
      ...details,
      method: "rotate",
      workflowId: "wf-1",
    });
    expect(extracted).toMatchObject({
      routing: "private_mempool",
      routingRequested: "private_mempool",
      routingApplied: "unknown",
      chainId: 11_155_111,
    });
    expect(extractRoutingFromDetails({})).toBeNull();
    expect(extractRoutingFromDetails(null)).toBeNull();
  });

  it("routingBadgeLabel prefers requested when applied unknown", () => {
    const details = buildDeskRoutingDetails(baseEnv);
    expect(routingBadgeLabel(details)).toBe("Private route (requested)");
    expect(
      routingBadgeLabel({
        ...details,
        routingApplied: "private_mempool",
      }),
    ).toBe("Private route");
    expect(routingBadgeLabel(null)).toBe("Public");
  });

  it("routingExecutionPathCopy is calm and precise", () => {
    const details = buildDeskRoutingDetails(baseEnv);
    const copy = routingExecutionPathCopy(details);
    expect(copy).toMatch(/private mempool requested/i);
    expect(copy).toMatch(/Flashbots Protect/);
    expect(copy).toMatch(/Sepolia/);
    expect(copy).not.toMatch(/MEV-proof/i);
  });

  it("executionRoutingForDigest and publicPrivateRoutingStatus", () => {
    expect(executionRoutingForDigest(buildDeskRoutingDetails(baseEnv))).toBe(
      "private_mempool",
    );
    const status = publicPrivateRoutingStatus(baseEnv);
    expect(status.enabled).toBe(true);
    expect(status.label).toBe("Private routing: ON");
    expect(status.provider).toBe("flashbots_protect");
  });

  it("transfer class follows DESK_USE_PRIVATE_MEMPOOL", () => {
    expect(buildTransferRoutingDetails(baseEnv).routing).toBe("private_mempool");
    expect(
      buildTransferRoutingDetails({ ...baseEnv, deskUsePrivateMempool: false })
        .routing,
    ).toBe("public");
  });

  describe("Phase 3 treasury transfer path selection (Para hole closure)", () => {
    const threshold = 50;

    it("forces keeperhub_private at/above threshold when KH transfer configured", () => {
      expect(
        selectTreasuryTransferPath({
          amountUsdc: 50,
          thresholdUsdc: threshold,
          keeperHubTransferConfigured: true,
          paraAvailable: true,
        }),
      ).toBe("keeperhub_private");
      expect(
        selectTreasuryTransferPath({
          amountUsdc: 15200,
          thresholdUsdc: threshold,
          keeperHubTransferConfigured: true,
          paraAvailable: true,
        }),
      ).toBe("keeperhub_private");
    });

    it("allows Para below threshold when Para is available", () => {
      expect(
        selectTreasuryTransferPath({
          amountUsdc: 12.5,
          thresholdUsdc: threshold,
          keeperHubTransferConfigured: true,
          paraAvailable: true,
        }),
      ).toBe("para");
      expect(
        selectTreasuryTransferPath({
          amountUsdc: 49.99,
          thresholdUsdc: threshold,
          keeperHubTransferConfigured: true,
          paraAvailable: true,
        }),
      ).toBe("para");
    });

    it("falls back to Para above threshold when KH transfer is not configured", () => {
      expect(
        selectTreasuryTransferPath({
          amountUsdc: 100,
          thresholdUsdc: threshold,
          keeperHubTransferConfigured: false,
          paraAvailable: true,
        }),
      ).toBe("para");
    });

    it("uses keeperhub when Para unavailable and KH transfer configured", () => {
      expect(
        selectTreasuryTransferPath({
          amountUsdc: 10,
          thresholdUsdc: threshold,
          keeperHubTransferConfigured: true,
          paraAvailable: false,
        }),
      ).toBe("keeperhub");
    });

    it("throws when no transfer path is available", () => {
      expect(() =>
        selectTreasuryTransferPath({
          amountUsdc: 10,
          thresholdUsdc: threshold,
          keeperHubTransferConfigured: false,
          paraAvailable: false,
        }),
      ).toThrow(/No treasury transfer path/);
    });

    it("threshold helper treats invalid amounts as not forcing private", () => {
      expect(isAmountAtOrAbovePrivateTransferThreshold(0, 50)).toBe(false);
      expect(isAmountAtOrAbovePrivateTransferThreshold(-1, 50)).toBe(false);
      expect(isAmountAtOrAbovePrivateTransferThreshold(Number.NaN, 50)).toBe(
        false,
      );
      expect(isAmountAtOrAbovePrivateTransferThreshold(50, 50)).toBe(true);
      expect(isAmountAtOrAbovePrivateTransferThreshold(49.9, 50)).toBe(false);
    });

    it("isKeeperHubTransferPath identifies KH routes", () => {
      expect(isKeeperHubTransferPath("keeperhub_private")).toBe(true);
      expect(isKeeperHubTransferPath("keeperhub")).toBe(true);
      expect(isKeeperHubTransferPath("para")).toBe(false);
    });
  });
});
