// LLM-backed daily digest generator with Gemini → OpenAI → Groq fallback.
// Falls back to deterministic template ranking only if every provider fails
// (so the scheduled digest pipeline remains resilient).

import {
  DIGEST_GENERATION_TIMEOUT_MS,
  LLM_FALLBACK_ORDER,
} from "@chronicleai/config";
import type { LLMGenerationAttemptRepository } from "@chronicleai/db";
import type { Confidence, LLMProvider } from "@chronicleai/schemas";
import {
  extractJsonObject,
  LLM_PROVIDER_CALLERS,
  type LLMProviderMap,
} from "./llm-provider-client.ts";

// ── Types ───────────────────────────────────────────────

export interface DigestEventInput {
  id: string;
  eventType: string;
  chainId: number;
  protocol: string | null;
  assetSymbols: string[] | null;
  magnitude: Record<string, unknown> | null;
  transactionHash: string | null;
  significanceScore: number | null;
  capturedAt: string;
}

export interface DigestContent {
  title: string;
  summary: string;
  highlights: string[];
  analysis?: string;
  sourceEventIds: string[];
  confidence: Confidence;
  /** Which path produced the content: LLM provider name or heuristic template. */
  generationProvider?: LLMProvider | "template";
}

export interface DigestGenerationParams {
  reportDate: string;
  periodStart: string;
  periodEnd: string;
  events: DigestEventInput[];
}

export interface DigestProviderAttemptResult {
  provider: LLMProvider;
  success: boolean;
  latencyMs: number;
  failureReason?: string;
}

export interface DigestGenerationService {
  /** Generate digest content from selected events via multi-provider LLM. */
  generateDigest(params: DigestGenerationParams): Promise<DigestContent>;
}

const DIGEST_SYSTEM_INSTRUCTION =
  "You are ChronicleAI, an autonomous on-chain intelligence desk. Write comprehensive public daily market intelligence digests from structured blockchain event data. Be factual, clear, and useful to a general crypto audience. Never invent events that are not in the provided data.";

// ── Prompt ──────────────────────────────────────────────

function formatEventLine(event: DigestEventInput, index: number): string {
  const parts: string[] = [
    `${index + 1}. id=${event.id}`,
    `type=${event.eventType}`,
    `chainId=${event.chainId}`,
  ];
  if (event.protocol) parts.push(`protocol=${event.protocol}`);
  if (event.assetSymbols?.length) parts.push(`assets=${event.assetSymbols.join("/")}`);
  if (event.magnitude) {
    const mag = event.magnitude;
    if (typeof mag.value === "number" && typeof mag.unit === "string") {
      parts.push(`magnitude=${mag.value} ${mag.unit}`);
    } else {
      parts.push(`magnitude=${JSON.stringify(mag)}`);
    }
  }
  if (event.transactionHash) parts.push(`tx=${event.transactionHash}`);
  if (event.significanceScore != null) {
    parts.push(`significance=${event.significanceScore.toFixed(2)}`);
  }
  parts.push(`capturedAt=${event.capturedAt}`);
  return parts.join(" | ");
}

function buildDigestPrompt(params: DigestGenerationParams): string {
  const formattedDate = formatReportDate(params.reportDate);
  const periodStartDate = params.periodStart.slice(0, 10);
  const periodEndDate = params.periodEnd.slice(0, 10);

  const lines = [
    "Generate ChronicleAI's public daily market intelligence digest for the reporting window below.",
    "",
    `Report date: ${formattedDate} (${params.reportDate})`,
    `Period start (ISO): ${params.periodStart}`,
    `Period end (ISO): ${params.periodEnd}`,
    `Period labels: ${periodStartDate} to ${periodEndDate}`,
    `Qualified event count: ${params.events.length}`,
    "",
  ];

  if (params.events.length === 0) {
    lines.push(
      "No qualifying on-chain events were selected for this window.",
      "Write a calm, professional no-major-events digest: state that monitoring continued, no thresholds were crossed, and markets appear orderly.",
      "",
    );
  } else {
    lines.push("QUALIFIED EVENTS (use only these; do not invent others):");
    const ranked = rankEvents(params.events);
    for (let i = 0; i < ranked.length; i++) {
      lines.push(formatEventLine(ranked[i]!, i));
    }
    lines.push("");
  }

  lines.push(
    "IMPORTANT RULES:",
    "- Audience is PUBLIC. No premium-only deep dives, trading advice, or private data.",
    "- summary: 2–4 plain-language sentences covering the period (facts first).",
    "- highlights: 3–7 bullet strings, ranked by importance; each bullet is one concrete takeaway.",
    "- analysis: longer interpretive section (2–4 short paragraphs) separating interpretation from pure facts.",
    "- title: include 'ChronicleAI Daily Digest' and the human-readable report date when natural.",
    "- confidence: 'high' when data is clear and multi-sourced, 'medium' when partial, 'low' when sparse/speculative.",
    "- Base every claim on the provided events or the absence of events. Never fabricate transactions or protocols.",
    "",
    "Respond ONLY with JSON (no markdown fences) using this shape:",
    JSON.stringify({
      title: "ChronicleAI Daily Digest — …",
      summary: "…",
      highlights: ["…", "…"],
      analysis: "…",
      confidence: "high|medium|low",
    }),
  );

  return lines.join("\n");
}

// ── Validation ──────────────────────────────────────────

function validateDigestResponse(
  raw: string,
  params: DigestGenerationParams,
): DigestContent | null {
  try {
    const jsonStr = extractJsonObject(raw) ?? raw;
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;

    if (
      typeof parsed.title !== "string" ||
      typeof parsed.summary !== "string" ||
      !Array.isArray(parsed.highlights) ||
      typeof parsed.confidence !== "string"
    ) {
      return null;
    }

    const confidence = parsed.confidence;
    if (!["high", "medium", "low"].includes(confidence)) {
      return null;
    }

    const highlights = parsed.highlights
      .filter((h): h is string => typeof h === "string" && h.trim().length > 0)
      .map((h) => h.trim().slice(0, 500))
      .slice(0, 10);

    if (highlights.length === 0) {
      return null;
    }

    const analysis =
      typeof parsed.analysis === "string" && parsed.analysis.trim().length > 0
        ? parsed.analysis.trim().slice(0, 8000)
        : undefined;

    return {
      title: String(parsed.title).trim().slice(0, 200),
      summary: String(parsed.summary).trim().slice(0, 2000),
      highlights,
      analysis,
      sourceEventIds: params.events.map((e) => e.id),
      confidence: confidence as Confidence,
    };
  } catch {
    return null;
  }
}

// ── Heuristic template fallback ─────────────────────────

function formatEventSummary(event: DigestEventInput): string {
  const parts: string[] = [event.eventType.replace(/_/g, " ")];
  if (event.protocol) parts.push(`on ${event.protocol}`);
  if (event.assetSymbols?.length) parts.push(`(${event.assetSymbols.join("/")})`);
  if (event.magnitude) {
    const mag = event.magnitude;
    if (typeof mag.value === "number" && typeof mag.unit === "string") {
      parts.push(`${mag.value.toLocaleString()} ${mag.unit}`);
    }
  }
  return parts.join(" ");
}

function rankEvents(events: DigestEventInput[]): DigestEventInput[] {
  return [...events].sort(
    (a, b) => (b.significanceScore ?? 0) - (a.significanceScore ?? 0),
  );
}

function formatReportDate(reportDate: string): string {
  return new Date(reportDate).toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function generateTemplateDigest(params: DigestGenerationParams): DigestContent {
  const { events, reportDate } = params;
  const formattedDate = formatReportDate(reportDate);

  if (events.length === 0) {
    return {
      title: `ChronicleAI Daily Digest — ${formattedDate}`,
      summary: `No significant on-chain events were detected during the reporting period ending ${formattedDate}. Normal monitoring operations continue.`,
      highlights: ["No major events detected during this reporting period."],
      analysis:
        "The absence of significant on-chain activity during this period suggests normal market conditions with no anomalous trade, liquidation, gas, or deployment events crossing configured thresholds.",
      sourceEventIds: [],
      confidence: "high",
      generationProvider: "template",
    };
  }

  const ranked = rankEvents(events);
  const topEvent = ranked[0];

  const highlights = ranked.slice(0, 5).map((event, i) => {
    const summary = formatEventSummary(event);
    const score = event.significanceScore
      ? ` (significance: ${(event.significanceScore * 100).toFixed(0)}%)`
      : "";
    return `${i + 1}. ${summary}${score}`;
  });

  const topEventSummary = topEvent ? formatEventSummary(topEvent) : "no significant events";
  const summary = `Over the reporting period ending ${formattedDate}, ChronicleAI monitored ${events.length} qualifying on-chain events. The most significant activity involved ${topEventSummary}.`;

  const analysisParts: string[] = [];
  analysisParts.push(
    `During this reporting period (${params.periodStart.slice(0, 10)} to ${params.periodEnd.slice(0, 10)}), ChronicleAI detected and qualified ${events.length} noteworthy on-chain events across ${new Set(events.map((e) => e.chainId)).size} chain(s).`,
  );

  const types = new Set(events.map((e) => e.eventType));
  if (types.size > 0) {
    analysisParts.push(
      `Event type distribution: ${[...types].map((t) => t.replace(/_/g, " ")).join(", ")}.`,
    );
  }

  const protocols = events.filter((e) => e.protocol).map((e) => e.protocol);
  if (protocols.length > 0) {
    const uniqueProtocols = [...new Set(protocols)];
    analysisParts.push(`Protocols involved: ${uniqueProtocols.join(", ")}.`);
  }

  const highestScore = Math.max(...events.map((e) => e.significanceScore ?? 0));
  if (highestScore > 0.8) {
    analysisParts.push(
      "The highest-significance event(s) exceeded 80% confidence, indicating strong signal quality.",
    );
  } else if (highestScore > 0.5) {
    analysisParts.push(
      "Event significance scores were moderate, suggesting notable but not extreme on-chain activity.",
    );
  }

  return {
    title: `ChronicleAI Daily Digest — ${formattedDate}`,
    summary,
    highlights,
    analysis: analysisParts.join("\n\n"),
    sourceEventIds: events.map((e) => e.id),
    confidence: events.length >= 3 ? "high" : "medium",
    generationProvider: "template",
  };
}

// ── LLM attempt logging helpers ─────────────────────────

/**
 * llm_generation_attempts.monitored_event_id is NOT NULL and FKs to monitored_events.
 * Digests span many events: log against the highest-significance source event when available.
 * entity_type is set to daily_digest; entity_id stays null until the digest row exists.
 */
async function recordDigestAttempt(
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
  if (!llmAttemptRepo || !params.monitoredEventId) {
    return;
  }

  await llmAttemptRepo.create({
    entity_type: "daily_digest",
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

// ── Factory ─────────────────────────────────────────────

export function createDigestGenerationService(
  providerConfigs?: LLMProviderMap,
  llmAttemptRepo?: LLMGenerationAttemptRepository | null,
): DigestGenerationService {
  const repo = llmAttemptRepo ?? null;

  return {
    async generateDigest(params) {
      // Without provider config (e.g. unit tests), use the deterministic template path.
      if (!providerConfigs) {
        return generateTemplateDigest(params);
      }

      const ranked = rankEvents(params.events);
      const logEventId = ranked[0]?.id ?? null;
      const prompt = buildDigestPrompt(params);
      const attempts: DigestProviderAttemptResult[] = [];

      for (const provider of LLM_FALLBACK_ORDER) {
        const config = providerConfigs[provider];
        const attemptOrder = LLM_FALLBACK_ORDER.indexOf(provider) + 1;

        if (!config.apiKey?.trim()) {
          attempts.push({
            provider,
            success: false,
            latencyMs: 0,
            failureReason: "API key not configured",
          });
          await recordDigestAttempt(repo, {
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
        const timeoutId = setTimeout(() => controller.abort(), DIGEST_GENERATION_TIMEOUT_MS);
        const startTime = Date.now();

        try {
          const raw = await LLM_PROVIDER_CALLERS[provider](
            config,
            prompt,
            controller.signal,
            DIGEST_SYSTEM_INSTRUCTION,
          );
          const latencyMs = Date.now() - startTime;
          clearTimeout(timeoutId);

          const content = validateDigestResponse(raw, params);

          if (content) {
            attempts.push({ provider, success: true, latencyMs });
            await recordDigestAttempt(repo, {
              monitoredEventId: logEventId,
              provider,
              attemptOrder,
              status: "succeeded",
              latencyMs,
              responseMetadata: {
                title: content.title,
                highlightCount: content.highlights.length,
                eventCount: params.events.length,
              },
            });

            return {
              ...content,
              generationProvider: provider,
            };
          }

          attempts.push({
            provider,
            success: false,
            latencyMs,
            failureReason: "Invalid response format from provider",
          });
          await recordDigestAttempt(repo, {
            monitoredEventId: logEventId,
            provider,
            attemptOrder,
            status: "invalid_response",
            latencyMs,
            failureReason:
              "Response did not contain valid JSON with title, summary, highlights, and confidence",
          });
        } catch (error) {
          clearTimeout(timeoutId);
          const latencyMs = Date.now() - startTime;
          const failureReason =
            error instanceof Error ? error.message : "Unknown provider error";

          attempts.push({
            provider,
            success: false,
            latencyMs,
            failureReason,
          });
          await recordDigestAttempt(repo, {
            monitoredEventId: logEventId,
            provider,
            attemptOrder,
            status: "failed",
            latencyMs,
            failureReason,
          });
        }
      }

      // All providers failed — ship a deterministic digest so the daily pipeline still runs.
      console.warn(
        "[digest-generation] All LLM providers failed; using template fallback",
        {
          attempts: attempts.map((a) => ({
            provider: a.provider,
            reason: a.failureReason,
            latencyMs: a.latencyMs,
          })),
          eventCount: params.events.length,
          reportDate: params.reportDate,
        },
      );

      return generateTemplateDigest(params);
    },
  };
}
