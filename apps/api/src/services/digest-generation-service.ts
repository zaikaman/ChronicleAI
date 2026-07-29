// LLM-backed daily digest generator with Gemini → Groq → OpenAI fallback.
// Fails hard if every provider fails — no heuristic/template content path.
// Precomputes DigestStats and forces sectioned JSON output.

import {
  chainLabel,
  DIGEST_GENERATION_TIMEOUT_MS,
  LLM_FALLBACK_ORDER,
} from "@chronicleai/config";
import type { LLMGenerationAttemptRepository } from "@chronicleai/db";
import type { Confidence, DigestSections, FlowContext, LLMProvider } from "@chronicleai/schemas";
import { extractFlowContext } from "../monitoring/flow-enrichment.ts";
import {
  createChatModel,
  createChatModelsInOrder,
  digestContentSchema,
  invokeStructuredAgent,
} from "../agents/langchain/index.ts";
import {
  extractJsonObject,
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
  rawPayload?: Record<string, unknown> | null;
}

export interface DigestStats {
  netRiskOnUsd: number;
  netDeRiskUsd: number;
  cexInUsd: number;
  cexOutUsd: number;
  protocolInUsd: number;
  protocolOutUsd: number;
  mintUsd: number;
  burnUsd: number;
  liquidationUsd: number;
  liquidationCount: number;
  clusterCount: number;
  gasSpikes: number;
  swapCount: number;
  swapUsd: number;
  topEvents: DigestEventInput[];
}

export interface DigestContent {
  title: string;
  summary: string;
  highlights: string[];
  analysis?: string;
  sections?: DigestSections;
  sourceEventIds: string[];
  confidence: Confidence;
  /** LLM provider that produced the final digest content. */
  generationProvider?: LLMProvider;
  /** Precomputed stats (for logging / tests). */
  stats?: DigestStats;
}

export interface DigestGenerationParams {
  reportDate: string;
  periodStart: string;
  periodEnd: string;
  events: DigestEventInput[];
  /**
   * Optional desk execution routing mode for LLM context (Phase 2).
   * When desk trades use private mempool, set `private_mempool`.
   */
  executionRouting?: "private_mempool" | "public" | undefined;
}

export interface DigestProviderAttemptResult {
  provider: LLMProvider;
  success: boolean;
  latencyMs: number;
  failureReason?: string;
}

export class DigestGenerationError extends Error {
  readonly attempts: DigestProviderAttemptResult[];

  constructor(message: string, attempts: DigestProviderAttemptResult[] = []) {
    super(message);
    this.name = "DigestGenerationError";
    this.attempts = attempts;
  }
}

export interface DigestGenerationService {
  /** Generate digest content from selected events via multi-provider LLM. */
  generateDigest(params: DigestGenerationParams): Promise<DigestContent>;
}

const DIGEST_SYSTEM_INSTRUCTION =
  "You are ChronicleAI, an autonomous on-chain capital-flow intelligence desk. Write comprehensive public daily market intelligence digests from structured blockchain event data and precomputed stats. Be factual, clear, and useful. Never invent events, nets, or entity names not in the provided data.";

// ── Stats precompute ────────────────────────────────────

function magnitudeUsd(mag: Record<string, unknown> | null | undefined): number {
  if (!mag || typeof mag !== "object") return 0;
  const unit = mag.unit;
  const value = mag.value;
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  if (unit === "USD" || unit === undefined) return value;
  return 0;
}

function flowOf(event: DigestEventInput): FlowContext | null {
  return extractFlowContext(event.rawPayload ?? null);
}

/**
 * Precompute capital-flow aggregates in code — never invent nets in the LLM.
 */
export function computeDigestStats(events: DigestEventInput[]): DigestStats {
  const ranked = rankEvents(events);
  let netRiskOnUsd = 0;
  let netDeRiskUsd = 0;
  let cexInUsd = 0;
  let cexOutUsd = 0;
  let protocolInUsd = 0;
  let protocolOutUsd = 0;
  let mintUsd = 0;
  let burnUsd = 0;
  let liquidationUsd = 0;
  let liquidationCount = 0;
  let clusterCount = 0;
  let gasSpikes = 0;
  let swapCount = 0;
  let swapUsd = 0;

  for (const e of events) {
    const usd = magnitudeUsd(e.magnitude);
    const flow = flowOf(e);

    switch (e.eventType) {
      case "cex_inflow":
        cexInUsd += usd;
        break;
      case "cex_outflow":
        cexOutUsd += usd;
        break;
      case "protocol_deposit":
        protocolInUsd += usd;
        break;
      case "protocol_withdraw":
        protocolOutUsd += usd;
        break;
      case "stablecoin_mint":
        mintUsd += usd;
        break;
      case "stablecoin_burn":
        burnUsd += usd;
        break;
      case "liquidation":
        liquidationUsd += usd;
        liquidationCount += 1;
        break;
      case "liquidation_cluster":
        clusterCount += 1;
        liquidationUsd += usd;
        break;
      case "gas_spike":
        gasSpikes += 1;
        break;
      case "large_swap":
        swapCount += 1;
        swapUsd += usd;
        break;
      default:
        break;
    }

    if (flow?.direction === "risk_on") netRiskOnUsd += usd;
    if (flow?.direction === "de_risk") netDeRiskUsd += usd;
    if (e.eventType === "stablecoin_mint") {
      // supply_expand already in mintUsd; also count as not risk_on
    }
  }

  return {
    netRiskOnUsd,
    netDeRiskUsd,
    cexInUsd,
    cexOutUsd,
    protocolInUsd,
    protocolOutUsd,
    mintUsd,
    burnUsd,
    liquidationUsd,
    liquidationCount,
    clusterCount,
    gasSpikes,
    swapCount,
    swapUsd,
    topEvents: ranked.slice(0, 8),
  };
}

export function flattenSectionsToAnalysis(sections: DigestSections): string {
  const blocks: string[] = [];
  if (sections.capitalDirection?.trim()) {
    blocks.push(`## Capital direction\n\n${sections.capitalDirection.trim()}`);
  }
  if (sections.exchangeAndProtocolFlows?.trim()) {
    blocks.push(
      `## Exchange & protocol flows\n\n${sections.exchangeAndProtocolFlows.trim()}`,
    );
  }
  if (sections.stressBoard?.trim()) {
    blocks.push(`## Stress board\n\n${sections.stressBoard.trim()}`);
  }
  if (sections.storyOfTheDay?.trim()) {
    blocks.push(`## Story of the day\n\n${sections.storyOfTheDay.trim()}`);
  }
  if (sections.coverageNote?.trim()) {
    blocks.push(`## Coverage note\n\n${sections.coverageNote.trim()}`);
  }
  return blocks.join("\n\n");
}

export function parseSectionsFromAnalysis(analysis: string | null | undefined): DigestSections | null {
  if (!analysis?.trim()) return null;
  const headings: Array<{ key: keyof DigestSections; pattern: RegExp }> = [
    { key: "capitalDirection", pattern: /^##\s*Capital direction\s*$/im },
    {
      key: "exchangeAndProtocolFlows",
      pattern: /^##\s*Exchange\s*(&|and)\s*protocol flows\s*$/im,
    },
    { key: "stressBoard", pattern: /^##\s*Stress board\s*$/im },
    { key: "storyOfTheDay", pattern: /^##\s*Story of the day\s*$/im },
    { key: "coverageNote", pattern: /^##\s*Coverage note\s*$/im },
  ];

  const found: Array<{ key: keyof DigestSections; index: number; matchLen: number }> = [];
  for (const h of headings) {
    const m = h.pattern.exec(analysis);
    if (m && m.index !== undefined) {
      found.push({ key: h.key, index: m.index, matchLen: m[0].length });
    }
  }
  if (found.length < 2) return null;
  found.sort((a, b) => a.index - b.index);

  const sections: Partial<DigestSections> = {};
  for (let i = 0; i < found.length; i++) {
    const cur = found[i]!;
    const start = cur.index + cur.matchLen;
    const end = i + 1 < found.length ? found[i + 1]!.index : analysis.length;
    sections[cur.key] = analysis.slice(start, end).trim();
  }

  if (
    !sections.capitalDirection &&
    !sections.exchangeAndProtocolFlows &&
    !sections.stressBoard &&
    !sections.storyOfTheDay
  ) {
    return null;
  }

  return {
    capitalDirection: sections.capitalDirection ?? "No qualifying directional flow today.",
    exchangeAndProtocolFlows:
      sections.exchangeAndProtocolFlows ?? "No qualifying CEX or protocol flow today.",
    stressBoard: sections.stressBoard ?? "No material stress signals today.",
    storyOfTheDay: sections.storyOfTheDay ?? "Quiet day — no single multi-event narrative.",
    coverageNote: sections.coverageNote ?? "",
  };
}

// ── Prompt ──────────────────────────────────────────────

function formatEventLine(event: DigestEventInput, index: number): string {
  const parts: string[] = [
    `${index + 1}. id=${event.id}`,
    `type=${event.eventType}`,
    `chainId=${event.chainId}`,
    `network=${chainLabel(event.chainId)}`,
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
  const flow = flowOf(event);
  if (flow) {
    parts.push(`direction=${flow.direction}`);
    if (flow.fromLabel || flow.fromRole !== "unknown") {
      parts.push(`from=${flow.fromLabel ?? flow.fromRole}`);
    }
    if (flow.toLabel || flow.toRole !== "unknown") {
      parts.push(`to=${flow.toLabel ?? flow.toRole}`);
    }
    if (flow.venue) parts.push(`venue=${flow.venue}`);
  }
  if (event.transactionHash) parts.push(`tx=${event.transactionHash}`);
  if (event.significanceScore != null) {
    parts.push(`significance=${event.significanceScore.toFixed(2)}`);
  }
  parts.push(`capturedAt=${event.capturedAt}`);
  return parts.join(" | ");
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

function formatUsd(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "$0";
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

function buildDigestPrompt(params: DigestGenerationParams, stats: DigestStats): string {
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

  if (params.executionRouting) {
    lines.push(
      `execution_routing: ${params.executionRouting}`,
      params.executionRouting === "private_mempool"
        ? "(Desk trades in this window may use KeeperHub private submission path on Sepolia — do not claim mainnet MEV protection.)"
        : "(Desk executions use public mempool submission when applicable.)",
      "",
    );
  }

  lines.push(
    "DIGEST STATS (precomputed — use these numbers; do not invent nets):",
    `- netRiskOnUsd: ${stats.netRiskOnUsd} (${formatUsd(stats.netRiskOnUsd)})`,
    `- netDeRiskUsd: ${stats.netDeRiskUsd} (${formatUsd(stats.netDeRiskUsd)})`,
    `- cexInUsd: ${stats.cexInUsd} (${formatUsd(stats.cexInUsd)})`,
    `- cexOutUsd: ${stats.cexOutUsd} (${formatUsd(stats.cexOutUsd)})`,
    `- protocolInUsd: ${stats.protocolInUsd} (${formatUsd(stats.protocolInUsd)})`,
    `- protocolOutUsd: ${stats.protocolOutUsd} (${formatUsd(stats.protocolOutUsd)})`,
    `- mintUsd: ${stats.mintUsd} (${formatUsd(stats.mintUsd)})`,
    `- burnUsd: ${stats.burnUsd} (${formatUsd(stats.burnUsd)})`,
    `- liquidationUsd: ${stats.liquidationUsd} (${formatUsd(stats.liquidationUsd)})`,
    `- liquidationCount: ${stats.liquidationCount}`,
    `- clusterCount: ${stats.clusterCount}`,
    `- gasSpikes: ${stats.gasSpikes}`,
    `- swapCount: ${stats.swapCount}`,
    `- swapUsd: ${stats.swapUsd} (${formatUsd(stats.swapUsd)})`,
    "",
  );

  if (params.events.length === 0) {
    lines.push(
      "No qualifying on-chain events were selected for this window.",
      "Write a calm, professional quiet-day digest with empty-but-honest sections:",
      '- capitalDirection: "No qualifying directional flow today."',
      '- exchangeAndProtocolFlows: "No qualifying CEX or protocol flow today."',
      '- stressBoard: "No material stress signals today."',
      '- storyOfTheDay: "Quiet day — monitoring continued; no multi-event narrative."',
      "- coverageNote: note that thresholds filtered the tape.",
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
    "- analysis: longer interpretive section — prefer structured markdown with the five section headings below.",
    "- sections: REQUIRED object with all five keys (use honest empty-day copy when a bucket has no data).",
    "  - capitalDirection: net risk-on vs de-risk from stats + events",
    "  - exchangeAndProtocolFlows: CEX in/out + protocol deposit/withdraw",
    "  - stressBoard: liquidations, clusters, gas/volume",
    "  - storyOfTheDay: single multi-event narrative or quiet-day note",
    "  - coverageNote: what was filtered / coverage limits (builds trust)",
    "- title: include 'ChronicleAI Daily Digest' and the human-readable report date when natural.",
    "- confidence: 'high' when data is clear and multi-sourced, 'medium' when partial, 'low' when sparse.",
    "- Base every claim on DIGEST STATS and provided events. Never fabricate transactions, protocols, or nets.",
    "- Never invent entity names not present in event labels.",
    "- When naming a chain, use the provided network= label for that event only.",
    "",
    "Respond ONLY with JSON (no markdown fences) using this shape:",
    JSON.stringify({
      title: "ChronicleAI Daily Digest — …",
      summary: "…",
      highlights: ["…", "…"],
      analysis: "…",
      sections: {
        capitalDirection: "…",
        exchangeAndProtocolFlows: "…",
        stressBoard: "…",
        storyOfTheDay: "…",
        coverageNote: "…",
      },
      confidence: "high|medium|low",
    }),
  );

  return lines.join("\n");
}

// ── Validation ──────────────────────────────────────────

function parseSections(raw: unknown): DigestSections | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  const keys = [
    "capitalDirection",
    "exchangeAndProtocolFlows",
    "stressBoard",
    "storyOfTheDay",
    "coverageNote",
  ] as const;
  const out: Partial<DigestSections> = {};
  for (const k of keys) {
    if (typeof s[k] === "string" && s[k].trim().length > 0) {
      out[k] = String(s[k]).trim().slice(0, 4000);
    }
  }
  // Require at least 3 sections to accept
  const filled = keys.filter((k) => out[k]).length;
  if (filled < 3) return null;
  return {
    capitalDirection: out.capitalDirection ?? "No qualifying directional flow today.",
    exchangeAndProtocolFlows:
      out.exchangeAndProtocolFlows ?? "No qualifying CEX or protocol flow today.",
    stressBoard: out.stressBoard ?? "No material stress signals today.",
    storyOfTheDay: out.storyOfTheDay ?? "Quiet day — no single multi-event narrative.",
    coverageNote: out.coverageNote ?? "",
  };
}

function validateDigestResponse(
  raw: string,
  params: DigestGenerationParams,
  stats: DigestStats,
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

    let sections = parseSections(parsed.sections);
    let analysis =
      typeof parsed.analysis === "string" && parsed.analysis.trim().length > 0
        ? parsed.analysis.trim().slice(0, 8000)
        : undefined;

    // Prefer structured sections; flatten into analysis for backward-compatible UI
    if (sections) {
      const flattened = flattenSectionsToAnalysis(sections);
      analysis = analysis && analysis.includes("## Capital direction")
        ? analysis
        : flattened;
    } else if (analysis) {
      sections = parseSectionsFromAnalysis(analysis);
    }

    return {
      title: String(parsed.title).trim().slice(0, 200),
      summary: String(parsed.summary).trim().slice(0, 2000),
      highlights,
      ...(analysis !== undefined ? { analysis } : {}),
      ...(sections ? { sections } : {}),
      sourceEventIds: params.events.map((e) => e.id),
      confidence: confidence as Confidence,
      stats,
    };
  } catch {
    return null;
  }
}

// ── LLM attempt logging helpers ─────────────────────────

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
  providerConfigs: LLMProviderMap,
  llmAttemptRepo?: LLMGenerationAttemptRepository | null,
): DigestGenerationService {
  const repo = llmAttemptRepo ?? null;

  return {
    async generateDigest(params) {
      const ranked = rankEvents(params.events);
      const logEventId = ranked[0]?.id ?? null;
      const stats = computeDigestStats(params.events);
      const prompt = buildDigestPrompt(params, stats);
      const attempts: DigestProviderAttemptResult[] = [];
      const models = createChatModelsInOrder(providerConfigs, LLM_FALLBACK_ORDER);

      for (let i = 0; i < models.length; i++) {
        const { provider, model } = models[i]!;
        const attemptOrder = i + 1;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), DIGEST_GENERATION_TIMEOUT_MS);
        const startTime = Date.now();

        try {
          const agentResult = await invokeStructuredAgent({
            model,
            systemPrompt: DIGEST_SYSTEM_INSTRUCTION,
            userPrompt: prompt,
            responseFormat: digestContentSchema,
            provider,
            signal: controller?.signal,
            runLimit: 1,
          });
          const latencyMs = Date.now() - startTime;
          if (timeoutId) clearTimeout(timeoutId);

          const content =
            validateDigestResponse(JSON.stringify(agentResult.structured), params, stats) ??
            validateDigestResponse(agentResult.rawText, params, stats);

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
                hasSections: Boolean(content.sections),
                stats: {
                  netRiskOnUsd: stats.netRiskOnUsd,
                  netDeRiskUsd: stats.netDeRiskUsd,
                  cexInUsd: stats.cexInUsd,
                  cexOutUsd: stats.cexOutUsd,
                  liquidationCount: stats.liquidationCount,
                },
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

      const attemptSummary = attempts
        .map((a) => `${a.provider}: ${a.failureReason ?? "unknown"}`)
        .join("; ");

      console.error("[digest-generation] All LLM providers failed", {
        attempts: attempts.map((a) => ({
          provider: a.provider,
          reason: a.failureReason,
          latencyMs: a.latencyMs,
        })),
        eventCount: params.events.length,
        reportDate: params.reportDate,
      });

      throw new DigestGenerationError(
        `Digest generation failed: all LLM providers failed (${attemptSummary})`,
        attempts,
      );
    },
  };
}

/** Exported for unit tests. */
export function buildDigestPromptForTest(
  params: DigestGenerationParams,
  stats?: DigestStats,
): string {
  return buildDigestPrompt(params, stats ?? computeDigestStats(params.events));
}
