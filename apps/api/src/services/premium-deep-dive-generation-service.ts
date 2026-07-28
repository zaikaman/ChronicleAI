// LLM-backed premium deep-dive / historical narrative generation.
// Same provider fallback as alerts/digests: Gemini → Groq → OpenAI.
// Grounded only in provided monitored events — never invents txs/protocols.

import {
  LLM_FALLBACK_ORDER,
  PREMIUM_GENERATION_TIMEOUT_MS,
  chainLabel,
} from "@chronicleai/config";
import type { LLMGenerationAttemptRepository, MonitoredEventRow } from "@chronicleai/db";
import type { Confidence, LLMProvider } from "@chronicleai/schemas";
import {
  createChatModel,
  invokeStructuredAgent,
  premiumNarrativeSchema,
} from "../agents/langchain/index.ts";
import {
  extractJsonObject,
  type LLMProviderMap,
} from "./llm-provider-client.ts";

export type PremiumDeepDiveKind = "cluster" | "cascade" | "digest" | "historical";

export interface PremiumLlmSection {
  title: string;
  body?: string;
  findings?: string[];
}

export interface PremiumLlmNarrative {
  summaryPublic: string;
  sections: PremiumLlmSection[];
  analysis: string;
  confidence: Confidence;
  generationProvider: LLMProvider | "deterministic_fallback";
  usedLlm: boolean;
}

export interface PremiumDeepDiveGenerationParams {
  kind: PremiumDeepDiveKind;
  label: string;
  events: MonitoredEventRow[];
  digestSummary?: string | null;
  digestHighlights?: string[];
  digestAnalysis?: string | null;
  /** Used for historical lookback framing. */
  lookbackDays?: number;
  /** Deterministic teaser used if the model omits summaryPublic. */
  defaultSummaryPublic: string;
  /** Deterministic sections/analysis used if all LLM providers fail. */
  fallback: {
    sections: PremiumLlmSection[];
    analysis: string;
  };
}

export interface PremiumDeepDiveGenerationService {
  generateNarrative(params: PremiumDeepDiveGenerationParams): Promise<PremiumLlmNarrative>;
}

const SYSTEM_INSTRUCTION =
  "You are ChronicleAI's premium intelligence desk. Write paid-tier on-chain research that is clearly deeper than free public alerts. Be precise, sourced to the provided events, and useful to serious market readers and automated clients. Never invent transactions, protocols, or magnitudes not present in the data.";

function magnitudeLine(event: MonitoredEventRow): string {
  const mag = event.magnitude;
  if (!mag || typeof mag !== "object") return "n/a";
  const value = (mag as { value?: unknown }).value;
  const unit = (mag as { unit?: unknown }).unit;
  if (typeof value === "number" && typeof unit === "string") return `${value} ${unit}`;
  return JSON.stringify(mag);
}

function formatEventForPrompt(event: MonitoredEventRow, index: number): string {
  const parts = [
    `${index + 1}. id=${event.id}`,
    `type=${event.event_type}`,
    `network=${chainLabel(event.chain_id)}`,
    `chainId=${event.chain_id}`,
  ];
  if (event.protocol) parts.push(`protocol=${event.protocol}`);
  if (event.asset_symbols?.length) parts.push(`assets=${event.asset_symbols.join("/")}`);
  parts.push(`magnitude=${magnitudeLine(event)}`);
  if (event.transaction_hash) parts.push(`tx=${event.transaction_hash}`);
  if (event.significance_score != null) {
    parts.push(`significance=${event.significance_score.toFixed(2)}`);
  }
  parts.push(`capturedAt=${event.captured_at}`);
  return parts.join(" | ");
}

function rankEvents(events: MonitoredEventRow[]): MonitoredEventRow[] {
  return [...events].sort((a, b) => {
    const scoreDiff = (b.significance_score ?? 0) - (a.significance_score ?? 0);
    if (scoreDiff !== 0) return scoreDiff;
    return b.captured_at.localeCompare(a.captured_at);
  });
}

function buildPrompt(params: PremiumDeepDiveGenerationParams): string {
  const ranked = rankEvents(params.events).slice(0, 40);
  const kindLabel =
    params.kind === "cascade"
      ? "liquidation cascade deep dive"
      : params.kind === "cluster"
        ? "multi-event cluster deep dive"
        : params.kind === "historical"
          ? "multi-day historical protocol intelligence report"
          : "daily-period premium deep dive (beyond the free public digest)";

  const lines = [
    `Write a PAID ${kindLabel} for ChronicleAI premium subscribers.`,
    "",
    `Subject label: ${params.label}`,
    `Event count: ${params.events.length}`,
    params.lookbackDays != null ? `Lookback days: ${params.lookbackDays}` : null,
    "",
    "SOURCE EVENTS (use only these; do not invent others):",
  ].filter((l): l is string => l != null);

  for (let i = 0; i < ranked.length; i++) {
    lines.push(formatEventForPrompt(ranked[i]!, i));
  }
  if (params.events.length > ranked.length) {
    lines.push(
      `… and ${params.events.length - ranked.length} additional events not listed (same source set).`,
    );
  }

  if (params.digestSummary) {
    lines.push("", "PUBLIC DIGEST CONTEXT (shallower free content — expand beyond this):");
    lines.push(`summary: ${params.digestSummary}`);
    if (params.digestHighlights?.length) {
      lines.push(`highlights: ${params.digestHighlights.slice(0, 8).join(" | ")}`);
    }
    if (params.digestAnalysis) {
      lines.push(`public analysis: ${params.digestAnalysis}`);
    }
  }

  lines.push(
    "",
    "IMPORTANT RULES:",
    "- This content is PREMIUM (paid). Go deeper than public alerts: multi-event structure, composition, risk framing, ranked findings, scenario implications.",
    "- Do NOT invent events, txs, protocols, or numbers. If data is thin, say so and lower confidence.",
    "- summaryPublic is a TEASER for the unpaid catalog card: hook the buyer without dumping the full private analysis.",
    "- sections: 3–6 sections with title + body and/or findings[]. Include an Executive Summary section.",
    "- analysis: longer interpretive essay (2–5 short paragraphs) clearly labeled as interpretation.",
    "- confidence: high | medium | low based on data density and clarity.",
    "- When naming a chain, use the provided network= labels only.",
    "",
    "Respond ONLY with JSON (no markdown fences) using this shape:",
    JSON.stringify({
      summaryPublic: "Short public teaser (1–3 sentences)…",
      sections: [
        { title: "Executive Summary", body: "…" },
        { title: "Key Findings", findings: ["…", "…"] },
        { title: "Risk / Structure Notes", body: "…" },
      ],
      analysis: "Longer premium interpretation…",
      confidence: "high|medium|low",
    }),
  );

  return lines.join("\n");
}

function validateNarrative(
  raw: string,
  params: PremiumDeepDiveGenerationParams,
): Omit<PremiumLlmNarrative, "generationProvider" | "usedLlm"> | null {
  try {
    const jsonStr = extractJsonObject(raw) ?? raw;
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;

    if (!Array.isArray(parsed.sections) || typeof parsed.analysis !== "string") {
      return null;
    }

    const confidenceRaw = parsed.confidence;
    const confidence: Confidence =
      confidenceRaw === "high" || confidenceRaw === "medium" || confidenceRaw === "low"
        ? confidenceRaw
        : "medium";

    const sections: PremiumLlmSection[] = [];
    for (const item of parsed.sections.slice(0, 8)) {
      if (!item || typeof item !== "object") continue;
      const section = item as Record<string, unknown>;
      if (typeof section.title !== "string" || !section.title.trim()) continue;
      const next: PremiumLlmSection = { title: section.title.trim().slice(0, 120) };
      if (typeof section.body === "string" && section.body.trim()) {
        next.body = section.body.trim().slice(0, 4000);
      }
      if (Array.isArray(section.findings)) {
        const findings = section.findings
          .filter((f): f is string => typeof f === "string" && f.trim().length > 0)
          .map((f) => f.trim().slice(0, 500))
          .slice(0, 12);
        if (findings.length > 0) next.findings = findings;
      }
      if (next.body || next.findings?.length) {
        sections.push(next);
      }
    }

    if (sections.length === 0) return null;

    const analysis = parsed.analysis.trim().slice(0, 8000);
    if (!analysis) return null;

    const summaryPublic =
      typeof parsed.summaryPublic === "string" && parsed.summaryPublic.trim().length > 0
        ? parsed.summaryPublic.trim().slice(0, 600)
        : params.defaultSummaryPublic;

    return { summaryPublic, sections, analysis, confidence };
  } catch {
    return null;
  }
}

async function recordAttempt(
  llmAttemptRepo: LLMGenerationAttemptRepository | null,
  params: {
    monitoredEventId: string | null;
    provider: LLMProvider;
    attemptOrder: number;
    status: "succeeded" | "failed" | "invalid_response";
    latencyMs: number;
    failureReason?: string;
    responseMetadata?: Record<string, unknown>;
  },
): Promise<void> {
  if (!llmAttemptRepo || !params.monitoredEventId) return;

  // Non-fatal: attempt audit must never block premium minting.
  await llmAttemptRepo.create({
    entity_type: "premium_intelligence_item",
    entity_id: null,
    monitored_event_id: params.monitoredEventId,
    provider: params.provider,
    attempt_order: params.attemptOrder,
    status: params.status,
    latency_ms: params.latencyMs,
    failure_reason: params.failureReason ?? null,
    response_metadata: params.responseMetadata ?? null,
  });
}

export function createPremiumDeepDiveGenerationService(
  providerConfigs: LLMProviderMap | null | undefined,
  llmAttemptRepo?: LLMGenerationAttemptRepository | null,
): PremiumDeepDiveGenerationService {
  const repo = llmAttemptRepo ?? null;
  const configs = providerConfigs ?? null;

  return {
    async generateNarrative(params) {
      const ranked = rankEvents(params.events);
      const logEventId = ranked[0]?.id ?? null;

      if (!configs) {
        return {
          summaryPublic: params.defaultSummaryPublic,
          sections: params.fallback.sections,
          analysis: params.fallback.analysis,
          confidence: "medium",
          generationProvider: "deterministic_fallback",
          usedLlm: false,
        };
      }

      const prompt = buildPrompt(params);

      for (const provider of LLM_FALLBACK_ORDER) {
        const config = configs[provider];
        const attemptOrder = LLM_FALLBACK_ORDER.indexOf(provider) + 1;

        if (!config?.apiKey?.trim()) {
          await recordAttempt(repo, {
            monitoredEventId: logEventId,
            provider,
            attemptOrder,
            status: "failed",
            latencyMs: 0,
            failureReason: "API key not configured",
          });
          continue;
        }

        const model = createChatModel(provider, config);
        if (!model) {
          await recordAttempt(repo, {
            monitoredEventId: logEventId,
            provider,
            attemptOrder,
            status: "failed",
            latencyMs: 0,
            failureReason: "API key not configured",
          });
          continue;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), PREMIUM_GENERATION_TIMEOUT_MS);
        const startTime = Date.now();

        try {
          const agentResult = await invokeStructuredAgent({
            model,
            systemPrompt: SYSTEM_INSTRUCTION,
            userPrompt: prompt,
            responseFormat: premiumNarrativeSchema,
            provider,
            signal: controller?.signal,
            runLimit: 1,
          });
          const latencyMs = Date.now() - startTime;
          if (timeoutId) clearTimeout(timeoutId);

          const content =
            validateNarrative(JSON.stringify(agentResult.structured), params) ??
            validateNarrative(agentResult.rawText, params);
          if (content) {
            await recordAttempt(repo, {
              monitoredEventId: logEventId,
              provider,
              attemptOrder,
              status: "succeeded",
              latencyMs,
              responseMetadata: {
                kind: params.kind,
                label: params.label,
                eventCount: params.events.length,
                sectionCount: content.sections.length,
              },
            });
            return {
              ...content,
              generationProvider: provider,
              usedLlm: true,
            };
          }

          await recordAttempt(repo, {
            monitoredEventId: logEventId,
            provider,
            attemptOrder,
            status: "invalid_response",
            latencyMs,
            failureReason: "Invalid response format from provider",
          });
        } catch (error) {
          clearTimeout(timeoutId);
          const latencyMs = Date.now() - startTime;
          const reason =
            error instanceof Error
              ? error.name === "AbortError"
                ? "Provider timeout"
                : error.message
              : String(error);
          await recordAttempt(repo, {
            monitoredEventId: logEventId,
            provider,
            attemptOrder,
            status: "failed",
            latencyMs,
            failureReason: reason,
          });
        }
      }

      console.warn(
        `[premium-deep-dive] All LLM providers failed for kind=${params.kind} label=${params.label}; using deterministic fallback`,
      );

      return {
        summaryPublic: params.defaultSummaryPublic,
        sections: params.fallback.sections,
        analysis: params.fallback.analysis,
        confidence: "medium",
        generationProvider: "deterministic_fallback",
        usedLlm: false,
      };
    },
  };
}
