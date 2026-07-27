// Unit tests for on-chain event normalization

import { describe, expect, it } from "vitest";
import { createEventNormalizer } from "../monitoring/event-normalizer.ts";
import type { PriceOracle } from "../monitoring/price-oracle-service.ts";

function stubOracle(ethUsd: number | null = 3000): PriceOracle {
  return {
    async getEthUsdPrice() {
      return ethUsd;
    },
  };
}

describe("event-normalizer", () => {
  it("passes through classified Chronicle events", async () => {
    const normalizer = createEventNormalizer(stubOracle());
    const result = await normalizer.normalize({
      sourceEventId: "classified-1",
      eventType: "large_swap",
      chainId: 1,
      capturedAt: "2026-07-27T00:00:00Z",
      magnitude: { value: 2_000_000, unit: "USD" },
      rawPayload: { ok: true },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.eventType).toBe("large_swap");
    expect(result.payload.magnitude?.value).toBe(2_000_000);
  });

  it("normalizes Uniswap V3 Swap using USDC amount0 as USD", async () => {
    const normalizer = createEventNormalizer(stubOracle());
    // 2.5M USDC (6 decimals)
    const amount0 = String(2_500_000n * 1_000_000n);
    const amount1 = String(-(1n * 10n ** 18n)); // ~1 WETH side

    const result = await normalizer.normalize({
      chainId: 1,
      eventName: "Swap",
      address: "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640",
      transactionHash: "0xswap1",
      logIndex: 3,
      args: {
        amount0: { value: amount0, type: "int256" },
        amount1: { value: amount1, type: "int256" },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.eventType).toBe("large_swap");
    expect(result.payload.protocol).toBe("Uniswap V3");
    expect(result.payload.magnitude?.unit).toBe("USD");
    expect(result.payload.magnitude?.value).toBeGreaterThanOrEqual(2_500_000);
    expect(result.payload.sourceEventId).toContain("0xswap1");
    expect(result.payload.assetSymbols).toContain("USDC");
  });

  it("normalizes Aave LiquidationCall debtToCover for USDC debt", async () => {
    const normalizer = createEventNormalizer(stubOracle());
    const debtToCover = String(800_000n * 1_000_000n); // 800k USDC

    const result = await normalizer.normalize({
      chainId: 1,
      eventName: "LiquidationCall",
      address: "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",
      transactionHash: "0xliq1",
      logIndex: 1,
      args: {
        debtAsset: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        collateralAsset: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
        debtToCover: { value: debtToCover, type: "uint256" },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.eventType).toBe("liquidation");
    expect(result.payload.protocol).toBe("Aave V3");
    expect(result.payload.magnitude?.value).toBeCloseTo(800_000, 0);
  });

  it("normalizes CoW Trade with USDC sell amount", async () => {
    const normalizer = createEventNormalizer(stubOracle());
    const sellAmount = String(1_500_000n * 1_000_000n);

    const result = await normalizer.normalize({
      chainId: 1,
      eventName: "Trade",
      address: "0x9008D19f58AAbD9eD0D60971565AA8510560ab41",
      transactionHash: "0xcow1",
      args: {
        sellToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        buyToken: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
        sellAmount: { value: sellAmount, type: "uint256" },
        buyAmount: { value: "1000000000000000000", type: "uint256" },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.eventType).toBe("large_swap");
    expect(result.payload.protocol).toBe("CoW Protocol");
    expect(result.payload.magnitude?.value).toBeCloseTo(1_500_000, 0);
  });

  it("normalizes PoolCreated as contract_deployment", async () => {
    const normalizer = createEventNormalizer(stubOracle());
    const result = await normalizer.normalize({
      chainId: 1,
      eventName: "PoolCreated",
      address: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
      transactionHash: "0xpool1",
      args: {
        pool: "0x1111111111111111111111111111111111111111",
        token0: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        token1: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.eventType).toBe("contract_deployment");
    expect(result.payload.assetSymbols?.[0]).toMatch(/^0x11/i);
  });

  it("rejects unknown raw events without magnitude", async () => {
    const normalizer = createEventNormalizer(stubOracle());
    const result = await normalizer.normalize({
      chainId: 1,
      eventName: "Approval",
      address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects empty body", async () => {
    const normalizer = createEventNormalizer(stubOracle());
    const result = await normalizer.normalize(null as unknown as Record<string, unknown>);
    expect(result.ok).toBe(false);
  });
});
