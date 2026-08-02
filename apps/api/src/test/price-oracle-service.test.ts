import { describe, expect, it } from "vitest";
import {
  encodeFunctionResult,
  parseAbi,
  toFunctionSelector,
} from "viem";
import {
  createPriceOracle,
  type PriceOracleEthCall,
} from "../monitoring/price-oracle-service.ts";

const AGGREGATOR_ABI = parseAbi([
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);

const ROUND_SELECTOR = toFunctionSelector(
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
);

const SEPOLIA_ETH = "0x694AA1769357215DE4FAC081bf1f309aDC325306".toLowerCase();
const MAINNET_ETH = "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419".toLowerCase();

function encodeRound(answer: bigint): string {
  return encodeFunctionResult({
    abi: AGGREGATOR_ABI,
    functionName: "latestRoundData",
    result: [1n, answer, 1n, 1n, 1n],
  });
}

describe("price-oracle-service", () => {
  it("returns null when RPC URL is missing", async () => {
    const oracle = createPriceOracle(undefined);
    expect(await oracle.getEthUsdPrice(11_155_111)).toBeNull();
    expect(await oracle.getLinkUsdPrice(11_155_111)).toBeNull();
  });

  it("reads ETH/USD via eth_call and serves from fresh cache", async () => {
    let roundCalls = 0;
    const ethCall: PriceOracleEthCall = async (_to, data) => {
      const selector = data.slice(0, 10);
      if (selector === ROUND_SELECTOR) {
        roundCalls += 1;
        return encodeRound(2500n * 10n ** 8n);
      }
      return "0x";
    };

    const oracle = createPriceOracle("https://unused.example", {
      rpcChainId: 11_155_111,
      ethCall,
      cacheTtlMs: 60_000,
    });

    expect(await oracle.getEthUsdPrice(11_155_111)).toBe(2500);
    expect(await oracle.getEthUsdPrice(11_155_111)).toBe(2500);
    expect(roundCalls).toBe(1);
  });

  it("uses RPC-native feed for mainnet chainId without calling mainnet address", async () => {
    const calledAddresses: string[] = [];
    const ethCall: PriceOracleEthCall = async (to, data) => {
      calledAddresses.push(to.toLowerCase());
      const addr = to.toLowerCase();
      const selector = data.slice(0, 10);
      if (selector === ROUND_SELECTOR) {
        // Mainnet address must never be hit on a Sepolia RPC — would return 0x.
        if (addr === MAINNET_ETH) {
          return "0x";
        }
        if (addr === SEPOLIA_ETH) {
          return encodeRound(3000n * 10n ** 8n);
        }
      }
      return "0x";
    };

    const oracle = createPriceOracle("https://unused.example", {
      rpcChainId: 11_155_111,
      ethCall,
    });

    // Mainnet event → skip foreign feed → Sepolia Chainlink only
    expect(await oracle.getEthUsdPrice(1)).toBe(3000);
    expect(calledAddresses.every((a) => a === SEPOLIA_ETH)).toBe(true);
    expect(calledAddresses.some((a) => a === MAINNET_ETH)).toBe(false);
  });

  it("uses the dedicated Mainnet RPC for Mainnet observations", async () => {
    const callsByChain: Record<number, string[]> = { 1: [], 11_155_111: [] };
    const makeCall = (chainId: number, price: bigint): PriceOracleEthCall =>
      async (to, data) => {
        callsByChain[chainId]?.push(to.toLowerCase());
        if (data.slice(0, 10) === ROUND_SELECTOR) {
          return encodeRound(price * 10n ** 8n);
        }
        return "0x";
      };

    const oracle = createPriceOracle(undefined, {
      rpcChainId: 11_155_111,
      ethCallsByChainId: {
        1: makeCall(1, 3200n),
        11_155_111: makeCall(11_155_111, 2500n),
      },
    });

    expect(await oracle.getEthUsdPrice(1)).toBe(3200);
    expect(await oracle.getEthUsdPrice(11_155_111)).toBe(2500);
    expect(callsByChain[1]).toEqual([MAINNET_ETH]);
    expect(callsByChain[11_155_111]).toEqual([SEPOLIA_ETH]);
  });

  it("returns null when RPC-native latestRoundData is empty", async () => {
    const ethCall: PriceOracleEthCall = async () => "0x";

    const oracle = createPriceOracle("https://unused.example", {
      rpcChainId: 11_155_111,
      ethCall,
    });

    expect(await oracle.getEthUsdPrice(11_155_111)).toBeNull();
  });
});
