import { describe, expect, it } from "vitest";
import type { PriceOracle } from "../monitoring/price-oracle-service.ts";
import {
  createRevenueFxService,
  createStaticRevenueFxService,
  ethPerCurrencyFromEthUsd,
} from "../services/revenue-fx-service.ts";

describe("ethPerCurrencyFromEthUsd", () => {
  it("inverts ETH/USD spot", () => {
    expect(ethPerCurrencyFromEthUsd(2000)).toBeCloseTo(0.0005, 10);
  });

  it("rejects non-positive prices", () => {
    expect(() => ethPerCurrencyFromEthUsd(0)).toThrow();
    expect(() => ethPerCurrencyFromEthUsd(-1)).toThrow();
  });
});

describe("createRevenueFxService", () => {
  it("uses Chainlink quote in oracle mode", async () => {
    const priceOracle: PriceOracle = {
      getEthUsdPrice: async () => 2500,
      getLinkUsdPrice: async () => 15,
    };
    const fx = createRevenueFxService({
      priceOracle,
      chainId: 11155111,
      mode: "oracle",
    });
    const quote = await fx.getEthPerCurrencyUnit();
    expect(quote.source).toBe("chainlink");
    expect(quote.ethUsdPrice).toBe(2500);
    expect(quote.ethPerCurrencyUnit).toBeCloseTo(1 / 2500, 12);
  });

  it("fails hard in oracle mode when feed missing", async () => {
    const priceOracle: PriceOracle = {
      getEthUsdPrice: async () => null,
      getLinkUsdPrice: async () => null,
    };
    const fx = createRevenueFxService({
      priceOracle,
      chainId: 11155111,
      mode: "oracle",
    });
    await expect(fx.getEthPerCurrencyUnit()).rejects.toThrow(/unavailable/i);
  });

  it("falls back to static in auto mode", async () => {
    const priceOracle: PriceOracle = {
      getEthUsdPrice: async () => null,
      getLinkUsdPrice: async () => null,
    };
    const fx = createRevenueFxService({
      priceOracle,
      chainId: 11155111,
      mode: "auto",
      staticEthPerCurrencyUnit: 1e-6,
    });
    const quote = await fx.getEthPerCurrencyUnit();
    expect(quote.source).toBe("static_fallback");
    expect(quote.ethPerCurrencyUnit).toBe(1e-6);
  });

  it("static helper works", async () => {
    const fx = createStaticRevenueFxService(0.001);
    const quote = await fx.getEthPerCurrencyUnit();
    expect(quote.source).toBe("static");
    expect(quote.ethPerCurrencyUnit).toBe(0.001);
  });
});
