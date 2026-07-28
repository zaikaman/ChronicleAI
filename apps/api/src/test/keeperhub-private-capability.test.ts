import { describe, expect, it, vi } from "vitest";
import {
  fetchKeeperHubPrivateMempoolCapability,
  warnIfPrivateRoutingMisconfigured,
} from "../services/keeperhub-private-capability.ts";

const SEPOLIA = 11_155_111;

describe("keeperhub-private-capability", () => {
  it("reports capable when Sepolia usePrivateMempoolRpc is true", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json([
        {
          chainId: SEPOLIA,
          name: "Ethereum Sepolia",
          usePrivateMempoolRpc: true,
          isEnabled: true,
        },
      ]),
    );

    const result = await fetchKeeperHubPrivateMempoolCapability({
      apiBaseUrl: "https://kh.example.com",
      apiKey: "kh_test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.usePrivateMempoolRpc).toBe(true);
      expect(result.privateRoutingCapable).toBe(true);
      expect(result.chainName).toBe("Ethereum Sepolia");
    }
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://kh.example.com/api/chains",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("reports not capable when usePrivateMempoolRpc is false", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json([
        {
          chainId: SEPOLIA,
          name: "Ethereum Sepolia",
          usePrivateMempoolRpc: false,
        },
      ]),
    );

    const result = await fetchKeeperHubPrivateMempoolCapability({
      apiBaseUrl: "https://kh.example.com/",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.usePrivateMempoolRpc).toBe(false);
      expect(result.privateRoutingCapable).toBe(false);
    }
  });

  it("returns error when chain is missing from list", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json([{ chainId: 1, usePrivateMempoolRpc: true }]),
    );

    const result = await fetchKeeperHubPrivateMempoolCapability({
      apiBaseUrl: "https://kh.example.com",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/no chainId/);
    }
  });

  it("warnIfPrivateRoutingMisconfigured logs when capability is false", async () => {
    const logWarn = vi.fn();
    const logInfo = vi.fn();
    const fetchImpl = vi.fn(async () =>
      Response.json([
        { chainId: SEPOLIA, usePrivateMempoolRpc: false, name: "Sepolia" },
      ]),
    );

    await warnIfPrivateRoutingMisconfigured({
      apiBaseUrl: "https://kh.example.com",
      apiKey: "kh_test",
      privatePolicyEnabled: true,
      logWarn,
      logInfo,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(logWarn).toHaveBeenCalled();
    expect(String(logWarn.mock.calls[0]?.[0])).toMatch(/usePrivateMempoolRpc=false/);
    expect(logInfo).not.toHaveBeenCalled();
  });

  it("warnIfPrivateRoutingMisconfigured is a no-op when private policy is off", async () => {
    const logWarn = vi.fn();
    const fetchImpl = vi.fn();

    const result = await warnIfPrivateRoutingMisconfigured({
      apiBaseUrl: "https://kh.example.com",
      privatePolicyEnabled: false,
      logWarn,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(logWarn).not.toHaveBeenCalled();
  });

  it("warns when API base is unset but policy is on", async () => {
    const logWarn = vi.fn();
    await warnIfPrivateRoutingMisconfigured({
      apiBaseUrl: undefined,
      privatePolicyEnabled: true,
      logWarn,
    });
    expect(logWarn).toHaveBeenCalled();
    expect(String(logWarn.mock.calls[0]?.[0])).toMatch(/KEEPERHUB_API_BASE_URL/);
  });
});
