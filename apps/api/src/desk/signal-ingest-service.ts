/**
 * Desk signal ingest (Phase 9 quality bar).
 *
 * Every executable signal must include:
 * - chainId === 11155111 (Sepolia)
 * - numeric features used by policy (after normalization)
 * - dedupe_key (caller-provided or engine-built)
 * - source proofs (read outputs / event refs / pollKind)
 *
 * Qualification is policy_verdict from the signal engine — not magnitude alone.
 */

import { DESK_CHAIN_ID, DESK_SIGNAL_TYPES, type DeskSignalType } from "@chronicleai/schemas";
import type { DeskSignalRepository, DeskSignalRow } from "@chronicleai/db";
import { createPublicClient, formatUnits, http } from "viem";
import { chainFromId } from "../lib/viem-chain.ts";
import type { SignalEngine } from "./signal-engine.ts";
import type {
  DeskPolicyConfig,
  DeskSignalFeatures,
  DeskSignalRecord,
  DeskSignalSources,
  GasRegime,
} from "./types.ts";
import {
  coerceEthUsdOraclePrice,
  decodeEthUsdOraclePrice,
  DEFAULT_AMM_TOKEN_IN_DECIMALS,
  DEFAULT_AMM_TOKEN_OUT_DECIMALS,
  DESK_BASIS_ABSURD_BPS,
  resolveAmmEthUsdPrice,
} from "./oracle-amm-pricing.ts";

const SIGNAL_TYPE_SET = new Set<string>(DESK_SIGNAL_TYPES);

/** Aave base currency = USD with 8 decimals. */
const AAVE_BASE_DECIMALS = 8;
/** Health factor ray (1e18). */
const HF_RAY = 10n ** 18n;
const HF_MAX_NO_DEBT = 2n ** 128n;
/** Aave liquidity rate ray (1e27) ≈ 100% APR. */
const RAY_27 = 10n ** 27n;

/** Re-export for callers / tests that imported from this module. */
export { DESK_BASIS_ABSURD_BPS, ETH_USD_PRICE_MIN, ETH_USD_PRICE_MAX } from "./oracle-amm-pricing.ts";

export type DeskReadPayload = Record<string, unknown>;

export interface DeskSignalIngestResult {
  accepted: boolean;
  statusCode: number;
  message: string;
  signal?: DeskSignalRecord;
  row?: DeskSignalRow;
  deduped?: boolean;
  /** Why the quality bar rejected the payload (400). */
  qualityErrors?: string[];
}

export interface DeskSignalIngestService {
  /**
   * Validate quality bar, normalize features, classify via signal engine, persist.
   */
  ingest(payload: DeskReadPayload): Promise<DeskSignalIngestResult>;
}

export interface DeskSignalIngestDeps {
  signalEngine: SignalEngine;
  signals: DeskSignalRepository;
  config: DeskPolicyConfig;
  /** Optional RPC for gas_regime enrichment when gasGwei missing. */
  rpcUrl?: string | null | undefined;
  /**
   * Optional Desk-trigger Alert service. When set, non-ignore desk-native
   * signals create/reuse a public desk_trigger Alert and link source_alert_id.
   * Failures are best-effort and never reject the Signal.
   */
  deskTriggerAlerts?: import("../services/desk-trigger-alert-service.ts").DeskTriggerAlertService | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "bigint") return value.toString();
  return undefined;
}

function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  if (typeof value === "string" && value.trim()) {
    const n = Number(value.trim());
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function parseBigIntish(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    try {
      return BigInt(Math.trunc(value));
    } catch {
      return null;
    }
  }
  if (typeof value === "string" && value.trim()) {
    try {
      return BigInt(value.trim());
    } catch {
      return null;
    }
  }
  return null;
}

function healthFactorFromRay(ray: bigint): number | null {
  if (ray === 0n) return 0;
  if (ray > HF_MAX_NO_DEBT) return null;
  const asNumber = Number(ray) / Number(HF_RAY);
  return Number.isFinite(asNumber) ? asNumber : null;
}

function aaveBaseToUsd(base: bigint): number {
  return Number(formatUnits(base, AAVE_BASE_DECIMALS));
}

/** Convert Aave liquidityRate ray (1e27) to approximate APR bps. */
function liquidityRateRayToApyBps(ray: bigint): number {
  if (ray <= 0n) return 0;
  // ray / 1e27 * 10_000 ≈ bps APR (linear approximation used by desk policy).
  const bps = Number(ray * 10_000n / RAY_27);
  return Number.isFinite(bps) ? Math.max(0, Math.round(bps)) : 0;
}

function hasSourceProofs(sources: DeskSignalSources): boolean {
  const contracts = sources.contracts;
  const hasContracts = Array.isArray(contracts) && contracts.length > 0;
  const readResults = sources.readResults;
  const hasReads =
    readResults != null &&
    typeof readResults === "object" &&
    Object.keys(readResults as object).length > 0;
  const hasTx =
    Array.isArray(sources.txRefs) && (sources.txRefs as unknown[]).length > 0;
  const hasWorkflow =
    typeof sources.workflowRunId === "string" && sources.workflowRunId.length > 0;
  const hasPoll =
    typeof sources.pollKind === "string" && sources.pollKind.length > 0;
  return hasContracts || hasReads || hasTx || hasWorkflow || hasPoll;
}

function hasPolicyNumericFeatures(
  signalType: DeskSignalType,
  features: DeskSignalFeatures,
): boolean {
  switch (signalType) {
    case "health_factor":
      return features.hf != null && Number.isFinite(features.hf);
    case "apy_delta":
      return (
        features.apyDeltaBps != null &&
        Number.isFinite(features.apyDeltaBps) &&
        features.aaveSupplyApyBps != null &&
        Number.isFinite(features.aaveSupplyApyBps)
      );
    case "oracle_basis":
      return (
        features.basisBps != null &&
        Number.isFinite(features.basisBps) &&
        features.oraclePrice != null &&
        Number.isFinite(features.oraclePrice) &&
        features.ammPrice != null &&
        Number.isFinite(features.ammPrice)
      );
    case "gas_regime":
      return (
        (features.gasGwei != null && Number.isFinite(features.gasGwei)) ||
        features.gasRegime === "normal" ||
        features.gasRegime === "elevated" ||
        features.gasRegime === "critical"
      );
    case "liquidation_cluster":
      return true;
    case "capital_tick":
      return true;
    case "manual":
      return true;
    default:
      return false;
  }
}

/**
 * Normalize raw poll / read payload into policy features.
 * Accepts both already-normalized numbers and on-chain raw units from KH reads.
 */
export function normalizeDeskSignalFeatures(
  signalType: DeskSignalType,
  raw: Record<string, unknown>,
  options?: { consecutiveEdgePolls?: number },
): DeskSignalFeatures {
  const features: DeskSignalFeatures = { ...raw } as DeskSignalFeatures;

  // ── health_factor ──────────────────────────────────────
  if (signalType === "health_factor") {
    const hfDirect = asFiniteNumber(raw.hf ?? raw.healthFactor);
    const hfRay = parseBigIntish(
      raw.healthFactorRay ?? raw.healthFactor ?? raw.hf,
    );

    if (hfDirect != null && hfDirect > 0 && hfDirect < 1_000) {
      features.hf = hfDirect;
    } else if (hfRay != null) {
      // Prefer ray decode when value looks like ray (>> human HF)
      if (hfRay > 1000n || raw.healthFactorRay != null) {
        const decoded = healthFactorFromRay(hfRay);
        // null = no debt / max → treat as healthy high HF for classify
        features.hf = decoded ?? 999;
      } else if (hfDirect != null) {
        features.hf = hfDirect;
      }
    }

    // totalCollateralBase / totalDebtBase are Aave USD base units (8 decimals).
    // totalCollateralUsd / totalDebtUsd are already human USD when provided alone.
    const collBase = parseBigIntish(raw.totalCollateralBase);
    if (collBase != null) {
      features.totalCollateralUsd = aaveBaseToUsd(collBase);
    } else {
      const n = asFiniteNumber(raw.totalCollateralUsd);
      if (n != null) features.totalCollateralUsd = n;
    }
    const debtBase = parseBigIntish(raw.totalDebtBase);
    if (debtBase != null) {
      features.totalDebtUsd = aaveBaseToUsd(debtBase);
    } else {
      const n = asFiniteNumber(raw.totalDebtUsd);
      if (n != null) features.totalDebtUsd = n;
    }
  }

  // ── apy_delta ─────────────────────────────────────────
  if (signalType === "apy_delta") {
    const liquidityRay = parseBigIntish(
      raw.liquidityRateRay ?? raw.liquidityRate ?? raw.aaveSupplyApyRay,
    );
    let aaveSupplyApyBps = asFiniteNumber(
      raw.aaveSupplyApyBps ?? raw.supplyApyBps,
    );
    if (aaveSupplyApyBps == null && liquidityRay != null) {
      aaveSupplyApyBps = liquidityRateRayToApyBps(liquidityRay);
    }
    if (aaveSupplyApyBps != null) {
      features.aaveSupplyApyBps = aaveSupplyApyBps;
    }

    const idleUsdcApyBps = asFiniteNumber(raw.idleUsdcApyBps) ?? 0;
    features.idleUsdcApyBps = idleUsdcApyBps;

    const morpho = asFiniteNumber(raw.morphoApyBps);
    if (morpho != null) features.morphoApyBps = morpho;

    if (features.aaveSupplyApyBps != null) {
      features.apyDeltaBps = Math.round(
        features.aaveSupplyApyBps - idleUsdcApyBps,
      );
    } else {
      const delta = asFiniteNumber(raw.apyDeltaBps);
      if (delta != null) features.apyDeltaBps = delta;
    }

    if (options?.consecutiveEdgePolls != null) {
      features.consecutiveEdgePolls = options.consecutiveEdgePolls;
    } else {
      const c = asFiniteNumber(raw.consecutiveEdgePolls);
      if (c != null) features.consecutiveEdgePolls = Math.trunc(c);
    }
  }

  // ── oracle_basis ──────────────────────────────────────
  if (signalType === "oracle_basis") {
    const oracleDecimals = asFiniteNumber(raw.oracleDecimals) ?? 8;
    const oracleAnswer = parseBigIntish(
      raw.oracleAnswer ?? raw.oraclePriceRaw ?? raw.answer,
    );
    let oraclePrice = asFiniteNumber(raw.oraclePrice);
    if (oraclePrice == null && oracleAnswer != null && oracleAnswer > 0n) {
      oraclePrice = decodeEthUsdOraclePrice(oracleAnswer, oracleDecimals);
    } else if (oraclePrice != null) {
      oraclePrice = coerceEthUsdOraclePrice(oraclePrice, oracleAnswer, oracleDecimals);
    }
    if (oraclePrice != null && oraclePrice > 0) {
      features.oraclePrice = oraclePrice;
    }

    const updatedAtSec = asFiniteNumber(
      raw.oracleUpdatedAt ?? raw.updatedAt ?? raw.oracleUpdatedAtSec,
    );
    const updatedAtMs = asFiniteNumber(raw.oracleUpdatedAtMs);
    if (updatedAtMs != null) {
      features.oracleUpdatedAtMs = updatedAtMs;
    } else if (updatedAtSec != null) {
      // Chainlink updatedAt is unix seconds when < 1e12
      features.oracleUpdatedAtMs =
        updatedAtSec < 1e12 ? updatedAtSec * 1000 : updatedAtSec;
    }

    // Always require decimals (defaults: WETH=18 in, USDC=6 out for primary leg).
    const inDec =
      asFiniteNumber(raw.ammTokenInDecimals) ?? DEFAULT_AMM_TOKEN_IN_DECIMALS;
    const outDec =
      asFiniteNumber(raw.ammTokenOutDecimals) ?? DEFAULT_AMM_TOKEN_OUT_DECIMALS;
    features.ammTokenInDecimals = inDec;
    features.ammTokenOutDecimals = outDec;

    const amountOut = parseBigIntish(raw.ammAmountOut ?? raw.amountOut);
    const amountIn = parseBigIntish(raw.ammAmountIn ?? raw.amountIn);
    const reverseAmountOut = parseBigIntish(
      raw.ammReverseAmountOut ?? raw.reverseAmountOut,
    );
    const reverseAmountIn = parseBigIntish(
      raw.ammReverseAmountIn ?? raw.reverseAmountIn,
    );

    const tokenIn =
      asString(raw.ammTokenIn) ?? asString(raw.tokenIn) ?? "WETH";
    const tokenOut =
      asString(raw.ammTokenOut) ?? asString(raw.tokenOut) ?? "USDC";
    features.ammTokenIn = tokenIn;
    features.ammTokenOut = tokenOut;

    const resolved = resolveAmmEthUsdPrice({
      ammPrice: asFiniteNumber(raw.ammPrice),
      amountIn,
      amountOut,
      tokenInDecimals: inDec,
      tokenOutDecimals: outDec,
      tokenIn,
      tokenOut,
      pair: asString(raw.pair),
      quoteDirection:
        asString(raw.ammQuoteDirection) ?? asString(raw.quoteDirection),
      reverseAmountIn,
      reverseAmountOut,
      reverseTokenInDecimals:
        asFiniteNumber(raw.ammReverseTokenInDecimals) ??
        asFiniteNumber(raw.reverseTokenInDecimals) ??
        DEFAULT_AMM_TOKEN_OUT_DECIMALS,
      reverseTokenOutDecimals:
        asFiniteNumber(raw.ammReverseTokenOutDecimals) ??
        asFiniteNumber(raw.reverseTokenOutDecimals) ??
        DEFAULT_AMM_TOKEN_IN_DECIMALS,
      reverseTokenIn:
        asString(raw.ammReverseTokenIn) ?? asString(raw.reverseTokenIn) ?? "USDC",
      reverseTokenOut:
        asString(raw.ammReverseTokenOut) ?? asString(raw.reverseTokenOut) ?? "WETH",
    });

    if (resolved.ammPrice != null && resolved.ammPrice > 0) {
      features.ammPrice = resolved.ammPrice;
    }
    features.ammQuoteMethod = resolved.quoteMethod;
    if (resolved.forwardPrice != null) {
      features.ammForwardPrice = resolved.forwardPrice;
    }
    if (resolved.reversePrice != null) {
      features.ammReversePrice = resolved.reversePrice;
    }
    if (resolved.outOfBand) {
      features.ammPriceOutOfBand = true;
    }
    const fee = asFiniteNumber(raw.ammFee ?? raw.fee);
    if (fee != null) features.ammFee = fee;

    if (
      features.oraclePrice != null &&
      features.oraclePrice > 0 &&
      features.ammPrice != null &&
      features.ammPrice > 0
    ) {
      features.basisBps = Math.round(
        ((features.ammPrice - features.oraclePrice) / features.oraclePrice) *
          10_000,
      );
    } else {
      const basis = asFiniteNumber(raw.basisBps);
      if (basis != null) features.basisBps = basis;
    }
  }

  // ── gas_regime ────────────────────────────────────────
  if (signalType === "gas_regime") {
    const gwei = asFiniteNumber(raw.gasGwei ?? raw.gasPriceGwei);
    if (gwei != null) features.gasGwei = gwei;
    const regime = raw.gasRegime;
    if (
      regime === "normal" ||
      regime === "elevated" ||
      regime === "critical"
    ) {
      features.gasRegime = regime;
    }
  }

  // ── capital_tick / manual / liquidation ───────────────
  if (signalType === "manual" || signalType === "liquidation_cluster") {
    const sev = asFiniteNumber(raw.severity);
    if (sev != null) features.severity = sev;
  }

  return features;
}

export function createDeskSignalIngestService(
  deps: DeskSignalIngestDeps,
): DeskSignalIngestService {
  const { signalEngine, signals, config } = deps;

  async function enrichGasGwei(
    features: DeskSignalFeatures,
  ): Promise<DeskSignalFeatures> {
    if (features.gasGwei != null && Number.isFinite(features.gasGwei)) {
      return features;
    }
    const rpc = deps.rpcUrl?.trim();
    if (!rpc) return features;
    try {
      const client = createPublicClient({
        chain: chainFromId(DESK_CHAIN_ID),
        transport: http(rpc),
      });
      let wei: bigint | undefined;
      try {
        const fees = await client.estimateFeesPerGas();
        wei = fees.maxFeePerGas;
      } catch {
        // fall through to legacy gasPrice
      }
      if (wei == null) {
        wei = await client.getGasPrice();
      }
      if (wei == null) return features;
      const gwei = Number(formatUnits(wei, 9));
      if (!Number.isFinite(gwei)) return features;
      return {
        ...features,
        gasGwei: gwei,
        gasRegime: signalEngine.gasRegimeFromGwei(gwei),
      };
    } catch (error) {
      console.warn(
        "[desk-signal-ingest] gas enrichment failed:",
        error instanceof Error ? error.message : error,
      );
      return features;
    }
  }

  async function countConsecutiveApyEdges(
    currentDeltaBps: number,
  ): Promise<number> {
    if (Math.abs(currentDeltaBps) < config.apyDeltaBps) {
      return 0;
    }
    const recent = await signals.listByType("apy_delta", 20);
    if (!recent.ok) return 1;

    let streak = 1; // current poll counts
    for (const row of recent.value) {
      const f = (row.features ?? {}) as DeskSignalFeatures;
      const delta = f.apyDeltaBps;
      if (delta == null || !Number.isFinite(delta)) break;
      if (Math.abs(delta) < config.apyDeltaBps) break;
      // same sign edge continues streak
      if (Math.sign(delta) !== Math.sign(currentDeltaBps) && currentDeltaBps !== 0) {
        break;
      }
      streak += 1;
    }
    return streak;
  }

  async function ingest(payload: DeskReadPayload): Promise<DeskSignalIngestResult> {
    const qualityErrors: string[] = [];

    if (!payload || typeof payload !== "object") {
      return {
        accepted: false,
        statusCode: 400,
        message: "Body must be a JSON object",
        qualityErrors: ["payload_not_object"],
      };
    }

    const signalTypeRaw = asString(payload.signalType ?? payload.signal_type);
    if (!signalTypeRaw || !SIGNAL_TYPE_SET.has(signalTypeRaw)) {
      qualityErrors.push(
        `signalType must be one of: ${DESK_SIGNAL_TYPES.join(", ")}`,
      );
    }
    const signalType = signalTypeRaw as DeskSignalType;

    const chainId = asFiniteNumber(payload.chainId ?? payload.chain_id);
    if (chainId == null) {
      qualityErrors.push("chainId is required");
    } else if (chainId !== DESK_CHAIN_ID) {
      qualityErrors.push(
        `chainId must be ${DESK_CHAIN_ID} (Ethereum Sepolia); got ${chainId}`,
      );
    }

    const featuresRaw = asRecord(payload.features) ?? {};
    const sourcesRaw = asRecord(payload.sources) ?? {};
    const pollKind =
      asString(payload.pollKind) ??
      asString(sourcesRaw.pollKind) ??
      asString(payload.poll_kind);

    const sources: DeskSignalSources = {
      ...sourcesRaw,
      ...(pollKind ? { pollKind } : {}),
      ...(asString(payload.workflowRunId) || asString(sourcesRaw.workflowRunId)
        ? {
            workflowRunId:
              asString(payload.workflowRunId) ??
              asString(sourcesRaw.workflowRunId),
          }
        : {}),
      ...(asString(payload.deskAddress)
        ? { deskAddress: asString(payload.deskAddress) }
        : {}),
    };

    // Merge top-level readResults into sources if provided
    const topReads = asRecord(payload.readResults);
    if (topReads) {
      sources.readResults = {
        ...((asRecord(sources.readResults) as Record<string, unknown>) ?? {}),
        ...topReads,
      };
    }

    if (!hasSourceProofs(sources)) {
      qualityErrors.push(
        "sources must include proofs: contracts, readResults, txRefs, workflowRunId, or pollKind",
      );
    }

    if (qualityErrors.length > 0 && !signalTypeRaw) {
      return {
        accepted: false,
        statusCode: 400,
        message: `Signal quality bar failed: ${qualityErrors.join("; ")}`,
        qualityErrors,
      };
    }

    if (qualityErrors.length > 0) {
      return {
        accepted: false,
        statusCode: 400,
        message: `Signal quality bar failed: ${qualityErrors.join("; ")}`,
        qualityErrors,
      };
    }

    // Normalize features for this signal type
    let features = normalizeDeskSignalFeatures(signalType, featuresRaw);

    if (signalType === "gas_regime") {
      features = await enrichGasGwei(features);
      if (features.gasGwei != null && !features.gasRegime) {
        features.gasRegime = signalEngine.gasRegimeFromGwei(features.gasGwei);
      }
    }

    if (signalType === "apy_delta" && features.apyDeltaBps != null) {
      const consecutive = await countConsecutiveApyEdges(features.apyDeltaBps);
      features.consecutiveEdgePolls =
        features.consecutiveEdgePolls ?? consecutive;
      // Recompute with consecutive for accurate classification path
      features = normalizeDeskSignalFeatures(signalType, {
        ...featuresRaw,
        ...features,
        consecutiveEdgePolls: features.consecutiveEdgePolls,
      }, { consecutiveEdgePolls: features.consecutiveEdgePolls });
    }

    if (!hasPolicyNumericFeatures(signalType, features)) {
      return {
        accepted: false,
        statusCode: 400,
        message: `Signal quality bar failed: missing numeric features for ${signalType}`,
        qualityErrors: [`missing_numeric_features:${signalType}`],
      };
    }

    const dedupeKey =
      asString(payload.dedupeKey) ??
      asString(payload.dedupe_key) ??
      signalEngine.buildDedupeKey({
        signalType,
        chainId: DESK_CHAIN_ID,
        features,
        sourceId: asString(payload.sourceId) ?? asString(sources.workflowRunId),
      });

    if (!dedupeKey) {
      return {
        accepted: false,
        statusCode: 400,
        message: "Signal quality bar failed: dedupe_key required",
        qualityErrors: ["dedupe_key_missing"],
      };
    }

    try {
      const result = await signalEngine.ingest({
        signalType,
        chainId: DESK_CHAIN_ID,
        features,
        sources,
        dedupeKey,
        signalOrigin: "desk_read",
        sourceDedupeKey: dedupeKey,
        sourceEvidence: {
          pollKind: pollKind ?? null,
          signalType,
          chainId: DESK_CHAIN_ID,
        },
      });

      // Best-effort Desk-trigger Alert for non-ignore desk-native conditions.
      // Never blocks Signal acceptance or the Desk decision path.
      let linkedRow = result.row;
      if (deps.deskTriggerAlerts) {
        try {
          const alertResult = await deps.deskTriggerAlerts.createFromSignal({
            signal: result.row,
            skipIfLinked: true,
          });
          if (alertResult?.alert?.id && !result.row.source_alert_id) {
            // Re-read so callers see source_alert_id after linkage.
            const refreshed = await signals.findById(result.row.id);
            if (refreshed.ok && refreshed.value) {
              linkedRow = refreshed.value;
            } else {
              linkedRow = {
                ...result.row,
                source_alert_id: alertResult.alert.id,
                signal_origin: result.row.signal_origin ?? "desk_read",
              };
            }
          }
        } catch (alertError) {
          console.warn(
            "[desk-signal-ingest] desk-trigger alert failed (non-blocking):",
            alertError instanceof Error ? alertError.message : alertError,
          );
        }
      }

      // policy_verdict is always set by signal engine classify — quality bar complete
      return {
        accepted: true,
        statusCode: result.deduped ? 200 : 202,
        message: result.deduped
          ? "Desk signal already ingested (deduped)"
          : "Desk signal accepted",
        signal: result.signal,
        row: linkedRow,
        deduped: result.deduped,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error("[desk-signal-ingest] persist failed:", msg);
      return {
        accepted: false,
        statusCode: 500,
        message: `Desk signal ingest failed: ${msg}`,
      };
    }
  }

  return { ingest };
}

/** Exposed for unit tests — map gas gwei using same thresholds as policy. */
export function classifyGasRegimeForTest(
  gasGwei: number | undefined | null,
  elevatedGwei: number,
): GasRegime {
  if (gasGwei == null || !Number.isFinite(gasGwei)) return "normal";
  if (gasGwei >= elevatedGwei * 2) return "critical";
  if (gasGwei >= elevatedGwei) return "elevated";
  return "normal";
}
