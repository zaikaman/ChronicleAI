/**
 * Soft signal fusion judge (Role D).
 * Labels borderline oracle_basis / apy_delta signals using provided features only.
 */

import {
  DESK_AGENT_TEMPERATURE,
  DESK_AGENT_TIMEOUT_MS,
} from "@chronicleai/config";
import type { DeskSignalFusionLabel, LLMProvider } from "@chronicleai/schemas";
import {
  createChatModelsInOrder,
  invokeStructuredAgent,
  signalFusionSchema,
} from "../../agents/langchain/index.ts";
import {
  extractJsonObject,
  type LLMProviderConfig,
  type LLMProviderMap,
} from "../../services/llm-provider-client.ts";
import type { DeskSignalFeatures } from "../types.ts";
import type { DeskSignalFusionResult } from "./types.ts";
import {
  DESK_BASIS_ABSURD_BPS,
  isPlausibleEthUsdPrice,
} from "../oracle-amm-pricing.ts";

const LABEL_SET = new Set<string>([
  "actionable",
  "data_quality",
  "noise",
  "wait_for_confirm",
]);

export interface SignalFusionInput {
  signalType: string;
  features: DeskSignalFeatures;
  severity: number;
  policyVerdict: string;
  /** Policy thresholds for context. */
  basisBpsThreshold?: number | undefined;
  apyDeltaBpsThreshold?: number | undefined;
  apyConsecutivePolls?: number | undefined;
  /** APY |delta| above this is data-quality (testnet absurd rates). */
  apyAbsurdBpsThreshold?: number | undefined;
}

const SYSTEM = [
  "You are Chronicle Desk signal quality judge.",
  "Label the signal as exactly one of: actionable | data_quality | noise | wait_for_confirm.",
  "Use only provided features. Never invent prices.",
  "- actionable: edge is real and ready under policy thresholds.",
  "- data_quality: missing/stale oracle, absurd values, incomplete features.",
  "- noise: small edge or random wiggle under threshold.",
  "- wait_for_confirm: borderline; need more consecutive polls.",
  'Respond ONLY JSON: { "label": string, "confidence": number, "reason": string }',
].join("\n");

function heuristicFusion(input: SignalFusionInput): DeskSignalFusionResult {
  const f = input.features;
  const type = input.signalType;

  if (type === "oracle_basis") {
    const basis = f.basisBps;
    const oracle = f.oraclePrice;
    const amm = f.ammPrice;
    const thresh = input.basisBpsThreshold ?? 50;
    if (oracle == null || amm == null || !Number.isFinite(oracle) || !Number.isFinite(amm)) {
      return {
        version: 1,
        label: "data_quality",
        confidence: 0.85,
        reason: "Missing oracle or AMM price.",
      };
    }
    if (oracle <= 0 || amm <= 0) {
      return {
        version: 1,
        label: "data_quality",
        confidence: 0.9,
        reason: "Non-positive price.",
      };
    }
    if (!isPlausibleEthUsdPrice(oracle) || !isPlausibleEthUsdPrice(amm)) {
      return {
        version: 1,
        label: "data_quality",
        confidence: 0.9,
        reason: `ETH/USD mid out of band (oracle=${oracle}, amm=${amm}).`,
      };
    }
    if (basis == null || !Number.isFinite(basis)) {
      return {
        version: 1,
        label: "data_quality",
        confidence: 0.7,
        reason: "basisBps missing.",
      };
    }
    if (Math.abs(basis) > DESK_BASIS_ABSURD_BPS) {
      return {
        version: 1,
        label: "data_quality",
        confidence: 0.88,
        reason: `basisBps ${basis} exceeds absurd ceiling ${DESK_BASIS_ABSURD_BPS} (oracle=${oracle}, amm=${amm}).`,
      };
    }
    if (Math.abs(basis) < thresh * 0.5) {
      return {
        version: 1,
        label: "noise",
        confidence: 0.75,
        reason: `basisBps ${basis} well under threshold ${thresh}.`,
      };
    }
    if (Math.abs(basis) < thresh) {
      return {
        version: 1,
        label: "wait_for_confirm",
        confidence: 0.65,
        reason: `basisBps ${basis} borderline vs ${thresh}.`,
      };
    }
    const staleMs = f.oracleUpdatedAtMs;
    if (staleMs != null && Number.isFinite(staleMs)) {
      const age = Date.now() - staleMs;
      if (age > 60 * 60_000) {
        return {
          version: 1,
          label: "data_quality",
          confidence: 0.8,
          reason: "Oracle updatedAt is stale (>1h).",
        };
      }
    }
    return {
      version: 1,
      label: "actionable",
      confidence: 0.7,
      reason: `basisBps ${basis} clears threshold ${thresh}.`,
    };
  }

  if (type === "apy_delta") {
    const delta = f.apyDeltaBps;
    const thresh = input.apyDeltaBpsThreshold ?? 50;
    const absurd = input.apyAbsurdBpsThreshold ?? 5_000;
    const consecutive = f.consecutiveEdgePolls ?? 0;
    const need = input.apyConsecutivePolls ?? 2;
    if (delta == null || !Number.isFinite(delta)) {
      return {
        version: 1,
        label: "data_quality",
        confidence: 0.75,
        reason: "apyDeltaBps missing.",
      };
    }
    // Testnet / mis-scaled rates are not yield theses.
    if (Math.abs(delta) >= absurd) {
      return {
        version: 1,
        label: "data_quality",
        confidence: 0.9,
        reason: `apyDeltaBps ${delta} exceeds absurd ceiling ${absurd} (unreliable rate).`,
      };
    }
    if (Math.abs(delta) < thresh * 0.5) {
      return {
        version: 1,
        label: "noise",
        confidence: 0.75,
        reason: `apyDeltaBps ${delta} well under ${thresh}.`,
      };
    }
    if (consecutive < need) {
      return {
        version: 1,
        label: "wait_for_confirm",
        confidence: 0.7,
        reason: `consecutiveEdgePolls ${consecutive} < ${need}.`,
      };
    }
    if (Math.abs(delta) < thresh) {
      return {
        version: 1,
        label: "wait_for_confirm",
        confidence: 0.6,
        reason: `apyDeltaBps ${delta} borderline vs ${thresh}.`,
      };
    }
    return {
      version: 1,
      label: "actionable",
      confidence: 0.7,
      reason: `apyDeltaBps ${delta} with ${consecutive} consecutive polls.`,
    };
  }

  // Other types: light-touch
  if (input.policyVerdict === "ignore") {
    return {
      version: 1,
      label: "noise",
      confidence: 0.6,
      reason: "Policy already ignore.",
    };
  }
  return {
    version: 1,
    label: "actionable",
    confidence: 0.5,
    reason: "Default actionable for non-borderline types.",
  };
}

function parseFusion(
  raw: string | Record<string, unknown>,
  model?: string,
  latencyMs?: number,
): DeskSignalFusionResult | null {
  try {
    const obj: Record<string, unknown> | null =
      typeof raw === "string"
        ? (() => {
            const json = extractJsonObject(raw);
            if (!json) return null;
            return JSON.parse(json) as Record<string, unknown>;
          })()
        : raw;
    if (!obj) return null;
    const label = typeof obj.label === "string" ? obj.label.trim().toLowerCase() : "";
    if (!LABEL_SET.has(label)) return null;
    const confidence =
      typeof obj.confidence === "number" && Number.isFinite(obj.confidence)
        ? Math.max(0, Math.min(1, obj.confidence))
        : 0.5;
    const reason =
      typeof obj.reason === "string" && obj.reason.trim()
        ? obj.reason.trim().slice(0, 400)
        : "Fused by model.";
    return {
      version: 1,
      label: label as DeskSignalFusionLabel,
      confidence,
      reason,
      ...(model ? { model } : {}),
      ...(latencyMs !== undefined ? { latencyMs } : {}),
    };
  } catch {
    return null;
  }
}

export interface SignalFusionJudge {
  /**
   * Soft-label a signal. Always returns a label (heuristic fallback).
   * Does not mutate DB — caller may merge into features.fusionLabel.
   */
  judge(input: SignalFusionInput): Promise<DeskSignalFusionResult>;
  /** Pure heuristic (no LLM) for tests and offline path. */
  judgeHeuristic(input: SignalFusionInput): DeskSignalFusionResult;
}

export function createSignalFusionJudge(
  providerConfigs: LLMProviderMap | null | undefined,
  opts: {
    preferredProvider?: LLMProvider | undefined;
    timeoutMs?: number | undefined;
    temperature?: number | undefined;
    /** Use LLM only when borderline; default true. */
    llmOnBorderlineOnly?: boolean | undefined;
    callLlm?: (
      provider: LLMProvider,
      config: LLMProviderConfig,
      prompt: string,
      signal: AbortSignal,
      systemInstruction: string,
    ) => Promise<string>;
  } = {},
): SignalFusionJudge {
  const timeoutMs = opts.timeoutMs ?? DESK_AGENT_TIMEOUT_MS;
  const temperature = opts.temperature ?? DESK_AGENT_TEMPERATURE;
  const llmOnBorderlineOnly = opts.llmOnBorderlineOnly !== false;

  return {
    judgeHeuristic: heuristicFusion,

    async judge(input) {
      const started = Date.now();
      const base = heuristicFusion(input);

      // Skip LLM when clearly data_quality/noise/actionable with high confidence
      if (
        llmOnBorderlineOnly &&
        base.label !== "wait_for_confirm" &&
        base.confidence >= 0.75
      ) {
        return { ...base, latencyMs: Date.now() - started };
      }

      if (!providerConfigs) {
        return { ...base, latencyMs: Date.now() - started };
      }

      const prompt = [
        `Signal type: ${input.signalType}`,
        `Severity: ${input.severity}`,
        `Policy verdict: ${input.policyVerdict}`,
        `Thresholds: basis=${input.basisBpsThreshold ?? 50} apyDelta=${input.apyDeltaBpsThreshold ?? 50} consecutive=${input.apyConsecutivePolls ?? 2}`,
        `Features: ${JSON.stringify(input.features)}`,
        "",
        "Return fusion label JSON.",
      ].join("\n");

      if (opts.callLlm) {
        const order: LLMProvider[] = opts.preferredProvider
          ? [opts.preferredProvider, "gemini", "openai", "groq"]
          : ["gemini", "openai", "groq"];
        for (const provider of order) {
          const baseCfg = providerConfigs[provider];
          if (!baseCfg?.apiKey?.trim()) continue;
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeoutMs);
          try {
            const cfg: LLMProviderConfig = { ...baseCfg, temperature };
            const raw = await opts.callLlm(
              provider,
              cfg,
              prompt,
              controller.signal,
              SYSTEM,
            );
            const parsed = parseFusion(
              raw,
              `${provider}:${cfg.model}`,
              Date.now() - started,
            );
            if (parsed) return parsed;
          } catch {
            // next
          } finally {
            clearTimeout(timer);
          }
        }
        return { ...base, latencyMs: Date.now() - started };
      }

      const models = createChatModelsInOrder(
        providerConfigs,
        ["gemini", "openai", "groq"] as const,
        {
          preferredProvider: opts.preferredProvider,
          temperature,
        },
      );

      for (const { provider, model, config } of models) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const result = await invokeStructuredAgent({
            model,
            systemPrompt: SYSTEM,
            userPrompt: prompt,
            responseFormat: signalFusionSchema,
            signal: controller.signal,
            runLimit: 1,
          });
          const parsed = parseFusion(
            result.structured,
            `${provider}:${config.model}`,
            Date.now() - started,
          );
          if (parsed) return parsed;
        } catch {
          // next
        } finally {
          clearTimeout(timer);
        }
      }

      return { ...base, latencyMs: Date.now() - started };
    },
  };
}
