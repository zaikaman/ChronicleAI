/**
 * Post-trade CIO / ticket narrative (Role B).
 * Uses real legs/fills only — never invents tx hashes.
 */

import {
  DESK_AGENT_NARRATIVE_TEMPERATURE,
  DESK_AGENT_TIMEOUT_MS,
} from "@chronicleai/config";
import type { LLMProvider } from "@chronicleai/schemas";
import {
  LLM_PROVIDER_CALLERS,
  extractJsonObject,
  type LLMProviderConfig,
  type LLMProviderMap,
} from "../../services/llm-provider-client.ts";
import type { DeskAgentProposal } from "./types.ts";
import type { DeskIntentFill, DeskLeg } from "../types.ts";

export interface NarrativeInput {
  strategy: string;
  notionalUsdc: number;
  legs: DeskLeg[];
  fills: DeskIntentFill[];
  reasonCodes?: string[] | undefined;
  agentProposal?: DeskAgentProposal | null | undefined;
  signalType?: string | undefined;
  success: boolean;
  errorMessage?: string | undefined;
}

export interface NarrativeResult {
  summary: string;
  editorialBody?: string | undefined;
  provider?: string | undefined;
  latencyMs: number;
  usedLlm: boolean;
}

const NARRATIVE_SYSTEM = [
  "You are Chronicle Desk CIO writing a short trade-ticket summary for a public newspaper.",
  "Rules:",
  "- Use only the provided strategy, notional, legs, fills, and agent thesis.",
  "- Never invent transaction hashes, prices, or protocols not listed.",
  "- 1–3 sentences. Calm, editorial, proof-first tone.",
  '- Respond as JSON: { "summary": string, "editorialBody"?: string }',
].join("\n");

function deterministicSummary(input: NarrativeInput): string {
  const legSummary =
    input.legs.length === 0
      ? "no legs"
      : input.legs
          .map((l) => `${l.protocol}:${l.action}`)
          .slice(0, 4)
          .join(" → ");
  const fillNote =
    input.fills.length > 0
      ? ` · ${input.fills.length} fill${input.fills.length === 1 ? "" : "s"}`
      : "";
  const status = input.success ? "filled" : "failed";
  const thesisSnippet = input.agentProposal?.thesis
    ? ` · ${input.agentProposal.thesis.slice(0, 160)}`
    : "";
  const err = !input.success && input.errorMessage ? ` · ${input.errorMessage.slice(0, 80)}` : "";
  return `Desk ${input.strategy} ${status} · ${input.notionalUsdc} USDC · ${legSummary}${fillNote}${err}${thesisSnippet}`.slice(
    0,
    500,
  );
}

function firstKeyedProvider(
  providers: LLMProviderMap,
  preferred?: LLMProvider,
): { provider: LLMProvider; config: LLMProviderConfig } | null {
  const order: LLMProvider[] = preferred
    ? [preferred, "gemini", "openai", "groq"]
    : ["gemini", "openai", "groq"];
  const seen = new Set<LLMProvider>();
  for (const p of order) {
    if (seen.has(p)) continue;
    seen.add(p);
    const cfg = providers[p];
    if (cfg?.apiKey?.trim()) return { provider: p, config: cfg };
  }
  return null;
}

export interface NarrativeService {
  writeTicketNarrative(input: NarrativeInput): Promise<NarrativeResult>;
}

export function createNarrativeService(
  providerConfigs: LLMProviderMap | null | undefined,
  opts: {
    preferredProvider?: LLMProvider | undefined;
    timeoutMs?: number | undefined;
    temperature?: number | undefined;
    /** Test inject */
    callLlm?: (
      provider: LLMProvider,
      config: LLMProviderConfig,
      prompt: string,
      signal: AbortSignal,
      systemInstruction: string,
    ) => Promise<string>;
  } = {},
): NarrativeService {
  const timeoutMs = opts.timeoutMs ?? DESK_AGENT_TIMEOUT_MS;
  const temperature = opts.temperature ?? DESK_AGENT_NARRATIVE_TEMPERATURE;

  return {
    async writeTicketNarrative(input) {
      const started = Date.now();
      const fallback = deterministicSummary(input);

      if (!providerConfigs) {
        return {
          summary: fallback,
          usedLlm: false,
          latencyMs: Date.now() - started,
        };
      }

      const picked = firstKeyedProvider(providerConfigs, opts.preferredProvider);
      if (!picked) {
        return {
          summary: fallback,
          usedLlm: false,
          latencyMs: Date.now() - started,
        };
      }

      const fillHashes = input.fills
        .map((f) => f.txHash)
        .filter((h): h is string => typeof h === "string" && h.length > 0);

      const prompt = [
        `Strategy: ${input.strategy}`,
        `Notional USDC: ${input.notionalUsdc}`,
        `Outcome: ${input.success ? "filled" : "failed"}`,
        input.signalType ? `Signal: ${input.signalType}` : null,
        input.reasonCodes?.length ? `Reason codes: ${input.reasonCodes.join(", ")}` : null,
        input.errorMessage ? `Error: ${input.errorMessage}` : null,
        `Legs: ${JSON.stringify(
          input.legs.map((l) => ({
            protocol: l.protocol,
            action: l.action,
            asset: l.asset,
            tokenIn: l.tokenIn,
            tokenOut: l.tokenOut,
          })),
        )}`,
        `Fill tx hashes (real only): ${JSON.stringify(fillHashes)}`,
        input.agentProposal
          ? `Agent thesis: ${input.agentProposal.thesis}`
          : "Agent thesis: (none)",
        input.agentProposal
          ? `Agent confidence: ${input.agentProposal.confidence}`
          : null,
        "",
        "Write the ticket summary JSON.",
      ]
        .filter(Boolean)
        .join("\n");

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const cfg: LLMProviderConfig = {
          ...picked.config,
          temperature,
        };
        const call =
          opts.callLlm ??
          ((p, c, pr, signal, sys) => LLM_PROVIDER_CALLERS[p](c, pr, signal, sys));
        const raw = await call(
          picked.provider,
          cfg,
          prompt,
          controller.signal,
          NARRATIVE_SYSTEM,
        );
        const json = extractJsonObject(raw);
        if (json) {
          const parsed = JSON.parse(json) as {
            summary?: string;
            editorialBody?: string;
          };
          if (typeof parsed.summary === "string" && parsed.summary.trim()) {
            return {
              summary: parsed.summary.trim().slice(0, 500),
              editorialBody:
                typeof parsed.editorialBody === "string"
                  ? parsed.editorialBody.trim().slice(0, 1200)
                  : undefined,
              provider: picked.provider,
              latencyMs: Date.now() - started,
              usedLlm: true,
            };
          }
        }
      } catch {
        // fall through to deterministic
      } finally {
        clearTimeout(timer);
      }

      return {
        summary: fallback,
        usedLlm: false,
        latencyMs: Date.now() - started,
      };
    },
  };
}
