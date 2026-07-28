/**
 * Desk signal engine: normalize poll/event features → severity + policy verdict,
 * build windowed dedupe keys, and persist via desk_signals repository.
 */

import {
  DESK_CHAIN_ID,
  DESK_SIGNAL_TYPES,
  type DeskPolicyVerdict,
  type DeskSignalType,
} from "@chronicleai/schemas";
import type { DeskSignalRepository, DeskSignalRow } from "@chronicleai/db";
import type { DeskPolicyConfig, DeskSignalFeatures, DeskSignalInput, DeskSignalRecord, DeskSignalSources, GasRegime } from "./types.ts";
import type { PolicyEngine } from "./policy-engine.ts";
import type { SignalFusionJudge } from "./agent/signal-fusion.ts";
import {
  DESK_BASIS_ABSURD_BPS,
  isPlausibleEthUsdPrice,
} from "./oracle-amm-pricing.ts";

const SIGNAL_TYPE_SET = new Set<string>(DESK_SIGNAL_TYPES);

export interface SignalEngine {
  /**
   * Classify raw features into severity + provisional policy verdict (pre-intent).
   */
  classify(
    signalType: DeskSignalType,
    features: DeskSignalFeatures,
  ): { severity: number; policyVerdict: DeskPolicyVerdict; reasonCodes: string[] };

  /** Windowed dedupe key: type + chain + bucketed feature fingerprint. */
  buildDedupeKey(input: {
    signalType: DeskSignalType;
    chainId?: number | undefined;
    features: DeskSignalFeatures;
    /** Optional explicit source id (workflow run / tx). */
    sourceId?: string | undefined;
    /** Window size for time bucketing (default 15m). */
    windowMs?: number | undefined;
    nowMs?: number | undefined;
  }): string;

  /**
   * Build a fully classified signal record (does not persist).
   * Rejects non-Sepolia chain ids for executable path.
   */
  buildSignal(input: DeskSignalInput): DeskSignalRecord;

  /**
   * Persist signal with dedupe. Returns existing row when dedupe_key already present.
   */
  ingest(input: DeskSignalInput): Promise<{
    signal: DeskSignalRecord;
    row: DeskSignalRow;
    deduped: boolean;
  }>;

  /** Normalize gas gwei → regime using policy thresholds. */
  gasRegimeFromGwei(gasGwei: number | undefined | null): GasRegime;
}

function clampSeverity(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function bucket(value: number, step: number): number {
  if (!Number.isFinite(value) || step <= 0) return 0;
  return Math.floor(value / step) * step;
}

export function createSignalEngine(deps: {
  policy: PolicyEngine;
  config: DeskPolicyConfig;
  signals: DeskSignalRepository;
  /** Optional soft fusion judge (Role D) — labels borderline oracle/apy signals. */
  fusionJudge?: SignalFusionJudge | null | undefined;
}): SignalEngine {
  const { policy, config, signals } = deps;

  function gasRegimeFromGwei(gasGwei: number | undefined | null): GasRegime {
    return policy.classifyGasRegime(gasGwei);
  }

  function classify(
    signalType: DeskSignalType,
    features: DeskSignalFeatures,
  ): { severity: number; policyVerdict: DeskPolicyVerdict; reasonCodes: string[] } {
    const reasonCodes: string[] = [];

    switch (signalType) {
      case "health_factor": {
        const hf = features.hf;
        if (hf == null || !Number.isFinite(hf)) {
          return { severity: 0, policyVerdict: "ignore", reasonCodes: ["hf_missing"] };
        }
        if (hf > 100) {
          return { severity: 5, policyVerdict: "ignore", reasonCodes: ["hf_no_debt"] };
        }
        if (hf < config.hfCritical) {
          return {
            severity: 95,
            policyVerdict: "defend",
            reasonCodes: ["hf_critical"],
          };
        }
        if (hf < config.hfWarn) {
          return {
            severity: 70,
            policyVerdict: "defend",
            reasonCodes: ["hf_warn"],
          };
        }
        return { severity: 10, policyVerdict: "ignore", reasonCodes: ["hf_healthy"] };
      }

      case "apy_delta": {
        const signed = features.apyDeltaBps ?? 0;
        const delta = Math.abs(signed);
        const consecutive = features.consecutiveEdgePolls ?? 0;
        // Absurd testnet rates: keep tradeable so maintenance free-powder can run;
        // fusion labels data_quality and strategy never claims yield edge.
        if (delta >= config.apyAbsurdBps) {
          return {
            severity: clampSeverity(35),
            policyVerdict: "trade",
            reasonCodes: [
              "apy_data_quality",
              "maintenance_eligible",
              `apy_absurd_bps=${delta}`,
            ],
          };
        }
        if (delta < config.apyDeltaBps) {
          return {
            severity: clampSeverity(delta / 2),
            policyVerdict: "ignore",
            reasonCodes: ["apy_below_threshold"],
          };
        }
        if (consecutive < config.apyConsecutivePolls) {
          return {
            severity: clampSeverity(30 + delta / 5),
            policyVerdict: "defer",
            reasonCodes: ["apy_edge_pending_consecutive"],
          };
        }
        return {
          severity: clampSeverity(40 + delta / 4),
          policyVerdict: "trade",
          reasonCodes: ["apy_edge"],
        };
      }

      case "oracle_basis": {
        const basis = Math.abs(features.basisBps ?? 0);
        const oracle = features.oraclePrice;
        const amm = features.ammPrice;
        // Absolute ETH/USD band: refuse trade when either mid is nonsense.
        if (
          oracle != null &&
          Number.isFinite(oracle) &&
          !isPlausibleEthUsdPrice(oracle)
        ) {
          return {
            severity: 15,
            policyVerdict: "ignore",
            reasonCodes: [
              "basis_data_quality",
              "oracle_price_out_of_band",
              `oracle=${oracle}`,
            ],
          };
        }
        if (amm != null && Number.isFinite(amm) && !isPlausibleEthUsdPrice(amm)) {
          return {
            severity: 15,
            policyVerdict: "ignore",
            reasonCodes: [
              "basis_data_quality",
              "amm_price_out_of_band",
              `amm=${amm}`,
            ],
          };
        }
        // Guard mis-scaled oracle/AMM units (e.g. answer / 1e8 twice).
        // Real dislocations of > DESK_BASIS_ABSURD_BPS are data quality failures
        // (includes honest but unusable Sepolia WETH/USDC vs Chainlink gaps).
        if (basis > DESK_BASIS_ABSURD_BPS) {
          return {
            severity: 15,
            policyVerdict: "ignore",
            reasonCodes: [
              "basis_data_quality",
              `basis_bps=${features.basisBps ?? 0}`,
              ...(oracle != null ? [`oracle=${oracle}`] : []),
              ...(amm != null ? [`amm=${amm}`] : []),
            ],
          };
        }
        if (basis < config.basisBps) {
          return {
            severity: clampSeverity(basis / 2),
            policyVerdict: "ignore",
            reasonCodes: ["basis_below_threshold"],
          };
        }
        if (
          features.oracleUpdatedAtMs != null &&
          Date.now() - features.oracleUpdatedAtMs > config.oracleMaxStalenessMs
        ) {
          return {
            severity: clampSeverity(20 + basis / 5),
            policyVerdict: "ignore",
            reasonCodes: ["oracle_stale"],
          };
        }
        return {
          severity: clampSeverity(50 + basis / 2),
          policyVerdict: "trade",
          reasonCodes: ["basis_dislocation"],
        };
      }

      case "gas_regime": {
        const gwei = features.gasGwei;
        const regime = features.gasRegime ?? gasRegimeFromGwei(gwei);
        if (regime === "critical") {
          return {
            severity: 80,
            policyVerdict: "defer",
            reasonCodes: ["gas_critical"],
          };
        }
        if (regime === "elevated") {
          return {
            severity: 50,
            policyVerdict: "defer",
            reasonCodes: ["gas_elevated"],
          };
        }
        return { severity: 5, policyVerdict: "ignore", reasonCodes: ["gas_normal"] };
      }

      case "liquidation_cluster": {
        return {
          severity: clampSeverity(Number(features.severity) || 85),
          policyVerdict: "defend",
          reasonCodes: ["liquidation_cluster"],
        };
      }

      case "capital_tick": {
        return { severity: 5, policyVerdict: "ignore", reasonCodes: ["capital_tick"] };
      }

      case "manual": {
        return {
          severity: clampSeverity(Number(features.severity) || 50),
          policyVerdict: (features.policyVerdict as DeskPolicyVerdict) ?? "defer",
          reasonCodes: ["manual"],
        };
      }

      default: {
        reasonCodes.push("unknown_signal_type");
        return { severity: 0, policyVerdict: "ignore", reasonCodes };
      }
    }
  }

  function buildDedupeKey(input: {
    signalType: DeskSignalType;
    chainId?: number | undefined;
    features: DeskSignalFeatures;
    sourceId?: string | undefined;
    windowMs?: number | undefined;
    nowMs?: number | undefined;
  }): string {
    const chainId = input.chainId ?? DESK_CHAIN_ID;
    const windowMs = input.windowMs ?? 15 * 60_000;
    const now = input.nowMs ?? Date.now();
    const windowBucket = Math.floor(now / windowMs);

    if (input.sourceId) {
      return `desk:${chainId}:${input.signalType}:src:${input.sourceId}`;
    }

    const f = input.features;
    const parts: string[] = [
      "desk",
      String(chainId),
      input.signalType,
      `w${windowBucket}`,
    ];

    if (f.hf != null) parts.push(`hf${bucket(f.hf, 0.05).toFixed(2)}`);
    if (f.basisBps != null) parts.push(`b${bucket(f.basisBps, 10)}`);
    if (f.apyDeltaBps != null) parts.push(`a${bucket(f.apyDeltaBps, 10)}`);
    if (f.gasGwei != null) parts.push(`g${bucket(f.gasGwei, 5)}`);
    if (f.gasRegime) parts.push(f.gasRegime);

    return parts.join(":");
  }

  function buildSignal(input: DeskSignalInput): DeskSignalRecord {
    if (!SIGNAL_TYPE_SET.has(input.signalType)) {
      throw new Error(`Unknown desk signal type: ${input.signalType}`);
    }

    const chainId = input.chainId ?? DESK_CHAIN_ID;
    if (chainId !== DESK_CHAIN_ID) {
      // Executable path is Sepolia-only; still allow record with ignore verdict.
      const createdAt = input.createdAt ?? new Date().toISOString();
      return {
        signalType: input.signalType,
        chainId,
        severity: 0,
        features: input.features,
        sources: input.sources ?? {},
        policyVerdict: "ignore",
        dedupeKey: input.dedupeKey,
        createdAt,
      };
    }

    const classified = classify(input.signalType, input.features);
    const gasFromFeatures = input.features.gasGwei;
    const features: DeskSignalFeatures = {
      ...input.features,
      gasRegime:
        input.features.gasRegime ??
        (gasFromFeatures != null ? gasRegimeFromGwei(gasFromFeatures) : undefined),
    };

    return {
      signalType: input.signalType,
      chainId,
      severity: input.severity ?? classified.severity,
      features,
      sources: (input.sources ?? {}) as DeskSignalSources,
      policyVerdict: classified.policyVerdict,
      dedupeKey: input.dedupeKey,
      createdAt: input.createdAt ?? new Date().toISOString(),
    };
  }

  async function ingest(input: DeskSignalInput): Promise<{
    signal: DeskSignalRecord;
    row: DeskSignalRow;
    deduped: boolean;
  }> {
    const existing = await signals.findByDedupeKey(input.dedupeKey);
    if (!existing.ok) {
      throw existing.error;
    }
    if (existing.value) {
      const row = existing.value;
      return {
        deduped: true,
        row,
        signal: {
          id: row.id,
          signalType: row.signal_type as DeskSignalType,
          chainId: row.chain_id,
          severity: row.severity,
          features: (row.features ?? {}) as DeskSignalFeatures,
          sources: (row.sources ?? {}) as DeskSignalSources,
          policyVerdict: row.policy_verdict as DeskPolicyVerdict,
          dedupeKey: row.dedupe_key,
          createdAt: row.created_at,
        },
      };
    }

    const signal = buildSignal(input);

    // Soft fusion labels (Role D) for borderline oracle/apy — heuristic or LLM.
    if (
      deps.fusionJudge &&
      (signal.signalType === "oracle_basis" || signal.signalType === "apy_delta")
    ) {
      try {
        const fusion = await deps.fusionJudge.judge({
          signalType: signal.signalType,
          features: signal.features,
          severity: signal.severity,
          policyVerdict: signal.policyVerdict,
          basisBpsThreshold: config.basisBps,
          apyDeltaBpsThreshold: config.apyDeltaBps,
          apyConsecutivePolls: config.apyConsecutivePolls,
          apyAbsurdBpsThreshold: config.apyAbsurdBps,
        });
        signal.features = {
          ...signal.features,
          fusionLabel: fusion.label,
          fusionConfidence: fusion.confidence,
          fusionReason: fusion.reason,
        };
        // Soft-downrank noise / data_quality when not defend-critical.
        // Keep absurd-APY maintenance_eligible trades open (strategy free-powder path).
        if (
          (fusion.label === "noise" || fusion.label === "data_quality") &&
          signal.policyVerdict === "trade"
        ) {
          const absDelta = Math.abs(signal.features.apyDeltaBps ?? 0);
          const maintenanceEligible =
            signal.signalType === "apy_delta" && absDelta >= config.apyAbsurdBps;
          if (!maintenanceEligible) {
            signal.policyVerdict = "defer";
          }
        }
      } catch {
        // non-fatal — keep classified verdict
      }
    }

    const created = await signals.create({
      signal_type: signal.signalType,
      chain_id: signal.chainId,
      severity: signal.severity,
      features: signal.features,
      sources: signal.sources,
      policy_verdict: signal.policyVerdict,
      dedupe_key: signal.dedupeKey,
      created_at: signal.createdAt,
    });
    if (!created.ok) {
      // Race: unique dedupe_key — re-read
      const again = await signals.findByDedupeKey(input.dedupeKey);
      if (again.ok && again.value) {
        const row = again.value;
        return {
          deduped: true,
          row,
          signal: {
            id: row.id,
            signalType: row.signal_type as DeskSignalType,
            chainId: row.chain_id,
            severity: row.severity,
            features: (row.features ?? {}) as DeskSignalFeatures,
            sources: (row.sources ?? {}) as DeskSignalSources,
            policyVerdict: row.policy_verdict as DeskPolicyVerdict,
            dedupeKey: row.dedupe_key,
            createdAt: row.created_at,
          },
        };
      }
      throw created.error;
    }

    return {
      deduped: false,
      row: created.value,
      signal: { ...signal, id: created.value.id },
    };
  }

  return {
    classify,
    buildDedupeKey,
    buildSignal,
    ingest,
    gasRegimeFromGwei,
  };
}
