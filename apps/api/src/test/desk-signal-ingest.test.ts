import { describe, expect, it } from "vitest";
import {
  createDeskSignalIngestService,
  normalizeDeskSignalFeatures,
} from "../desk/signal-ingest-service.ts";
import {
  ammQuoteToEthUsd,
  computeEthUsdBasisBps,
  geometricMeanPrice,
  resolveAmmEthUsdPrice,
  DESK_BASIS_ABSURD_BPS,
} from "../desk/oracle-amm-pricing.ts";
import { createPolicyEngine } from "../desk/policy-engine.ts";
import { createSignalEngine } from "../desk/signal-engine.ts";
import { createSignalFusionJudge } from "../desk/agent/signal-fusion.ts";
import type { DeskPolicyConfig } from "../desk/types.ts";
import type { DeskSignalRepository, DeskSignalRow } from "@chronicleai/db";
import { DESK_CHAIN_ID } from "@chronicleai/schemas";

const config: DeskPolicyConfig = {
  targetAumUsdc: 50,
  maxAumUsdc: 80,
  minAumUsdc: 20,
  topupChunkUsdc: 10,
  minFreeUsdc: 10,
  inventoryTopupUsdc: 10,
  preferUnwindForFreeUsdc: true,
  profitSweepUsdc: 15,
  topupCooldownMs: 3_600_000,
  postMaintenanceSweepCooldownMs: 1_200_000,
  hfWarn: 1.5,
  hfCritical: 1.2,
  basisBps: 50,
  apyDeltaBps: 50,
  maxTradeUsdc: 15,
  killHeartbeatMs: 6 * 60 * 60_000,
  failedRunCooldownMs: 15 * 60_000,
  oracleMaxStalenessMs: 60 * 60_000,
  apyConsecutivePolls: 2,
  apyAbsurdBps: 5000,
  rebalanceIntervalMs: 21600000,
  maintenanceNotionalUsdc: 10,
  eventMicrotradeEnabled: false,
  eventMicrotradeUsdc: 5,
  eventMicrotradeCooldownMs: 3_600_000,
  eventMicrotradeLookbackMs: 3_600_000,
  gasElevatedGwei: 50,
  paused: false,
};

function memorySignals(): DeskSignalRepository {
  const rows = new Map<string, DeskSignalRow>();
  return {
    async create(data) {
      const row: DeskSignalRow = {
        id: `sig-${rows.size + 1}`,
        signal_type: data.signal_type,
        chain_id: data.chain_id ?? DESK_CHAIN_ID,
        severity: data.severity ?? 0,
        features: data.features ?? {},
        sources: data.sources ?? {},
        policy_verdict: data.policy_verdict ?? "ignore",
        dedupe_key: data.dedupe_key,
        created_at: data.created_at ?? new Date().toISOString(),
      };
      rows.set(row.dedupe_key, row);
      return { ok: true, value: row };
    },
    async findById(id) {
      for (const r of rows.values()) {
        if (r.id === id) return { ok: true, value: r };
      }
      return { ok: true, value: null };
    },
    async findByDedupeKey(key) {
      return { ok: true, value: rows.get(key) ?? null };
    },
    async listRecent() {
      return { ok: true, value: [...rows.values()] };
    },
    async listByType(signalType) {
      return {
        ok: true,
        value: [...rows.values()].filter((r) => r.signal_type === signalType),
      };
    },
  };
}

function makeIngest(signals = memorySignals()) {
  const policy = createPolicyEngine(config);
  const engine = createSignalEngine({ policy, config, signals });
  return createDeskSignalIngestService({
    signalEngine: engine,
    signals,
    config,
    rpcUrl: null,
  });
}

describe("normalizeDeskSignalFeatures", () => {
  it("decodes Aave health factor ray and base units", () => {
    // HF 1.25 ray = 1.25e18
    const hfRay = (125n * 10n ** 16n).toString();
    const coll = (100n * 10n ** 8n).toString(); // $100
    const debt = (50n * 10n ** 8n).toString();
    const f = normalizeDeskSignalFeatures("health_factor", {
      healthFactorRay: hfRay,
      totalCollateralBase: coll,
      totalDebtBase: debt,
    });
    expect(f.hf).toBeCloseTo(1.25, 5);
    expect(f.totalCollateralUsd).toBeCloseTo(100, 5);
    expect(f.totalDebtUsd).toBeCloseTo(50, 5);
  });

  it("converts liquidity rate ray to APY bps and delta vs idle", () => {
    // 5% APR ray ≈ 0.05 * 1e27
    const ray = ((5n * 10n ** 25n) / 1n).toString();
    const f = normalizeDeskSignalFeatures("apy_delta", {
      liquidityRateRay: ray,
      idleUsdcApyBps: 0,
    });
    expect(f.aaveSupplyApyBps).toBe(500);
    expect(f.apyDeltaBps).toBe(500);
  });

  it("computes oracle vs AMM basis bps", () => {
    // oracle $3000 (8 dec), AMM 1 WETH → 3015 USDC (6 dec)
    const f = normalizeDeskSignalFeatures("oracle_basis", {
      oracleAnswer: "300000000000",
      oracleDecimals: 8,
      oracleUpdatedAt: Math.floor(Date.now() / 1000),
      ammAmountOut: "3015000000",
      ammAmountIn: "1000000000000000000",
      ammTokenInDecimals: 18,
      ammTokenOutDecimals: 6,
    });
    expect(f.oraclePrice).toBeCloseTo(3000, 4);
    expect(f.ammPrice).toBeCloseTo(3015, 4);
    expect(f.basisBps).toBe(50);
  });

  it("recovers human-scale oracleAnswer that would otherwise be /1e8", () => {
    // Miswired poll sometimes passes already-human ETH/USD as oracleAnswer.
    const f = normalizeDeskSignalFeatures("oracle_basis", {
      oracleAnswer: "2500",
      oracleDecimals: 8,
      oracleUpdatedAt: Math.floor(Date.now() / 1000),
      ammAmountOut: "2510000000",
      ammAmountIn: "1000000000000000000",
      ammTokenInDecimals: 18,
      ammTokenOutDecimals: 6,
    });
    expect(f.oraclePrice).toBeCloseTo(2500, 4);
    expect(f.ammPrice).toBeCloseTo(2510, 4);
    expect(f.basisBps).toBe(40);
  });

  it("inverts USDC→WETH quotes to ETH/USD mid", () => {
    // 1000 USDC buys 0.5 WETH → ETH/USD = 2000
    const f = normalizeDeskSignalFeatures("oracle_basis", {
      oracleAnswer: "200000000000",
      oracleDecimals: 8,
      oracleUpdatedAt: Math.floor(Date.now() / 1000),
      ammAmountIn: "1000000000", // 1000 USDC
      ammAmountOut: "500000000000000000", // 0.5 WETH
      ammTokenInDecimals: 6,
      ammTokenOutDecimals: 18,
      ammTokenIn: "USDC",
      ammTokenOut: "WETH",
      ammQuoteDirection: "stable_to_weth",
    });
    expect(f.ammPrice).toBeCloseTo(2000, 4);
    expect(f.oraclePrice).toBeCloseTo(2000, 4);
    expect(f.basisBps).toBe(0);
  });

  it("uses geometric mid of forward + reverse quotes", () => {
    // Forward: 1 WETH → 3020 USDC; reverse: 1000 USDC → 0.3311258278 WETH ≈ 3020 USD
    const f = normalizeDeskSignalFeatures("oracle_basis", {
      oracleAnswer: "300000000000",
      oracleDecimals: 8,
      oracleUpdatedAt: Math.floor(Date.now() / 1000),
      ammAmountIn: "1000000000000000000",
      ammAmountOut: "3020000000",
      ammTokenInDecimals: 18,
      ammTokenOutDecimals: 6,
      ammTokenIn: "WETH",
      ammTokenOut: "USDC",
      ammQuoteDirection: "weth_to_stable",
      ammReverseAmountIn: "1000000000",
      ammReverseAmountOut: "331125827814569536", // 1000/3020 WETH
      ammReverseTokenInDecimals: 6,
      ammReverseTokenOutDecimals: 18,
      ammReverseTokenIn: "USDC",
      ammReverseTokenOut: "WETH",
    });
    expect(f.ammQuoteMethod).toBe("geometric_mid");
    expect(f.ammPrice).toBeCloseTo(3020, 0);
    expect(f.basisBps).toBeCloseTo(67, -1); // ~66–67 bps
  });

  /**
   * Fixture from live Sepolia desk_basis poll shape (2026-07 audit):
   * Chainlink ~1877.7, QuoterV2 fee=3000 WETH→USDC amountOut ≈ 1.6229e10.
   * Scaling is honest; pool mark is thin-testnet misprice (~8.6x oracle).
   */
  it("scales real Sepolia poll amounts honestly (absurd basis, not inverted decimals)", () => {
    const f = normalizeDeskSignalFeatures("oracle_basis", {
      oracleAnswer: "187770000000",
      oracleDecimals: 8,
      oracleUpdatedAt: 1_784_115_168,
      ammAmountOut: "16229706626",
      ammAmountIn: "1000000000000000000",
      ammTokenInDecimals: 18,
      ammTokenOutDecimals: 6,
      ammTokenIn: "WETH",
      ammTokenOut: "USDC",
      ammQuoteDirection: "weth_to_stable",
      ammFee: 3000,
      pair: "ETH/USD",
    });
    expect(f.oraclePrice).toBeCloseTo(1877.7, 1);
    expect(f.ammPrice).toBeCloseTo(16229.706626, 4);
    expect(Math.abs(f.basisBps ?? 0)).toBeGreaterThan(DESK_BASIS_ABSURD_BPS);
    // Hand-computed mid from amounts within ±1 bps of stored basis.
    const handMid = 16229706626 / 1e6 / 1; // USDC human / 1 WETH
    const handBasis = Math.round(((handMid - 1877.7) / 1877.7) * 10_000);
    expect(f.basisBps).toBe(handBasis);
  });
});

describe("oracle-amm-pricing helpers", () => {
  it("computes basis within ±500 bps of hand mid for realistic amounts", () => {
    const oracle = 2500;
    // 1 WETH → 2512.5 USDC (+50 bps)
    const amountOut = 2_512_500_000n; // 6 dec
    const amountIn = 10n ** 18n;
    const mid = ammQuoteToEthUsd({
      amountIn,
      amountOut,
      tokenInDecimals: 18,
      tokenOutDecimals: 6,
      direction: "weth_to_stable",
      tokenIn: "WETH",
      tokenOut: "USDC",
    });
    expect(mid).toBeCloseTo(2512.5, 4);
    const basis = computeEthUsdBasisBps(oracle, mid!);
    const handBasis = Math.round(((2512.5 - 2500) / 2500) * 10_000);
    expect(Math.abs(basis - handBasis)).toBeLessThanOrEqual(1);
    expect(Math.abs(basis)).toBeLessThanOrEqual(500);
  });

  it("geometric mean of slightly skewed bid/ask", () => {
    const mid = geometricMeanPrice(3010, 2990);
    expect(mid).toBeCloseTo(Math.sqrt(3010 * 2990), 6);
  });

  it("prefers amount-derived mid over mis-scaled provided ammPrice", () => {
    const r = resolveAmmEthUsdPrice({
      ammPrice: 0.00003, // mis-scaled leftover
      amountIn: 10n ** 18n,
      amountOut: 3_000_000_000n,
      tokenInDecimals: 18,
      tokenOutDecimals: 6,
      tokenIn: "WETH",
      tokenOut: "USDC",
      quoteDirection: "weth_to_stable",
    });
    expect(r.ammPrice).toBeCloseTo(3000, 4);
    expect(r.quoteMethod).toBe("forward_quote");
    expect(r.outOfBand).toBe(false);
  });
});

describe("desk signal ingest quality bar", () => {
  it("rejects non-Sepolia chainId", async () => {
    const ingest = makeIngest();
    const result = await ingest.ingest({
      signalType: "health_factor",
      chainId: 1,
      features: { hf: 1.1 },
      sources: { pollKind: "desk-health-poll" },
    });
    expect(result.accepted).toBe(false);
    expect(result.statusCode).toBe(400);
    expect(result.message).toMatch(/11155111/);
  });

  it("rejects missing source proofs", async () => {
    const ingest = makeIngest();
    const result = await ingest.ingest({
      signalType: "health_factor",
      chainId: DESK_CHAIN_ID,
      features: { hf: 1.1 },
      sources: {},
    });
    expect(result.accepted).toBe(false);
    expect(result.statusCode).toBe(400);
    expect(result.message).toMatch(/proofs/i);
  });

  it("accepts health_factor with policy_verdict defend when HF critical", async () => {
    const ingest = makeIngest();
    const result = await ingest.ingest({
      signalType: "health_factor",
      chainId: DESK_CHAIN_ID,
      pollKind: "desk-health-poll",
      features: {
        healthFactorRay: (11n * 10n ** 17n).toString(), // 1.1
        totalCollateralBase: (100n * 10n ** 8n).toString(),
        totalDebtBase: (80n * 10n ** 8n).toString(),
      },
      sources: {
        pollKind: "desk-health-poll",
        contracts: ["0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951"],
        readResults: { healthFactor: "1100000000000000000" },
      },
    });
    expect(result.accepted).toBe(true);
    expect(result.statusCode).toBe(202);
    expect(result.signal?.policyVerdict).toBe("defend");
    expect(result.signal?.features.hf).toBeCloseTo(1.1, 5);
    expect(result.signal?.chainId).toBe(DESK_CHAIN_ID);
  });

  it("dedupes on second ingest with same key", async () => {
    const signals = memorySignals();
    const ingest = makeIngest(signals);
    const payload = {
      signalType: "capital_tick" as const,
      chainId: DESK_CHAIN_ID,
      features: { tick: true },
      sources: { pollKind: "desk-capital-tick", readResults: { scheduled: true } },
      dedupeKey: "desk:test:capital:1",
    };
    const first = await ingest.ingest(payload);
    const second = await ingest.ingest(payload);
    expect(first.deduped).toBe(false);
    expect(second.deduped).toBe(true);
    expect(second.statusCode).toBe(200);
  });

  it("accepts oracle_basis trade when basis ≥ threshold", async () => {
    const ingest = makeIngest();
    const result = await ingest.ingest({
      signalType: "oracle_basis",
      chainId: DESK_CHAIN_ID,
      features: {
        oracleAnswer: "300000000000",
        oracleDecimals: 8,
        oracleUpdatedAt: Math.floor(Date.now() / 1000),
        ammAmountOut: "3030000000", // $3030 → +100 bps
        ammAmountIn: "1000000000000000000",
        ammTokenInDecimals: 18,
        ammTokenOutDecimals: 6,
      },
      sources: {
        pollKind: "desk-basis-poll",
        contracts: [
          "0x694AA1769357215DE4FAC081bf1f309aDC325306",
          "0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3",
        ],
        readResults: { oracleAnswer: "300000000000", ammAmountOut: "3030000000" },
      },
    });
    expect(result.accepted).toBe(true);
    expect(result.signal?.policyVerdict).toBe("trade");
    expect(result.signal?.features.basisBps).toBe(100);
  });

  it("ignores oracle_basis when recovered prices still yield absurd basis", async () => {
    const ingest = makeIngest();
    const result = await ingest.ingest({
      signalType: "oracle_basis",
      chainId: DESK_CHAIN_ID,
      features: {
        // Plausible oracle, absurd AMM (miswired amountOut without decimals).
        oracleAnswer: "300000000000",
        oracleDecimals: 8,
        oracleUpdatedAt: Math.floor(Date.now() / 1000),
        ammAmountOut: "3030000000000000",
        ammAmountIn: "1000000000000000000",
        ammTokenInDecimals: 18,
        ammTokenOutDecimals: 6,
      },
      sources: {
        pollKind: "desk-basis-poll",
        contracts: ["0x694AA1769357215DE4FAC081bf1f309aDC325306"],
        readResults: { oracleAnswer: "300000000000", ammAmountOut: "3030000000000000" },
      },
    });
    expect(result.accepted).toBe(true);
    expect(result.signal?.policyVerdict).toBe("ignore");
    expect(result.signal?.features.basisBps).toBeGreaterThan(DESK_BASIS_ABSURD_BPS);
  });

  it("ignores live-shaped Sepolia thin-pool basis as data_quality (not trade)", async () => {
    const ingest = makeIngest();
    const result = await ingest.ingest({
      signalType: "oracle_basis",
      chainId: DESK_CHAIN_ID,
      features: {
        oracleAnswer: "187770000000",
        oracleDecimals: 8,
        oracleUpdatedAt: Math.floor(Date.now() / 1000),
        ammAmountOut: "16229706626",
        ammAmountIn: "1000000000000000000",
        ammTokenInDecimals: 18,
        ammTokenOutDecimals: 6,
        ammTokenIn: "WETH",
        ammTokenOut: "USDC",
        ammQuoteDirection: "weth_to_stable",
        ammFee: 3000,
        pair: "ETH/USD",
      },
      sources: {
        pollKind: "desk-basis-poll",
        contracts: [
          "0x694AA1769357215DE4FAC081bf1f309aDC325306",
          "0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3",
        ],
        readResults: {
          oracleAnswer: "187770000000",
          ammAmountOut: "16229706626",
          quoteMethod: "quoteExactInputSingle_bidirectional_geometric_mid",
        },
      },
    });
    expect(result.accepted).toBe(true);
    expect(result.signal?.policyVerdict).toBe("ignore");
    expect(result.signal?.features.basisBps).toBeGreaterThan(DESK_BASIS_ABSURD_BPS);
    expect(result.signal?.features.ammPrice).toBeCloseTo(16229.7, 0);

    const fusion = createSignalFusionJudge(null).judgeHeuristic({
      signalType: "oracle_basis",
      features: result.signal!.features,
      severity: result.signal!.severity,
      policyVerdict: result.signal!.policyVerdict,
      basisBpsThreshold: 50,
    });
    expect(fusion.label).toBe("data_quality");
  });

  it("labels flat honest markets as basis_below_threshold (not data_quality)", async () => {
    const ingest = makeIngest();
    const result = await ingest.ingest({
      signalType: "oracle_basis",
      chainId: DESK_CHAIN_ID,
      features: {
        oracleAnswer: "200000000000",
        oracleDecimals: 8,
        oracleUpdatedAt: Math.floor(Date.now() / 1000),
        // 1 WETH → 2001 USDC → +5 bps < DESK_BASIS_BPS=50
        ammAmountOut: "2001000000",
        ammAmountIn: "1000000000000000000",
        ammTokenInDecimals: 18,
        ammTokenOutDecimals: 6,
        ammTokenIn: "WETH",
        ammTokenOut: "USDC",
      },
      sources: {
        pollKind: "desk-basis-poll",
        contracts: ["0x694AA1769357215DE4FAC081bf1f309aDC325306"],
        readResults: { oracleAnswer: "200000000000", ammAmountOut: "2001000000" },
      },
    });
    expect(result.accepted).toBe(true);
    expect(result.signal?.policyVerdict).toBe("ignore");
    expect(Math.abs(result.signal?.features.basisBps ?? 0)).toBeLessThan(50);
    // Engine reason path for flat markets (honest skip).
    const engine = createSignalEngine({
      policy: createPolicyEngine(config),
      config,
      signals: memorySignals(),
    });
    const classified = engine.classify("oracle_basis", result.signal!.features);
    expect(classified.reasonCodes).toContain("basis_below_threshold");
    expect(classified.reasonCodes).not.toContain("basis_data_quality");
  });

  it("accepts gas_regime with explicit gwei", async () => {
    const ingest = makeIngest();
    const result = await ingest.ingest({
      signalType: "gas_regime",
      chainId: DESK_CHAIN_ID,
      features: { gasGwei: 120 },
      sources: {
        pollKind: "desk-gas-poll",
        readResults: { blockNumber: "123" },
      },
    });
    expect(result.accepted).toBe(true);
    expect(result.signal?.policyVerdict).toBe("defer");
    expect(result.signal?.features.gasRegime).toBe("critical");
  });
});

describe("formatChronicleIngest desk_read kind", () => {
  it("is re-exported path coverage via signal engine classify ignore on wrong chain", async () => {
    const policy = createPolicyEngine(config);
    const signals = memorySignals();
    const engine = createSignalEngine({ policy, config, signals });
    const signal = engine.buildSignal({
      signalType: "health_factor",
      chainId: 1,
      features: { hf: 1.0 },
      dedupeKey: "x",
    });
    expect(signal.policyVerdict).toBe("ignore");
    expect(signal.severity).toBe(0);
  });
});
