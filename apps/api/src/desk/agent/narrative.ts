/**
 * Post-trade CIO / ticket narrative (Role B).
 * LangChain structured agent — uses real legs/fills only, never invents tx hashes.
 */

import {
  DESK_AGENT_LLM_FALLBACK_ORDER,
  DESK_AGENT_NARRATIVE_TEMPERATURE,
  DESK_AGENT_TIMEOUT_MS,
} from "@chronicleai/config";
import type { LLMProvider } from "@chronicleai/schemas";
import {
  createChatModelsInOrder,
  invokeStructuredAgent,
  ticketNarrativeSchema,
} from "../../agents/langchain/index.ts";
import {
  extractJsonObject,
  type LLMProviderConfig,
  type LLMProviderMap,
} from "../../services/llm-provider-client.ts";
import type { DeskAgentProposal } from "./types.ts";
import type { DeskExecutionAuditV1 } from "../execution-audit.ts";
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
  /**
   * Optional Layer C audit spine. Deterministic fallback and LLM prompts
   * may only use provided facts — never invent stages, gas, or hashes.
   */
  executionAudit?: DeskExecutionAuditV1 | null | undefined;
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
  "- Use only the provided strategy, notional, legs, fills, agent thesis, and execution audit facts.",
  "- Never invent transaction hashes, gas figures, simulation results, prices, or protocols not listed.",
  "- When execution audit stages are provided, you may mention preflight → submit → outcome briefly; do not invent missing stages.",
  "- 1–3 sentences. Calm, editorial, proof-first tone.",
  '- Respond as JSON: { "summary": string, "editorialBody": string } (use "" when no editorial body)',
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

  const audit = input.executionAudit;
  if (audit?.stages) {
    const { preflight, submit, outcome } = audit.stages;
    const khSim = preflight.khSimulate;
    const khLegNote =
      khSim &&
      typeof khSim.legCount === "number" &&
      khSim.legCount > 1 &&
      typeof khSim.passedLegs === "number"
        ? ` ${khSim.passedLegs}/${khSim.legCount} legs`
        : "";
    const khNote =
      khSim && khSim.status
        ? ` · KH dry-run ${khSim.status}${khLegNote}${
            khSim.gasEstimate ? ` est ${khSim.gasEstimate}` : ""
          }`
        : "";
    const runNote = submit.keeperHubRunId
      ? `submit run ${submit.keeperHubRunId.slice(0, 12)}…`
      : `submit ${submit.status}`;
    const gasNote = outcome.gasUsed ? ` · ${outcome.gasUsed} gas` : "";
    const auditBeat = `preflight ${preflight.status}${khNote} → ${runNote} → outcome ${outcome.status}${gasNote}`;
    return `Desk ${input.strategy} ${status} · ${input.notionalUsdc} USDC · ${auditBeat}${fillNote}${err}`.slice(
      0,
      500,
    );
  }

  return `Desk ${input.strategy} ${status} · ${input.notionalUsdc} USDC · ${legSummary}${fillNote}${err}${thesisSnippet}`.slice(
    0,
    500,
  );
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

      const fillHashes = input.fills
        .map((f) => f.txHash)
        .filter((h): h is string => typeof h === "string" && h.length > 0);

      const audit = input.executionAudit;
      const auditLines = audit?.stages
        ? [
            `Execution audit summary: ${audit.summaryLine}`,
            `Preflight status: ${audit.stages.preflight.status}` +
              (audit.stages.preflight.policy
                ? ` (allow=${audit.stages.preflight.policy.allow}, gasRegime=${audit.stages.preflight.policy.gasRegime ?? "n/a"})`
                : "") +
              (audit.stages.preflight.khSimulate
                ? ` · KeeperHub dry-run status=${audit.stages.preflight.khSimulate.status}` +
                  (audit.stages.preflight.khSimulate.wouldRevert != null
                    ? ` wouldRevert=${audit.stages.preflight.khSimulate.wouldRevert}`
                    : "") +
                  (audit.stages.preflight.khSimulate.gasEstimate
                    ? ` gasEstimate=${audit.stages.preflight.khSimulate.gasEstimate}`
                    : "")
                : ""),
            `Submit status: ${audit.stages.submit.status}` +
              (audit.stages.submit.keeperHubRunId
                ? ` run=${audit.stages.submit.keeperHubRunId}`
                : ""),
            `Outcome status: ${audit.stages.outcome.status}` +
              (audit.stages.outcome.gasUsed
                ? ` gasUsed=${audit.stages.outcome.gasUsed}`
                : "") +
              (audit.stages.outcome.txHashes.length > 0
                ? ` txs=${JSON.stringify(audit.stages.outcome.txHashes)}`
                : ""),
          ]
        : ["Execution audit: (none — do not invent stages)"];

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
        ...auditLines,
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

      if (opts.callLlm) {
        const order: LLMProvider[] = opts.preferredProvider
          ? [opts.preferredProvider, ...DESK_AGENT_LLM_FALLBACK_ORDER]
          : [...DESK_AGENT_LLM_FALLBACK_ORDER];
        for (const provider of order) {
          const base = providerConfigs[provider];
          if (!base?.apiKey?.trim()) continue;
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeoutMs);
          try {
            const cfg: LLMProviderConfig = { ...base, temperature };
            const raw = await opts.callLlm(
              provider,
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
                  provider,
                  latencyMs: Date.now() - started,
                  usedLlm: true,
                };
              }
            }
          } catch {
            // next
          } finally {
            clearTimeout(timer);
          }
        }
        return {
          summary: fallback,
          usedLlm: false,
          latencyMs: Date.now() - started,
        };
      }

      const models = createChatModelsInOrder(
        providerConfigs,
        DESK_AGENT_LLM_FALLBACK_ORDER,
        {
          preferredProvider: opts.preferredProvider,
          temperature,
        },
      );

      for (const { provider, model } of models) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const result = await invokeStructuredAgent({
            model,
            systemPrompt: NARRATIVE_SYSTEM,
            userPrompt: prompt,
            responseFormat: ticketNarrativeSchema,
            provider,
            signal: controller.signal,
            runLimit: 1,
          });
          const summary = result.structured.summary;
          if (typeof summary === "string" && summary.trim()) {
            return {
              summary: summary.trim().slice(0, 500),
              editorialBody:
                typeof result.structured.editorialBody === "string"
                  ? result.structured.editorialBody.trim().slice(0, 1200)
                  : undefined,
              provider,
              latencyMs: Date.now() - started,
              usedLlm: true,
            };
          }
        } catch {
          // next
        } finally {
          clearTimeout(timer);
        }
      }

      return {
        summary: fallback,
        usedLlm: false,
        latencyMs: Date.now() - started,
      };
    },
  };
}
