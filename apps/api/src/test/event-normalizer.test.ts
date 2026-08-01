// Unit tests for on-chain event normalization

import { describe, expect, it } from "vitest";
import { createEventNormalizer } from "../monitoring/event-normalizer.ts";
import type { PriceOracle } from "../monitoring/price-oracle-service.ts";

function stubOracle(ethUsd: number | null = 3000): PriceOracle {
  return {
    async getLinkUsdPrice() {
      return 15;
    },
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
      capturedAt: "2026-07-09T00:00:00Z",
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

  it("attaches flowContext to swap events", async () => {
    const normalizer = createEventNormalizer(stubOracle());
    const amount0 = String(2_500_000n * 1_000_000n);
    const amount1 = String(-(1n * 10n ** 18n));
    const result = await normalizer.normalize({
      chainId: 1,
      eventName: "Swap",
      address: "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640",
      transactionHash: "0xswap-flow",
      logIndex: 0,
      args: {
        amount0: { value: amount0, type: "int256" },
        amount1: { value: amount1, type: "int256" },
        sender: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.flowContext).toBeDefined();
    expect(result.payload.rawPayload.flowContext).toBeDefined();
  });

  it("normalizes Transfer to Binance as cex_inflow", async () => {
    const normalizer = createEventNormalizer(stubOracle());
    const binance = "0x28C6c06298d514Db089934071355E5743bf21d60";
    const whale = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
    const value = String(800_000n * 1_000_000n); // 800k USDC

    const result = await normalizer.normalize({
      chainId: 1,
      eventName: "Transfer",
      address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      transactionHash: "0xcex-in-1",
      logIndex: 0,
      args: {
        from: whale,
        to: binance,
        value: { value, type: "uint256" },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.eventType).toBe("cex_inflow");
    expect(result.payload.magnitude?.value).toBeCloseTo(800_000, 0);
    expect(result.payload.flowContext?.toLabel).toBe("Binance");
    expect(result.payload.protocol).toBe("Binance");
  });

  it("normalizes Transfer from Binance as cex_outflow", async () => {
    const normalizer = createEventNormalizer(stubOracle());
    const binance = "0x28C6c06298d514Db089934071355E5743bf21d60";
    const value = String(600_000n * 1_000_000n);

    const result = await normalizer.normalize({
      chainId: 1,
      eventName: "Transfer",
      address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      transactionHash: "0xcex-out-1",
      args: {
        from: binance,
        to: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
        value: { value, type: "uint256" },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.eventType).toBe("cex_outflow");
    expect(result.payload.flowContext?.fromLabel).toBe("Binance");
  });

  it("rejects unknown Transfer without CEX labels", async () => {
    const normalizer = createEventNormalizer(stubOracle());
    const result = await normalizer.normalize({
      chainId: 1,
      eventName: "Transfer",
      address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      args: {
        from: "0x1111111111111111111111111111111111111111",
        to: "0x2222222222222222222222222222222222222222",
        value: { value: String(800_000n * 1_000_000n), type: "uint256" },
      },
    });
    expect(result.ok).toBe(false);
  });

  it("normalizes USDC Mint as stablecoin_mint", async () => {
    const normalizer = createEventNormalizer(stubOracle());
    const amount = String(50_000_000n * 1_000_000n); // $50M

    const result = await normalizer.normalize({
      chainId: 1,
      eventName: "Mint",
      address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      transactionHash: "0xmint1",
      args: {
        minter: "0x1111111111111111111111111111111111111111",
        to: "0x2222222222222222222222222222222222222222",
        amount: { value: amount, type: "uint256" },
      },
      protocol: "Circle",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.eventType).toBe("stablecoin_mint");
    expect(result.payload.magnitude?.value).toBeCloseTo(50_000_000, 0);
    expect(result.payload.flowContext?.direction).toBe("supply_expand");
  });

  it("normalizes USDC Burn as stablecoin_burn", async () => {
    const normalizer = createEventNormalizer(stubOracle());
    const amount = String(2_000_000n * 1_000_000n);

    const result = await normalizer.normalize({
      chainId: 1,
      eventName: "Burn",
      address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      args: {
        burner: "0x1111111111111111111111111111111111111111",
        amount: { value: amount, type: "uint256" },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.eventType).toBe("stablecoin_burn");
    expect(result.payload.flowContext?.direction).toBe("supply_contract");
  });

  it("normalizes Circle Sepolia zero-address Transfer mint fallback", async () => {
    const normalizer = createEventNormalizer(stubOracle());
    const result = await normalizer.normalize({
      chainId: 11_155_111,
      eventName: "Transfer",
      address: "0x1c7D4B196Cb0C7B01D743fBC6116a902379C7238",
      transactionHash: "0xtransfer-mint",
      logIndex: 3,
      args: {
        from: "0x0000000000000000000000000000000000000000",
        to: "0x2222222222222222222222222222222222222222",
        value: String(2_000_000n * 1_000_000n),
      },
      protocol: "Circle Sepolia USDC",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.eventType).toBe("stablecoin_mint");
    expect(result.payload.assetSymbols).toEqual(["USDC"]);
    expect(result.payload.magnitude?.value).toBeCloseTo(2_000_000, 0);
  });

  it("normalizes Circle Sepolia zero-address Transfer burn fallback", async () => {
    const normalizer = createEventNormalizer(stubOracle());
    const result = await normalizer.normalize({
      chainId: 11_155_111,
      eventName: "Transfer",
      address: "0x1c7D4B196Cb0C7B01D743fBC6116a902379C7238",
      transactionHash: "0xtransfer-burn",
      logIndex: 4,
      args: {
        from: "0x2222222222222222222222222222222222222222",
        to: "0x0000000000000000000000000000000000000000",
        value: String(2_000_000n * 1_000_000n),
      },
      protocol: "Circle Sepolia USDC",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.eventType).toBe("stablecoin_burn");
    expect(result.payload.assetSymbols).toEqual(["USDC"]);
    expect(result.payload.magnitude?.value).toBeCloseTo(2_000_000, 0);
  });

  it("normalizes Aave Supply as protocol_deposit", async () => {
    const normalizer = createEventNormalizer(stubOracle());
    const amount = String(750_000n * 1_000_000n);

    const result = await normalizer.normalize({
      chainId: 11_155_111,
      eventName: "Supply",
      address: "0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951",
      transactionHash: "0xsupply1",
      args: {
        reserve: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
        user: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
        onBehalfOf: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
        amount: { value: amount, type: "uint256" },
      },
      protocol: "Aave V3",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.eventType).toBe("protocol_deposit");
    expect(result.payload.magnitude?.value).toBeCloseTo(750_000, 0);
    expect(result.payload.flowContext?.direction).toBe("rebalance");
  });

  it("normalizes Aave Withdraw as protocol_withdraw", async () => {
    const normalizer = createEventNormalizer(stubOracle());
    const amount = String(600_000n * 1_000_000n);

    const result = await normalizer.normalize({
      chainId: 11_155_111,
      eventName: "Withdraw",
      address: "0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951",
      args: {
        reserve: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
        user: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
        to: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
        amount: { value: amount, type: "uint256" },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.eventType).toBe("protocol_withdraw");
    expect(result.payload.flowContext?.direction).toBe("de_risk");
  });
});
