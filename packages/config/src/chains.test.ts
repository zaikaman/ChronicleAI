import { describe, expect, it } from "vitest";
import {
  chainLabel,
  CHAIN_ID_BASE_SEPOLIA,
  CHAIN_ID_ETHEREUM,
  CHAIN_ID_SEPOLIA,
  PAYMENT_TESTNET_CHAIN_ID,
  PRIMARY_TESTNET_CHAIN_ID,
  registryNetworkLabelFromExplorerUrl,
  txExplorerUrl,
} from "./chains.ts";

describe("chainLabel", () => {
  it("maps well-known chains", () => {
    expect(chainLabel(CHAIN_ID_ETHEREUM)).toBe("Ethereum Mainnet");
    expect(chainLabel(CHAIN_ID_SEPOLIA)).toBe("Ethereum Sepolia");
    expect(chainLabel(CHAIN_ID_BASE_SEPOLIA)).toBe("Base Sepolia");
    expect(chainLabel(8453)).toBe("Base");
  });

  it("falls back for unknown chain ids", () => {
    expect(chainLabel(999_999)).toBe("Chain 999999");
  });
});

describe("PRIMARY_TESTNET_CHAIN_ID", () => {
  it("is Ethereum Sepolia (ops / desk / registry)", () => {
    expect(PRIMARY_TESTNET_CHAIN_ID).toBe(11_155_111);
    expect(PRIMARY_TESTNET_CHAIN_ID).toBe(CHAIN_ID_SEPOLIA);
  });
});

describe("PAYMENT_TESTNET_CHAIN_ID", () => {
  it("is Base Sepolia (x402 payment rail)", () => {
    expect(PAYMENT_TESTNET_CHAIN_ID).toBe(84_532);
    expect(PAYMENT_TESTNET_CHAIN_ID).toBe(CHAIN_ID_BASE_SEPOLIA);
  });
});

describe("txExplorerUrl", () => {
  it("builds etherscan URLs for Ethereum mainnet source events", () => {
    expect(txExplorerUrl(1, "0xabc")).toBe("https://etherscan.io/tx/0xabc");
  });

  it("builds Ethereum Sepolia URLs for registry proofs", () => {
    expect(txExplorerUrl(11_155_111, "0xreg")).toBe(
      "https://sepolia.etherscan.io/tx/0xreg",
    );
  });

  it("returns null for unknown chains", () => {
    expect(txExplorerUrl(12_345, "0xabc")).toBeNull();
  });
});

describe("registryNetworkLabelFromExplorerUrl", () => {
  it("detects Ethereum Sepolia registry explorers", () => {
    expect(
      registryNetworkLabelFromExplorerUrl(
        "https://sepolia.etherscan.io/tx/0x7d857b4d9478c5876d90b48209cb8eb5344325e22c8fd3e09cccf88669d3f12",
      ),
    ).toBe("Ethereum Sepolia");
  });

  it("detects Base Sepolia explorers (legacy)", () => {
    expect(
      registryNetworkLabelFromExplorerUrl(
        "https://sepolia.basescan.org/tx/0x7d857b4d9478c5876d90b48209cb8eb5344325e22c8fd3e09cccf88669d3f12",
      ),
    ).toBe("Base Sepolia");
  });

  it("detects Ethereum mainnet explorers", () => {
    expect(
      registryNetworkLabelFromExplorerUrl("https://etherscan.io/tx/0xabc"),
    ).toBe("Ethereum Mainnet");
  });
});
