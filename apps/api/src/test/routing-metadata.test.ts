import { describe, expect, it } from "vitest";
import {
  buildDeskRoutingDetails,
  buildKillSwitchRoutingDetails,
  buildPrivateRoutingDetails,
  buildRegistryRoutingDetails,
  executionRoutingForDigest,
  extractRoutingFromDetails,
  PRIVATE_ROUTING_CHAIN_ID,
  publicPrivateRoutingStatus,
  routingBadgeLabel,
  routingExecutionPathCopy,
  routingPolicyForClass,
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
});
