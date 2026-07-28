/**
 * Failure recovery classifier (Role C).
 * Proposes next step from an allowlist only — never invents recovery paths.
 */

import {
  DESK_AGENT_TEMPERATURE,
  DESK_AGENT_TIMEOUT_MS,
} from "@chronicleai/config";
import {
  DESK_FAILURE_RECOVERY_ACTIONS,
  type DeskFailureRecoveryAction,
  type LLMProvider,
} from "@chronicleai/schemas";
import {
  LLM_PROVIDER_CALLERS,
  extractJsonObject,
  type LLMProviderConfig,
  type LLMProviderMap,
} from "../../services/llm-provider-client.ts";
import type { DeskFailureClassification } from "./types.ts";

export { DESK_FAILURE_RECOVERY_ACTIONS };
export type { DeskFailureRecoveryAction };

const ACTION_SET = new Set<string>(DESK_FAILURE_RECOVERY_ACTIONS);

export interface FailureClassifyInput {
  strategy: string;
  errorMessage: string | null;
  notionalUsdc: number;
  healthFactor?: number | null | undefined;
  killSwitchArmed?: boolean | undefined;
  consecutiveFailures?: number | undefined;
  reasonCodes?: string[] | undefined;
}

const SYSTEM = [
  "You classify Chronicle Desk execution failures.",
  "Choose exactly one nextStep from: retry_smaller | cooldown | arm_kill | hold | ignore.",
  "Rules:",
  "- arm_kill only if liquidation risk or repeated catastrophic failure with open leverage risk.",
  "- retry_smaller for transient gas/slippage/size issues.",
  "- cooldown for rate limits, single-flight, or temporary venue issues.",
  "- hold when unclear or policy should stay flat.",
  "- ignore for duplicate/stale noise.",
  'Respond ONLY JSON: { "nextStep": string, "confidence": number, "reason": string }',
].join("\n");

function heuristicClassify(input: FailureClassifyInput): DeskFailureClassification {
  const err = (input.errorMessage ?? "").toLowerCase();
  const fails = input.consecutiveFailures ?? 1;
  const hf = input.healthFactor;

  if (input.killSwitchArmed) {
    return {
      version: 1,
      nextStep: "hold",
      confidence: 0.9,
      reason: "Kill switch already armed — no recovery trade.",
    };
  }

  if (hf != null && Number.isFinite(hf) && hf < 1.05) {
    return {
      version: 1,
      nextStep: "arm_kill",
      confidence: 0.85,
      reason: `Health factor ${hf} is near liquidation after failure.`,
    };
  }

  if (
    err.includes("slippage") ||
    err.includes("insufficient") ||
    err.includes("too large") ||
    err.includes("size")
  ) {
    return {
      version: 1,
      nextStep: "retry_smaller",
      confidence: 0.7,
      reason: "Size or slippage related failure — retry smaller if policy allows.",
    };
  }

  if (
    err.includes("timeout") ||
    err.includes("rate") ||
    err.includes("429") ||
    err.includes("single-flight") ||
    err.includes("cooldown")
  ) {
    return {
      version: 1,
      nextStep: "cooldown",
      confidence: 0.75,
      reason: "Transient / rate-limit style failure.",
    };
  }

  if (fails >= 3) {
    return {
      version: 1,
      nextStep: "cooldown",
      confidence: 0.7,
      reason: `${fails} consecutive failures — cool down before retry.`,
    };
  }

  return {
    version: 1,
    nextStep: "hold",
    confidence: 0.6,
    reason: "Default hold after unclassified failure.",
  };
}

function parseClassification(
  raw: string,
  model?: string,
  latencyMs?: number,
): DeskFailureClassification | null {
  const json = extractJsonObject(raw);
  if (!json) return null;
  try {
    const obj = JSON.parse(json) as Record<string, unknown>;
    const next = typeof obj.nextStep === "string" ? obj.nextStep.trim().toLowerCase() : "";
    if (!ACTION_SET.has(next)) return null;
    const confidence =
      typeof obj.confidence === "number" && Number.isFinite(obj.confidence)
        ? Math.max(0, Math.min(1, obj.confidence))
        : 0.5;
    const reason =
      typeof obj.reason === "string" && obj.reason.trim()
        ? obj.reason.trim().slice(0, 400)
        : "Classified by model.";
    return {
      version: 1,
      nextStep: next as DeskFailureRecoveryAction,
      confidence,
      reason,
      ...(model ? { model } : {}),
      ...(latencyMs !== undefined ? { latencyMs } : {}),
    };
  } catch {
    return null;
  }
}

export interface FailureClassifier {
  classify(input: FailureClassifyInput): Promise<DeskFailureClassification>;
}

export function createFailureClassifier(
  providerConfigs: LLMProviderMap | null | undefined,
  opts: {
    preferredProvider?: LLMProvider | undefined;
    timeoutMs?: number | undefined;
    temperature?: number | undefined;
    callLlm?: (
      provider: LLMProvider,
      config: LLMProviderConfig,
      prompt: string,
      signal: AbortSignal,
      systemInstruction: string,
    ) => Promise<string>;
  } = {},
): FailureClassifier {
  const timeoutMs = opts.timeoutMs ?? DESK_AGENT_TIMEOUT_MS;
  const temperature = opts.temperature ?? DESK_AGENT_TEMPERATURE;

  return {
    async classify(input) {
      const started = Date.now();
      const fallback = heuristicClassify(input);

      if (!providerConfigs) {
        return { ...fallback, latencyMs: Date.now() - started };
      }

      const order: LLMProvider[] = opts.preferredProvider
        ? [opts.preferredProvider, "gemini", "openai", "groq"]
        : ["gemini", "openai", "groq"];

      for (const provider of order) {
        const base = providerConfigs[provider];
        if (!base?.apiKey?.trim()) continue;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const cfg: LLMProviderConfig = { ...base, temperature };
          const prompt = [
            `Strategy: ${input.strategy}`,
            `Notional USDC: ${input.notionalUsdc}`,
            `Error: ${input.errorMessage ?? "(none)"}`,
            `Health factor: ${input.healthFactor ?? "n/a"}`,
            `Kill armed: ${Boolean(input.killSwitchArmed)}`,
            `Consecutive failures: ${input.consecutiveFailures ?? 1}`,
            `Reason codes: ${(input.reasonCodes ?? []).join(", ") || "(none)"}`,
            "",
            "Classify nextStep JSON.",
          ].join("\n");

          const call =
            opts.callLlm ??
            ((p, c, pr, signal, sys) => LLM_PROVIDER_CALLERS[p](c, pr, signal, sys));
          const raw = await call(provider, cfg, prompt, controller.signal, SYSTEM);
          const parsed = parseClassification(
            raw,
            `${provider}:${cfg.model}`,
            Date.now() - started,
          );
          if (parsed) return parsed;
        } catch {
          // try next / fall back
        } finally {
          clearTimeout(timer);
        }
      }

      return { ...fallback, latencyMs: Date.now() - started };
    },
  };
}
