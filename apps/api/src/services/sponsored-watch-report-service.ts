// Sponsored watch report generator
// Builds a campaign-end intelligence report from events observed on the
// target contract during the paid monitoring window (Loop 4 step 4).
// Prefers multi-provider LLM narrative when keys are configured; falls back
// to a deterministic template so on-chain hashing always succeeds.

import { getAddress, isAddress, keccak256, stringToBytes } from "viem";
import type { MonitoredEventRow } from "@chronicleai/db";
import { ALERT_GENERATION_TIMEOUT_MS, LLM_FALLBACK_ORDER } from "@chronicleai/config";
import {
  extractJsonObject,
  LLM_PROVIDER_CALLERS,
  type LLMProviderMap,
} from "./llm-provider-client.ts";

export interface SponsoredWatchReportContent {
  title: string;
  summary: string;
  highlights: string[];
  analysis: string;
  sourceEventIds: string[];
  /** Deterministic commitment over source event ids (empty-root when none). */
  sourceEventRoot: string;
  /** keccak256 of the canonical report body used as on-chain reportContentHash. */
  reportContentHash: string;
  confidence: "high" | "medium" | "low";
  /** Which path produced the narrative (template always available as fallback). */
  generationSource?: "llm" | "template";
  generationProvider?: string;
}

export interface SponsoredWatchReportInput {
  watchId: string;
  targetContract: string;
  watchSpecHash: string;
  startsAt: string;
  endsAt: string;
  events: MonitoredEventRow[];
  eventSignature?: string | null;
  description?: string | null;
  /**
   * When live re-query returns 0 rows but the campaign previously correlated
   * N observations (e.g. synthetic RPC ids never persisted), keep that count
   * so the template does not falsely claim an empty campaign.
   */
  priorMonitoredCount?: number;
  priorSourceEventIdCount?: number;
}

export interface SponsoredWatchReportService {
  generateReport(input: SponsoredWatchReportInput): Promise<SponsoredWatchReportContent>;
}

function formatEventLine(event: MonitoredEventRow): string {
  const parts: string[] = [event.event_type.replace(/_/g, " ")];
  if (event.protocol) parts.push(`on ${event.protocol}`);
  if (event.asset_symbols?.length) parts.push(`(${event.asset_symbols.join("/")})`);
  if (event.magnitude && typeof event.magnitude === "object") {
    const mag = event.magnitude as Record<string, unknown>;
    if (typeof mag.value === "number" && typeof mag.unit === "string") {
      parts.push(`${mag.value.toLocaleString()} ${mag.unit}`);
    }
  }
  if (event.transaction_hash) {
    parts.push(`tx ${event.transaction_hash.slice(0, 10)}…`);
  }
  return parts.join(" ");
}

/**
 * Build a stable source-event root commitment.
 * Sorted event ids joined, then keccak256 — same family as digest roots
 * (string commitment hashed again by the web3 client before the bytes32 write).
 */
export function buildSourceEventRoot(sourceEventIds: string[]): string {
  if (sourceEventIds.length === 0) {
    return keccak256(stringToBytes("empty-sponsored-watch-root"));
  }
  const sorted = [...sourceEventIds].sort();
  return keccak256(stringToBytes(sorted.join(",")));
}

function buildReportContentHash(body: {
  title: string;
  summary: string;
  highlights: string[];
  analysis: string;
  sourceEventIds: string[];
  sourceEventRoot: string;
  targetContract: string;
  startsAt: string;
  endsAt: string;
}): string {
  const canonical = JSON.stringify({
    analysis: body.analysis,
    endsAt: body.endsAt,
    highlights: body.highlights,
    sourceEventIds: [...body.sourceEventIds].sort(),
    sourceEventRoot: body.sourceEventRoot,
    startsAt: body.startsAt,
    summary: body.summary,
    targetContract: body.targetContract.toLowerCase(),
    title: body.title,
  });
  return keccak256(stringToBytes(canonical));
}

function finalizeReport(
  narrative: {
    title: string;
    summary: string;
    highlights: string[];
    analysis: string;
    confidence: "high" | "medium" | "low";
  },
  meta: {
    sourceEventIds: string[];
    sourceEventRoot: string;
    targetContract: string;
    startsAt: string;
    endsAt: string;
    generationSource: "llm" | "template";
    generationProvider?: string;
  },
): SponsoredWatchReportContent {
  return {
    ...narrative,
    sourceEventIds: meta.sourceEventIds,
    sourceEventRoot: meta.sourceEventRoot,
    reportContentHash: buildReportContentHash({
      title: narrative.title,
      summary: narrative.summary,
      highlights: narrative.highlights,
      analysis: narrative.analysis,
      sourceEventIds: meta.sourceEventIds,
      sourceEventRoot: meta.sourceEventRoot,
      targetContract: meta.targetContract,
      startsAt: meta.startsAt,
      endsAt: meta.endsAt,
    }),
    generationSource: meta.generationSource,
    ...(meta.generationProvider ? { generationProvider: meta.generationProvider } : {}),
  };
}

function buildTemplateReport(input: SponsoredWatchReportInput): SponsoredWatchReportContent {
  const { events, targetContract, startsAt, endsAt, watchId } = input;
  const sourceEventIds = events.map((e) => e.id);
  const sourceEventRoot = buildSourceEventRoot(sourceEventIds);

  const windowLabel = `${new Date(startsAt).toISOString().slice(0, 10)} → ${new Date(endsAt).toISOString().slice(0, 10)}`;
  const shortTarget = `${targetContract.slice(0, 8)}…${targetContract.slice(-6)}`;

  if (events.length === 0) {
    const title = `Sponsored Watch Report — ${shortTarget}`;
    const priorCount = Math.max(
      input.priorMonitoredCount ?? 0,
      input.priorSourceEventIdCount ?? 0,
    );

    // Campaign ticks previously correlated observations, but rows are gone
    // (synthetic RPC UUIDs never written to monitored_events, or retention).
    if (priorCount > 0) {
      const summary =
        `Campaign monitoring correlated ${priorCount} observation(s) on ${targetContract} ` +
        `during ${windowLabel}. The live event store no longer holds those rows ` +
        `(common when an earlier RPC fallback used ephemeral ids), so this report ` +
        `reconstructs from the campaign audit trail rather than a full event replay.`;
      const highlights = [
        `${priorCount} observation(s) were recorded on the sponsored watch during the paid window.`,
        "Underlying monitored_events rows are no longer loadable — narrative is audit-trail based.",
        "On-chain create + publishSponsoredReport receipts remain the verifiable dual audit trail.",
        ...(input.eventSignature
          ? [`Filtered by requested event signature: ${input.eventSignature}`]
          : []),
        ...(input.description ? [`Campaign instructions: "${input.description}"`] : []),
      ];
      const analysis =
        `Campaign ${watchId} monitored ${targetContract} from ${startsAt} to ${endsAt}. ` +
        (input.description ? `Watch instructions: "${input.description}". ` : "") +
        (input.eventSignature ? `Event filter: ${input.eventSignature}. ` : "") +
        `Monitoring ticks recorded ${priorCount} matched observation(s). ` +
        "A later regenerate could not reload those rows from monitored_events " +
        "(orphan source_event_ids from a non-persisted RPC path, or retention). " +
        "Treat the on-chain report tx + source-event root as the canonical completeness proof; " +
        "this HTTPS body is a best-effort narrative backfill.";

      return finalizeReport(
        { title, summary, highlights, analysis, confidence: "medium" },
        {
          sourceEventIds,
          sourceEventRoot,
          targetContract,
          startsAt,
          endsAt,
          generationSource: "template",
        },
      );
    }

    const summary = `No qualifying on-chain events were observed on ${targetContract} during the campaign window (${windowLabel}). The monitoring job completed with an empty source set.`;
    const highlights = [
      "Zero events matched the sponsored target contract in the campaign window.",
      "On-chain create and report receipts still form the paid campaign audit trail.",
      ...(input.eventSignature ? [`Filtered by requested event signature: ${input.eventSignature}`] : []),
      ...(input.description ? [`Campaign instructions: "${input.description}"`] : []),
    ];
    const analysis =
      `Campaign ${watchId} monitored ${targetContract} from ${startsAt} to ${endsAt}. ` +
      (input.description ? `Watch instructions: "${input.description}". ` : "") +
      (input.eventSignature ? `Event filter: ${input.eventSignature}. ` : "") +
      "No Event Tracker / block-dispatcher events referenced this contract address in the window. " +
      "The empty source-event root is committed on-chain for verifiable completeness.";

    return finalizeReport(
      { title, summary, highlights, analysis, confidence: "high" },
      {
        sourceEventIds,
        sourceEventRoot,
        targetContract,
        startsAt,
        endsAt,
        generationSource: "template",
      },
    );
  }

  const ranked = [...events].sort(
    (a, b) => (b.significance_score ?? 0) - (a.significance_score ?? 0),
  );
  const types = new Set(events.map((e) => e.event_type));
  const protocols = [
    ...new Set(events.map((e) => e.protocol).filter((p): p is string => Boolean(p))),
  ];

  const title = `Sponsored Watch Report — ${shortTarget}`;
  const summary =
    `ChronicleAI observed ${events.length} on-chain event(s) on ${targetContract} ` +
    `during ${windowLabel}. Event types: ${[...types].map((t) => t.replace(/_/g, " ")).join(", ")}.`;

  const highlights = ranked.slice(0, 8).map((event, i) => {
    const score =
      event.significance_score != null
        ? ` (significance: ${(event.significance_score * 100).toFixed(0)}%)`
        : "";
    return `${i + 1}. ${formatEventLine(event)}${score}`;
  });

  const analysisParts: string[] = [
    `Campaign ${watchId} monitored ${targetContract} (spec ${input.watchSpecHash.slice(0, 18)}…) from ${startsAt} to ${endsAt}.`,
    ...(input.description ? [`Watch instructions: "${input.description}".`] : []),
    ...(input.eventSignature ? [`Event filter signature: ${input.eventSignature}.`] : []),
    `Source set size: ${events.length} event(s) across chain id(s) ${[...new Set(events.map((e) => e.chain_id))].join(", ")}.`,
  ];
  if (protocols.length > 0) {
    analysisParts.push(`Protocols observed: ${protocols.join(", ")}.`);
  }
  const top = ranked[0];
  if (top) {
    analysisParts.push(`Highest-significance observation: ${formatEventLine(top)}.`);
  }
  analysisParts.push(
    `Source-event root ${sourceEventRoot.slice(0, 18)}… commits the ordered event id set for on-chain verification.`,
  );

  return finalizeReport(
    {
      title,
      summary,
      highlights,
      analysis: analysisParts.join("\n\n"),
      confidence: events.length >= 3 ? "high" : "medium",
    },
    {
      sourceEventIds,
      sourceEventRoot,
      targetContract,
      startsAt,
      endsAt,
      generationSource: "template",
    },
  );
}

/**
 * Groq free/dev tiers commonly cap ~8k input tokens. We budget conservatively
 * (chars/4 ≈ tokens) and leave headroom for system prompt + JSON completion.
 */
export const GROQ_INPUT_TOKEN_BUDGET = 8000;
/** Tokens reserved for system instruction + model completion overhead. */
const LLM_PROMPT_RESERVED_TOKENS = 2_000;
/** Soft ceiling on event lines even when the budget still has room. */
const LLM_MAX_EVENT_LINES = 24;
const MIN_TITLE_CHARS = 12;
const MIN_SUMMARY_CHARS = 40;
const MIN_ANALYSIS_CHARS = 60;

function estimateTokens(text: string): number {
  // ~4 chars/token is a stable lower-bound estimator for English + hex addresses.
  return Math.ceil(text.length / 4);
}

function isPlaceholderText(value: string): boolean {
  const t = value.trim();
  if (!t) return true;
  // Models sometimes emit ellipsis / "..." / "…" when the context window blows up.
  if (/^[.…]{1,10}$/u.test(t)) return true;
  if (/^(n\/?a|none|null|undefined|tbd|todo|placeholder)$/i.test(t)) return true;
  return false;
}

/**
 * True when a persisted campaign report is missing or is LLM junk
 * (e.g. title/summary/analysis literally "...").
 */
export function isPlaceholderSponsoredReport(fields: {
  reportTitle?: string | null;
  reportSummary?: string | null;
  reportAnalysis?: string | null;
  reportHighlights?: string[] | null;
}): boolean {
  const title = fields.reportTitle?.trim() ?? "";
  const summary = fields.reportSummary?.trim() ?? "";
  const analysis = fields.reportAnalysis?.trim() ?? "";
  const highlights = (fields.reportHighlights ?? []).map((h) => h.trim()).filter(Boolean);

  if (!title || !summary) return true;
  if (isPlaceholderText(title) || isPlaceholderText(summary)) return true;
  if (analysis && isPlaceholderText(analysis)) return true;
  if (highlights.length > 0 && highlights.every((h) => isPlaceholderText(h))) return true;
  if (title.length < MIN_TITLE_CHARS || summary.length < MIN_SUMMARY_CHARS) return true;
  return false;
}

function isUsableLlmNarrative(parts: {
  title: string;
  summary: string;
  analysis: string;
  highlights: string[];
}): boolean {
  if (isPlaceholderText(parts.title) || isPlaceholderText(parts.summary) || isPlaceholderText(parts.analysis)) {
    return false;
  }
  if (parts.title.length < MIN_TITLE_CHARS) return false;
  if (parts.summary.length < MIN_SUMMARY_CHARS) return false;
  if (parts.analysis.length < MIN_ANALYSIS_CHARS) return false;
  if (parts.highlights.length === 0) return false;
  if (parts.highlights.every((h) => isPlaceholderText(h))) return false;
  return true;
}

function buildLlmPrompt(
  input: SponsoredWatchReportInput,
  options?: { maxInputTokens?: number },
): string {
  const maxInputTokens = options?.maxInputTokens ?? GROQ_INPUT_TOKEN_BUDGET;
  const eventBudgetTokens = Math.max(500, maxInputTokens - LLM_PROMPT_RESERVED_TOKENS);

  const ranked = [...input.events].sort(
    (a, b) => (b.significance_score ?? 0) - (a.significance_score ?? 0),
  );

  const header = [
    "You are ChronicleAI writing a paid sponsored-watch intelligence report.",
    "Return ONLY a JSON object with keys: title (string), summary (string), highlights (string array, 2-8 items), analysis (string markdown-friendly prose), confidence (\"high\"|\"medium\"|\"low\").",
    "Ground every claim in the observed events and user instructions. Do not invent transactions.",
    "Never use ellipsis-only placeholders (\"...\") for any field. Write real prose.",
    `watchId: ${input.watchId}`,
    `targetContract: ${input.targetContract}`,
    `watchSpecHash: ${input.watchSpecHash}`,
    ...(input.eventSignature ? [`requestedEventSignature: ${input.eventSignature}`] : []),
    ...(input.description ? [`userWatchInstructions: "${input.description}"`] : []),
    `window: ${input.startsAt} → ${input.endsAt}`,
    `eventCount: ${input.events.length}`,
  ].join("\n");

  const eventLines: string[] = [];
  let usedTokens = estimateTokens(header) + estimateTokens("events:\n");
  for (let i = 0; i < ranked.length && eventLines.length < LLM_MAX_EVENT_LINES; i++) {
    const line = `${eventLines.length + 1}. ${formatEventLine(ranked[i]!)}`;
    const lineTokens = estimateTokens(line) + 1;
    if (usedTokens + lineTokens > eventBudgetTokens) break;
    eventLines.push(line);
    usedTokens += lineTokens;
  }

  const omitted = input.events.length - eventLines.length;
  const eventsBlock =
    eventLines.length > 0
      ? eventLines.join("\n") +
        (omitted > 0
          ? `\n(… ${omitted} additional matched event(s) omitted for token budget; rank by significance above.)`
          : "")
      : "(none)";

  return `${header}\nevents:\n${eventsBlock}`;
}

async function tryLlmNarrative(
  input: SponsoredWatchReportInput,
  providerConfigs: LLMProviderMap,
): Promise<{
  title: string;
  summary: string;
  highlights: string[];
  analysis: string;
  confidence: "high" | "medium" | "low";
  provider: string;
} | null> {
  const system =
    "You write precise Web3 market intelligence for paid monitoring campaigns. Respond with JSON only. Never emit ellipsis-only placeholder fields.";

  for (const provider of LLM_FALLBACK_ORDER) {
    const config = providerConfigs[provider];
    if (!config?.apiKey) continue;

    // Groq input window is ~8k tokens; OpenAI path can take a larger prompt.
    const maxInputTokens = provider === "groq" ? GROQ_INPUT_TOKEN_BUDGET : 24_000;
    const prompt = buildLlmPrompt(input, { maxInputTokens });

    const caller = LLM_PROVIDER_CALLERS[provider];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ALERT_GENERATION_TIMEOUT_MS);
    try {
      const raw = await caller(config, prompt, controller.signal, system);
      const jsonText = extractJsonObject(raw);
      if (!jsonText) continue;
      const parsed = JSON.parse(jsonText) as Record<string, unknown>;
      const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
      const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
      const analysis = typeof parsed.analysis === "string" ? parsed.analysis.trim() : "";
      const highlights = Array.isArray(parsed.highlights)
        ? parsed.highlights
            .filter((h): h is string => typeof h === "string" && h.trim().length > 0)
            .map((h) => h.trim())
        : [];
      const confidenceRaw = parsed.confidence;
      const confidence =
        confidenceRaw === "high" || confidenceRaw === "medium" || confidenceRaw === "low"
          ? confidenceRaw
          : input.events.length >= 3
            ? "high"
            : "medium";

      const candidate = {
        title,
        summary,
        analysis,
        highlights: highlights.length > 0 ? highlights.slice(0, 8) : summary ? [summary] : [],
      };
      // Reject junk ("...", too-short) so we fall through to the deterministic template.
      if (!isUsableLlmNarrative(candidate)) continue;

      return {
        ...candidate,
        confidence,
        provider,
      };
    } catch {
      // Try next provider (timeout, 8k overflow, parse error, …)
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  return null;
}

export function createSponsoredWatchReportService(options?: {
  providerConfigs?: LLMProviderMap;
}): SponsoredWatchReportService {
  const providerConfigs = options?.providerConfigs;

  return {
    async generateReport(input) {
      const sourceEventIds = input.events.map((e) => e.id);
      const sourceEventRoot = buildSourceEventRoot(sourceEventIds);

      if (providerConfigs) {
        const llm = await tryLlmNarrative(input, providerConfigs);
        if (llm) {
          return finalizeReport(
            {
              title: llm.title,
              summary: llm.summary,
              highlights: llm.highlights,
              analysis: llm.analysis,
              confidence: llm.confidence,
            },
            {
              sourceEventIds,
              sourceEventRoot,
              targetContract: input.targetContract,
              startsAt: input.startsAt,
              endsAt: input.endsAt,
              generationSource: "llm",
              generationProvider: llm.provider,
            },
          );
        }
      }

      return buildTemplateReport(input);
    },
  };
}

/**
 * Extract contract addresses from a monitored event's raw payload for
 * campaign matching (Event Tracker address / contractAddress fields).
 */
export function extractEventContractAddresses(event: MonitoredEventRow): string[] {
  const found = new Set<string>();
  const visit = (value: unknown, depth = 0): void => {
    if (depth > 4 || value == null) return;
    if (typeof value === "string") {
      if (isAddress(value, { strict: false })) {
        found.add(getAddress(value).toLowerCase());
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (typeof value === "object") {
      const obj = value as Record<string, unknown>;
      for (const key of ["address", "contractAddress", "targetContract", "to", "from"]) {
        if (
          typeof obj[key] === "string" &&
          isAddress(obj[key] as string, { strict: false })
        ) {
          found.add(getAddress(obj[key] as string).toLowerCase());
        }
      }
      // Nested rawPayload from Event Tracker expansion
      if (obj.rawPayload && typeof obj.rawPayload === "object") {
        visit(obj.rawPayload, depth + 1);
      }
      if (obj.args && typeof obj.args === "object") {
        visit(obj.args, depth + 1);
      }
    }
  };

  visit(event.raw_payload);
  return [...found];
}

export function eventMatchesTargetContract(
  event: MonitoredEventRow,
  targetContract: string,
): boolean {
  if (!isAddress(targetContract, { strict: false })) return false;
  const target = getAddress(targetContract).toLowerCase();
  return extractEventContractAddresses(event).includes(target);
}
