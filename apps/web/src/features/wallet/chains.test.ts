import { describe, expect, it } from "vitest";
import {
  BASE_SEPOLIA_CHAIN_ID,
  isEvmAddress,
  knownChainConfig,
  normalizeAddress,
  resolveTargetChain,
  SEPOLIA_CHAIN_ID,
  shortenAddress,
} from "./chains.ts";

describe("wallet chains helpers", () => {
  it("resolveTargetChain defaults to Base Sepolia (x402 payment rail)", () => {
    const chain = resolveTargetChain();
    expect(chain.chainId).toBe(BASE_SEPOLIA_CHAIN_ID);
    expect(chain.chainIdHex).toBe("0x14a34");
    expect(chain.name).toBe("Base Sepolia");
    expect(chain.rpcUrls.length).toBeGreaterThan(0);
    expect(chain.blockExplorerUrls[0]).toBe("https://sepolia.basescan.org");
  });

  it("knownChainConfig returns Ethereum Sepolia for registry ops", () => {
    const sepolia = knownChainConfig(SEPOLIA_CHAIN_ID);
    expect(sepolia?.name).toBe("Ethereum Sepolia");
    expect(sepolia?.blockExplorerUrls[0]).toBe("https://sepolia.etherscan.io");
  });

  it("shortenAddress truncates checksummed addresses", () => {
    expect(shortenAddress("0x1111111111111111111111111111111111111111")).toBe("0x1111…1111");
  });

  it("isEvmAddress validates format", () => {
    expect(isEvmAddress("0x1111111111111111111111111111111111111111")).toBe(true);
    expect(isEvmAddress("0x123")).toBe(false);
    expect(isEvmAddress(null)).toBe(false);
  });

  it("normalizeAddress lowercases", () => {
    expect(normalizeAddress("0xAbCDEF0123456789AbCDEF0123456789AbCDEF01")).toBe(
      "0xabcdef0123456789abcdef0123456789abcdef01",
    );
  });
});
