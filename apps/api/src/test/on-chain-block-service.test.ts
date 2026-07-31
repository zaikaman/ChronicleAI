// Unit tests for multi-chain block RPC resolution

import { describe, expect, it } from "vitest";
import {
  blockRpcUrlsFromEnv,
  createOnChainBlockService,
  resolveBlockRpcUrl,
  rpcEnvHintForChain,
} from "../monitoring/on-chain-block-service.ts";

describe("resolveBlockRpcUrl", () => {
  it("selects mainnet RPC for chainId 1", () => {
    const url = resolveBlockRpcUrl(1, {
      rpcUrlsByChainId: {
        1: "https://ethereum-rpc.example",
        11_155_111: "https://sepolia-rpc.example",
      },
    });
    expect(url).toBe("https://ethereum-rpc.example");
  });

  it("selects Sepolia RPC for chainId 11155111", () => {
    const url = resolveBlockRpcUrl(11_155_111, {
      rpcUrlsByChainId: {
        1: "https://ethereum-rpc.example",
        11_155_111: "https://sepolia-rpc.example",
      },
    });
    expect(url).toBe("https://sepolia-rpc.example");
  });

  it("does not fall back to a foreign-chain default when map mode is active", () => {
    // This is the production bug: mainnet block queried against Sepolia RPC_URL.
    const url = resolveBlockRpcUrl(1, {
      rpcUrlsByChainId: {
        11_155_111: "https://sepolia-rpc.example",
      },
      rpcUrl: "https://sepolia-rpc.example",
    });
    expect(url).toBeUndefined();
  });

  it("uses legacy single rpcUrl when no per-chain map entries exist", () => {
    const url = resolveBlockRpcUrl(1, {
      rpcUrl: "https://legacy-rpc.example",
    });
    expect(url).toBe("https://legacy-rpc.example");
  });

  it("treats whitespace-only map values as unset", () => {
    const url = resolveBlockRpcUrl(1, {
      rpcUrlsByChainId: {
        1: "   ",
        11_155_111: "https://sepolia-rpc.example",
      },
    });
    expect(url).toBeUndefined();
  });
});

describe("blockRpcUrlsFromEnv", () => {
  it("maps env fields onto known chain IDs", () => {
    const map = blockRpcUrlsFromEnv({
      mainnetRpcUrl: "https://mainnet.example",
      rpcUrl: "https://sepolia.example",
      x402RpcUrl: "https://base-sepolia.example",
      baseRpcUrl: "https://base.example",
    });
    expect(map[1]).toBe("https://mainnet.example");
    expect(map[11_155_111]).toBe("https://sepolia.example");
    expect(map[84_532]).toBe("https://base-sepolia.example");
    expect(map[8_453]).toBe("https://base.example");
  });
});

describe("rpcEnvHintForChain", () => {
  it("returns operator-facing env names", () => {
    expect(rpcEnvHintForChain(1)).toBe("MAINNET_RPC_URL");
    expect(rpcEnvHintForChain(11_155_111)).toBe("RPC_URL");
    expect(rpcEnvHintForChain(84_532)).toMatch(/X402_RPC_URL/);
    expect(rpcEnvHintForChain(8_453)).toBe("BASE_RPC_URL");
  });
});

describe("createOnChainBlockService", () => {
  it("fails closed when no RPC is configured at all", async () => {
    const service = createOnChainBlockService(undefined);
    await expect(
      service.analyzeBlock({ chainId: 1, blockNumber: 25_650_600 }),
    ).rejects.toThrow(/RPC_URL is not configured/);
  });

  it("errors with MAINNET_RPC_URL hint when chain 1 has no RPC", async () => {
    const service = createOnChainBlockService({
      rpcUrlsByChainId: {
        11_155_111: "https://sepolia-rpc.example",
      },
    });
    await expect(
      service.analyzeBlock({ chainId: 1, blockNumber: 25_650_600 }),
    ).rejects.toThrow(/MAINNET_RPC_URL/);
  });

  it("accepts legacy string constructor for single-URL mode", async () => {
    // String mode still constructs; live fetch will fail against a fake host.
    // We only assert it does not throw the "not configured" closed path.
    const service = createOnChainBlockService("https://127.0.0.1:9");
    await expect(
      service.analyzeBlock({ chainId: 1, blockNumber: 1 }),
    ).rejects.not.toThrow(/RPC_URL is not configured/);
  });

  it("wraps live block-not-found with chain + MAINNET_RPC_URL context", async () => {
    const service = createOnChainBlockService({
      rpcUrlsByChainId: { 1: "https://ethereum-rpc.publicnode.com" },
    });
    // Far-future block will not exist — error must name chain 1, not bare viem text alone.
    await expect(
      service.analyzeBlock({ chainId: 1, blockNumber: 9_999_999_999 }),
    ).rejects.toThrow(/chain 1 \(Ethereum Mainnet\).*MAINNET_RPC_URL/i);
  }, 30_000);
});
