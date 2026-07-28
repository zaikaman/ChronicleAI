// Unit tests for flow enrichment + entity labels

import { describe, expect, it } from "vitest";
import { isExchangeAddress, lookupEntity } from "@chronicleai/config";
import {
  attachFlowContextToRawPayload,
  directionPlainLanguage,
  enrichFlowContext,
  extractFlowContext,
} from "../monitoring/flow-enrichment.ts";

describe("entity-labels", () => {
  it("looks up Binance hot wallet on mainnet", () => {
    const entity = lookupEntity(
      "0x28C6c06298d514Db089934071355E5743bf21d60",
      1,
    );
    expect(entity).not.toBeNull();
    expect(entity?.role).toBe("exchange");
    expect(entity?.label).toBe("Binance");
  });

  it("returns null for unknown address", () => {
    expect(lookupEntity("0x1111111111111111111111111111111111111111", 1)).toBeNull();
  });

  it("detects exchange addresses case-insensitively", () => {
    expect(
      isExchangeAddress("0x28C6C06298D514DB089934071355E5743BF21D60", 1),
    ).toBe(true);
  });

  it("labels Aave V3 Sepolia pool as protocol", () => {
    const entity = lookupEntity(
      "0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951",
      11_155_111,
    );
    expect(entity?.role).toBe("protocol");
    expect(entity?.label).toBe("Aave V3");
  });
});

describe("enrichFlowContext", () => {
  it("marks stable→volatile swap as risk_on", () => {
    const ctx = enrichFlowContext({
      eventType: "large_swap",
      chainId: 1,
      sellSymbol: "USDC",
      buySymbol: "WETH",
      protocol: "Uniswap V3",
    });
    expect(ctx.direction).toBe("risk_on");
  });

  it("marks volatile→stable swap as de_risk", () => {
    const ctx = enrichFlowContext({
      eventType: "large_swap",
      chainId: 1,
      sellSymbol: "WETH",
      buySymbol: "USDC",
    });
    expect(ctx.direction).toBe("de_risk");
  });

  it("marks stable↔stable as rebalance", () => {
    const ctx = enrichFlowContext({
      eventType: "large_swap",
      chainId: 1,
      sellSymbol: "USDC",
      buySymbol: "USDT",
    });
    expect(ctx.direction).toBe("rebalance");
  });

  it("labels CEX inflow to Binance", () => {
    const binance = "0x28C6c06298d514Db089934071355E5743bf21d60";
    const whale = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
    const ctx = enrichFlowContext({
      eventType: "cex_inflow",
      chainId: 1,
      fromAddress: whale,
      toAddress: binance,
      assetSymbols: ["WETH"],
    });
    expect(ctx.toRole).toBe("exchange");
    expect(ctx.toLabel).toBe("Binance");
    expect(ctx.direction).toBe("de_risk");
  });

  it("labels CEX outflow from Binance as risk_on for volatile", () => {
    const binance = "0x28C6c06298d514Db089934071355E5743bf21d60";
    const ctx = enrichFlowContext({
      eventType: "cex_outflow",
      chainId: 1,
      fromAddress: binance,
      toAddress: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
      assetSymbols: ["WETH"],
    });
    expect(ctx.fromLabel).toBe("Binance");
    expect(ctx.direction).toBe("risk_on");
  });

  it("sets supply_expand for stablecoin mint", () => {
    const ctx = enrichFlowContext({
      eventType: "stablecoin_mint",
      chainId: 1,
      assetSymbols: ["USDC"],
    });
    expect(ctx.direction).toBe("supply_expand");
  });

  it("sets supply_contract for stablecoin burn", () => {
    const ctx = enrichFlowContext({
      eventType: "stablecoin_burn",
      chainId: 1,
      assetSymbols: ["USDC"],
    });
    expect(ctx.direction).toBe("supply_contract");
  });

  it("never invents labels for unknown addresses", () => {
    const ctx = enrichFlowContext({
      eventType: "cex_inflow",
      chainId: 1,
      fromAddress: "0x1111111111111111111111111111111111111111",
      toAddress: "0x2222222222222222222222222222222222222222",
      assetSymbols: ["USDC"],
    });
    expect(ctx.fromLabel).toBeUndefined();
    expect(ctx.toLabel).toBeUndefined();
    expect(ctx.fromRole).toBe("unknown");
    expect(ctx.toRole).toBe("unknown");
  });

  it("builds clusterKey from subject + pair", () => {
    const ctx = enrichFlowContext({
      eventType: "large_swap",
      chainId: 1,
      sellSymbol: "USDC",
      buySymbol: "WETH",
      subjectAddress: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
    });
    expect(ctx.clusterKey).toContain("large_swap");
    expect(ctx.clusterKey).toContain("USDC/WETH");
  });
});

describe("flowContext payload helpers", () => {
  it("attaches and extracts flowContext from raw payload", () => {
    const ctx = enrichFlowContext({
      eventType: "stablecoin_mint",
      chainId: 1,
    });
    const raw = attachFlowContextToRawPayload({ other: true }, ctx);
    expect(raw.other).toBe(true);
    expect(extractFlowContext(raw)?.direction).toBe("supply_expand");
  });

  it("directionPlainLanguage covers known directions", () => {
    expect(directionPlainLanguage("de_risk")).toContain("de-risk");
    expect(directionPlainLanguage("supply_expand")).toContain("supply");
  });
});
