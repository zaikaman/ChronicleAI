// Premium productizer: turns real monitored clusters, cascades, and digests
// into sellable premium_intelligence_items (deep_dive / structured_feed / historical_feed).
// Free alerts stay free — this only mints separate paid SKUs with private analysis.

import {
  PREMIUM_CASCADE_MIN_LIQUIDATIONS,
  PREMIUM_CASCADE_MIN_TOTAL_USD,
  PREMIUM_CLUSTER_WINDOW_HOURS,
  PREMIUM_DEEP_DIVE_BASE_PRICE_USDC,
  PREMIUM_DIGEST_MIN_EVENTS_FOR_DEEP_DIVE,
  PREMIUM_HISTORICAL_FEED_PRICE_USDC,
  PREMIUM_HISTORICAL_LOOKBACK_DAYS,
  PREMIUM_HISTORICAL_MIN_EVENTS,
  PREMIUM_MIN_CLUSTER_EVENTS,
  PREMIUM_STRUCTURED_FEED_PRICE_USDC,
  chainLabel,
} from "@chronicleai/config";
import type {
  DailyDigestRow,
  ExecutionLogRepository,
  LLMGenerationAttemptRepository,
  MonitoredEventRepository,
  MonitoredEventRow,
  PremiumIntelligenceItemRow,
  PremiumIntelligenceRepository,
} from "@chronicleai/db";
import type { PaymentRoute } from "@chronicleai/schemas";
import type { LLMProviderMap } from "./llm-provider-client.ts";
import {
  createPremiumDeepDiveGenerationService,
  type PremiumDeepDiveGenerationService,
  type PremiumDeepDiveKind,
  type PremiumLlmSection,
} from "./premium-deep-dive-generation-service.ts";

export interface PremiumProductizerConfig {
  clusterWindowHours: number;
  minClusterEvents: number;
  cascadeMinLiquidations: number;
  cascadeMinTotalUsd: number;
  digestMinEventsForDeepDive: number;
  historicalLookbackDays: number;
  historicalMinEvents: number;
  deepDiveBasePriceUsdc: number;
  structuredFeedPriceUsdc: number;
  historicalFeedPriceUsdc: number;
  paymentRoutes: PaymentRoute[];
}

export interface ProductizerResult {
  created: PremiumIntelligenceItemRow[];
  skipped: string[];
  errors: string[];
}

export interface PremiumProductizerService {
  /** After a qualified event / alert path — mint cluster or cascade deep dives when warranted. */
  productizeAfterQualifiedEvent(event: MonitoredEventRow): Promise<ProductizerResult>;
  /** After a digest is generated — mint period deep dive + structured feed from real events. */
  productizeDigest(params: {
    digest: Pick<
      DailyDigestRow,
      "id" | "report_date" | "period_start" | "period_end" | "title" | "summary" | "highlights" | "analysis"
    >;
    events: MonitoredEventRow[];
  }): Promise<ProductizerResult>;
}

const DEFAULT_CONFIG: PremiumProductizerConfig = {
  clusterWindowHours: PREMIUM_CLUSTER_WINDOW_HOURS,
  minClusterEvents: PREMIUM_MIN_CLUSTER_EVENTS,
  cascadeMinLiquidations: PREMIUM_CASCADE_MIN_LIQUIDATIONS,
  cascadeMinTotalUsd: PREMIUM_CASCADE_MIN_TOTAL_USD,
  digestMinEventsForDeepDive: PREMIUM_DIGEST_MIN_EVENTS_FOR_DEEP_DIVE,
  historicalLookbackDays: PREMIUM_HISTORICAL_LOOKBACK_DAYS,
  historicalMinEvents: PREMIUM_HISTORICAL_MIN_EVENTS,
  deepDiveBasePriceUsdc: PREMIUM_DEEP_DIVE_BASE_PRICE_USDC,
  structuredFeedPriceUsdc: PREMIUM_STRUCTURED_FEED_PRICE_USDC,
  historicalFeedPriceUsdc: PREMIUM_HISTORICAL_FEED_PRICE_USDC,
  paymentRoutes: ["x402", "mpp"],
};

// ── Helpers ─────────────────────────────────────────────

function emptyResult(): ProductizerResult {
  return { created: [], skipped: [], errors: [] };
}

function mergeResults(...parts: ProductizerResult[]): ProductizerResult {
  return {
    created: parts.flatMap((p) => p.created),
    skipped: parts.flatMap((p) => p.skipped),
    errors: parts.flatMap((p) => p.errors),
  };
}

function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

function magnitudeValue(event: MonitoredEventRow): number | null {
  const mag = event.magnitude;
  if (!mag || typeof mag !== "object") return null;
  const value = (mag as { value?: unknown }).value;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function magnitudeUnit(event: MonitoredEventRow): string | null {
  const mag = event.magnitude;
  if (!mag || typeof mag !== "object") return null;
  const unit = (mag as { unit?: unknown }).unit;
  return typeof unit === "string" ? unit : null;
}

function isUsdMagnitude(event: MonitoredEventRow): boolean {
  const unit = magnitudeUnit(event);
  return unit === "USD" || unit === "USDC" || unit === "usd";
}

/** Stable cluster key: protocol → primary asset → event type + chain. */
export function clusterKeyForEvent(event: MonitoredEventRow): string {
  if (event.protocol?.trim()) {
    return `protocol:${event.protocol.trim().toLowerCase()}`;
  }
  const asset = event.asset_symbols?.find((s) => typeof s === "string" && s.trim().length > 0);
  if (asset) {
    return `asset:${asset.trim().toLowerCase()}`;
  }
  return `type:${event.event_type}:chain:${event.chain_id}`;
}

function clusterLabel(key: string): string {
  if (key.startsWith("protocol:")) return key.slice("protocol:".length);
  if (key.startsWith("asset:")) return key.slice("asset:".length).toUpperCase();
  if (key.startsWith("type:")) {
    const rest = key.slice("type:".length);
    const [type, , chain] = rest.split(":");
    return `${type ?? "activity"} (chain ${chain ?? "?"})`;
  }
  return key;
}

function formatEventLine(event: MonitoredEventRow): string {
  const mag = magnitudeValue(event);
  const unit = magnitudeUnit(event);
  const magText = mag != null && unit ? `${mag} ${unit}` : "n/a";
  const protocol = event.protocol ?? "unknown";
  const assets = event.asset_symbols?.length ? event.asset_symbols.join("/") : "—";
  const tx = event.transaction_hash ? event.transaction_hash.slice(0, 12) + "…" : "no-tx";
  return `${event.event_type} | ${protocol} | ${assets} | ${magText} | ${chainLabel(event.chain_id)} | ${tx} | ${event.captured_at}`;
}

function deepDivePrice(base: number, eventCount: number): number {
  const bump = 0.5 * Math.min(Math.max(eventCount - 3, 0), 10);
  return Math.round((base + bump) * 100) / 100;
}

function rankEvents(events: MonitoredEventRow[]): MonitoredEventRow[] {
  return [...events].sort((a, b) => {
    const scoreDiff = (b.significance_score ?? 0) - (a.significance_score ?? 0);
    if (scoreDiff !== 0) return scoreDiff;
    return b.captured_at.localeCompare(a.captured_at);
  });
}

function computeEventStats(events: MonitoredEventRow[]): {
  ranked: MonitoredEventRow[];
  findings: string[];
  typeBreakdown: string;
  protocolBreakdown: string;
  totalUsd: number;
  windowStart: string | null;
  windowEnd: string | null;
} {
  const ranked = rankEvents(events);
  const findings = ranked.slice(0, 12).map((e) => formatEventLine(e));
  const byType = new Map<string, number>();
  const byProtocol = new Map<string, number>();
  let totalUsd = 0;
  for (const e of ranked) {
    byType.set(e.event_type, (byType.get(e.event_type) ?? 0) + 1);
    const p = e.protocol?.trim() || "unknown";
    byProtocol.set(p, (byProtocol.get(p) ?? 0) + 1);
    const mag = magnitudeValue(e);
    if (mag != null && isUsdMagnitude(e)) totalUsd += mag;
  }
  const typeBreakdown = [...byType.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `${t}: ${n}`)
    .join("; ");
  const protocolBreakdown = [...byProtocol.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([p, n]) => `${p}: ${n}`)
    .join("; ");
  return {
    ranked,
    findings,
    typeBreakdown,
    protocolBreakdown,
    totalUsd,
    windowStart: ranked[ranked.length - 1]?.captured_at ?? null,
    windowEnd: ranked[0]?.captured_at ?? null,
  };
}

function buildDeterministicFallback(params: {
  kind: PremiumDeepDiveKind;
  label: string;
  events: MonitoredEventRow[];
  digestSummary?: string | null;
  digestHighlights?: string[];
  digestAnalysis?: string | null;
}): { sections: PremiumLlmSection[]; analysis: string; stats: ReturnType<typeof computeEventStats> } {
  const stats = computeEventStats(params.events);

  const executive =
    params.kind === "cascade"
      ? `Cascade analysis for ${params.label}: ${stats.ranked.length} related liquidation/risk events` +
        (stats.totalUsd > 0 ? ` totaling ~$${stats.totalUsd.toLocaleString("en-US")} notional.` : ".")
      : params.kind === "digest"
        ? `Period deep dive for ${params.label}: ${stats.ranked.length} qualified on-chain events beyond the public digest summary.`
        : params.kind === "historical"
          ? `Historical intelligence for ${params.label}: ${stats.ranked.length} qualified events across the lookback window.`
          : `Cluster deep dive for ${params.label}: ${stats.ranked.length} related events in a short monitoring window.`;

  const sections: PremiumLlmSection[] = [
    { title: "Executive Summary", body: executive },
    { title: "Key Findings", findings: stats.findings },
    {
      title: "Composition",
      body: `Types — ${stats.typeBreakdown || "n/a"}. Protocols — ${stats.protocolBreakdown || "n/a"}.`,
    },
  ];
  if (params.digestHighlights?.length) {
    sections.push({
      title: "Linked Public Digest Highlights",
      findings: params.digestHighlights.slice(0, 10),
    });
  }

  const analysis = [
    `Event-type mix: ${stats.typeBreakdown || "n/a"}.`,
    `Protocol mix: ${stats.protocolBreakdown || "n/a"}.`,
    stats.totalUsd > 0
      ? `Aggregated USD-notional magnitudes: $${stats.totalUsd.toLocaleString("en-US")}.`
      : null,
    stats.windowStart && stats.windowEnd
      ? `Observed window: ${stats.windowStart} → ${stats.windowEnd}.`
      : null,
    params.digestSummary ? `Public digest summary (context only): ${params.digestSummary}` : null,
    "Deterministic fallback used because LLM generation was unavailable; claims are limited to structured monitored-event fields.",
  ]
    .filter(Boolean)
    .join(" ");

  return { sections, analysis, stats };
}

function attachEventPayload(
  stats: ReturnType<typeof computeEventStats>,
  kind: PremiumDeepDiveKind,
  label: string,
  narrative: {
    sections: PremiumLlmSection[];
    analysis: string;
    confidence: string;
    generationProvider: string;
    usedLlm: boolean;
  },
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    productKind: kind,
    label,
    eventCount: stats.ranked.length,
    totalUsdNotional: stats.totalUsd > 0 ? stats.totalUsd : null,
    windowStart: stats.windowStart,
    windowEnd: stats.windowEnd,
    sections: narrative.sections,
    analysis: narrative.analysis,
    confidence: narrative.confidence,
    generationProvider: narrative.generationProvider,
    usedLlm: narrative.usedLlm,
    events: stats.ranked.map((e) => ({
      id: e.id,
      eventType: e.event_type,
      chainId: e.chain_id,
      network: chainLabel(e.chain_id),
      protocol: e.protocol,
      assetSymbols: e.asset_symbols,
      magnitude: e.magnitude,
      transactionHash: e.transaction_hash,
      significanceScore: e.significance_score,
      capturedAt: e.captured_at,
    })),
    ...extra,
  };
}

function buildStructuredFeedPrivate(events: MonitoredEventRow[]): Record<string, unknown> {
  const ranked = rankEvents(events);
  return {
    feedType: "structured_event_feed",
    generatedAt: new Date().toISOString(),
    entryCount: ranked.length,
    feedEntries: ranked.map((e) => ({
      eventId: e.id,
      timestamp: e.captured_at,
      eventType: e.event_type,
      chainId: e.chain_id,
      network: chainLabel(e.chain_id),
      protocol: e.protocol,
      assets: e.asset_symbols,
      magnitudeValue: magnitudeValue(e),
      magnitudeUnit: magnitudeUnit(e),
      transactionHash: e.transaction_hash,
      significanceScore: e.significance_score,
      sourceEventId: e.source_event_id,
    })),
  };
}

function buildHistoricalFeedPrivate(
  protocol: string,
  events: MonitoredEventRow[],
): Record<string, unknown> {
  const ranked = rankEvents(events).sort((a, b) => a.captured_at.localeCompare(b.captured_at));
  const byDay = new Map<string, { events: number; volumeUsd: number }>();
  for (const e of ranked) {
    const day = dayKey(e.captured_at);
    const bucket = byDay.get(day) ?? { events: 0, volumeUsd: 0 };
    bucket.events += 1;
    const mag = magnitudeValue(e);
    if (mag != null && isUsdMagnitude(e)) bucket.volumeUsd += mag;
    byDay.set(day, bucket);
  }

  return {
    protocol,
    periodStart: ranked[0]?.captured_at ?? null,
    periodEnd: ranked[ranked.length - 1]?.captured_at ?? null,
    feedEntries: [...byDay.entries()].map(([timestamp, stats]) => ({
      timestamp,
      protocol,
      events: stats.events,
      volumeUsd: Math.round(stats.volumeUsd * 100) / 100,
    })),
    events: ranked.map((e) => ({
      id: e.id,
      eventType: e.event_type,
      capturedAt: e.captured_at,
      magnitude: e.magnitude,
      transactionHash: e.transaction_hash,
      chainId: e.chain_id,
    })),
  };
}

// ── Service ─────────────────────────────────────────────

export function createPremiumProductizerService(deps: {
  premiumRepo: PremiumIntelligenceRepository;
  eventRepo: MonitoredEventRepository;
  execLogRepo?: ExecutionLogRepository;
  /** Gemini → Groq → OpenAI configs for paid narrative generation. */
  providerConfigs?: LLMProviderMap | null;
  llmAttemptRepo?: LLMGenerationAttemptRepository | null;
  /** Test seam — overrides default LLM deep-dive generator. */
  deepDiveGenerator?: PremiumDeepDiveGenerationService;
  config?: Partial<PremiumProductizerConfig>;
}): PremiumProductizerService {
  const config: PremiumProductizerConfig = { ...DEFAULT_CONFIG, ...deps.config };
  const deepDiveGenerator =
    deps.deepDiveGenerator ??
    createPremiumDeepDiveGenerationService(deps.providerConfigs, deps.llmAttemptRepo);

  async function slugExists(slug: string): Promise<boolean | "error"> {
    const existing = await deps.premiumRepo.findBySlug(slug);
    if (!existing.ok) return "error";
    return existing.value != null;
  }

  async function ensureItem(params: {
    slug: string;
    title: string;
    contentType: "deep_dive" | "structured_feed" | "historical_feed";
    summaryPublic: string;
    contentPrivate: Record<string, unknown>;
    sourceEventIds: string[];
    priceAmount: number;
  }): Promise<{ item: PremiumIntelligenceItemRow | null; created: boolean; error?: string }> {
    const existing = await deps.premiumRepo.findBySlug(params.slug);
    if (!existing.ok) {
      return { item: null, created: false, error: existing.error.message };
    }
    if (existing.value) {
      return { item: existing.value, created: false };
    }

    const created = await deps.premiumRepo.create({
      slug: params.slug,
      title: params.title,
      content_type: params.contentType,
      summary_public: params.summaryPublic,
      content_private: params.contentPrivate,
      source_event_ids: params.sourceEventIds,
      price_amount: params.priceAmount,
      price_currency: "USDC",
      payment_routes: config.paymentRoutes,
      status: "available",
    });

    if (!created.ok) {
      // Unique race: treat as already present
      const again = await deps.premiumRepo.findBySlug(params.slug);
      if (again.ok && again.value) {
        return { item: again.value, created: false };
      }
      return { item: null, created: false, error: created.error.message };
    }

    if (deps.execLogRepo) {
      const privateMeta = params.contentPrivate as {
        generationProvider?: string;
        usedLlm?: boolean;
      };
      await deps.execLogRepo.append({
        action_type: "monitor",
        entity_type: "premium_intelligence_item",
        entity_id: created.value.id,
        status: "succeeded",
        message: `Premium ${params.contentType} minted: ${params.title}`,
        details: {
          slug: params.slug,
          contentType: params.contentType,
          sourceEventCount: params.sourceEventIds.length,
          priceAmount: params.priceAmount,
          generationProvider: privateMeta.generationProvider ?? null,
          usedLlm: privateMeta.usedLlm ?? null,
        },
      });
    }

    return { item: created.value, created: true };
  }

  async function composeDeepDivePrivate(params: {
    kind: PremiumDeepDiveKind;
    label: string;
    events: MonitoredEventRow[];
    defaultSummaryPublic: string;
    digestSummary?: string | null;
    digestHighlights?: string[];
    digestAnalysis?: string | null;
    lookbackDays?: number;
    extra?: Record<string, unknown>;
  }): Promise<
    | { ok: true; contentPrivate: Record<string, unknown>; summaryPublic: string }
    | { ok: false; reason: string }
  > {
    const fallback = buildDeterministicFallback({
      kind: params.kind,
      label: params.label,
      events: params.events,
      ...(params.digestSummary !== undefined ? { digestSummary: params.digestSummary } : {}),
      ...(params.digestHighlights !== undefined
        ? { digestHighlights: params.digestHighlights }
        : {}),
      ...(params.digestAnalysis !== undefined ? { digestAnalysis: params.digestAnalysis } : {}),
    });

    const narrative = await deepDiveGenerator.generateNarrative({
      kind: params.kind,
      label: params.label,
      events: params.events,
      defaultSummaryPublic: params.defaultSummaryPublic,
      fallback: { sections: fallback.sections, analysis: fallback.analysis },
      ...(params.digestSummary !== undefined ? { digestSummary: params.digestSummary } : {}),
      ...(params.digestHighlights !== undefined
        ? { digestHighlights: params.digestHighlights }
        : {}),
      ...(params.digestAnalysis !== undefined ? { digestAnalysis: params.digestAnalysis } : {}),
      ...(params.lookbackDays !== undefined ? { lookbackDays: params.lookbackDays } : {}),
    });

    // Only list paid narrative SKUs when an LLM actually wrote them.
    if (!narrative.usedLlm) {
      return {
        ok: false,
        reason: `llm-unavailable:${params.kind}:${params.label}`,
      };
    }

    return {
      ok: true,
      summaryPublic: narrative.summaryPublic,
      contentPrivate: attachEventPayload(
        fallback.stats,
        params.kind,
        params.label,
        narrative,
        params.extra,
      ),
    };
  }

  function recordEnsure(
    result: ProductizerResult,
    ensured: { item: PremiumIntelligenceItemRow | null; created: boolean; error?: string },
    skipReason: string,
  ): void {
    if (ensured.error) {
      result.errors.push(ensured.error);
      return;
    }
    if (ensured.created && ensured.item) {
      result.created.push(ensured.item);
      return;
    }
    result.skipped.push(skipReason);
  }

  function summarizeLiquidations(events: MonitoredEventRow[]): {
    liquidations: MonitoredEventRow[];
    liquidationUsd: number;
    protocols: Set<string>;
  } {
    const liquidations = events.filter((e) => e.event_type === "liquidation");
    let liquidationUsd = 0;
    for (const e of liquidations) {
      const mag = magnitudeValue(e);
      if (mag != null && isUsdMagnitude(e)) liquidationUsd += mag;
    }
    const protocols = new Set(
      liquidations
        .map((e) => e.protocol?.trim().toLowerCase())
        .filter((p): p is string => Boolean(p)),
    );
    return { liquidations, liquidationUsd, protocols };
  }

  function isCascadeSet(events: MonitoredEventRow[]): boolean {
    const { liquidations, liquidationUsd, protocols } = summarizeLiquidations(events);
    return (
      liquidations.length >= config.cascadeMinLiquidations &&
      (liquidationUsd >= config.cascadeMinTotalUsd || protocols.size >= 2)
    );
  }

  async function mintDeepDive(params: {
    kind: "cluster" | "cascade";
    label: string;
    day: string;
    events: MonitoredEventRow[];
    liquidationUsd?: number;
    liquidationCount?: number;
  }): Promise<ProductizerResult> {
    const result = emptyResult();
    const slug = slugify(
      params.kind === "cascade"
        ? `deep-dive-cascade-${params.label}-${params.day}`
        : `deep-dive-cluster-${params.label}-${params.day}`,
    );

    const exists = await slugExists(slug);
    if (exists === "error") {
      result.errors.push(`slug-check-failed:${slug}`);
      return result;
    }
    if (exists) {
      result.skipped.push(`exists:${slug}`);
      return result;
    }

    const title =
      params.kind === "cascade"
        ? `Deep Dive: Liquidation Cascade — ${params.label} (${params.day})`
        : `Deep Dive: ${params.label} Event Cluster (${params.day})`;
    const defaultSummaryPublic =
      params.kind === "cascade"
        ? `Paid cascade report for ${params.label}: ${params.liquidationCount ?? 0} liquidations` +
          (params.liquidationUsd && params.liquidationUsd > 0
            ? ` (~$${Math.round(params.liquidationUsd).toLocaleString("en-US")} notional)`
            : "") +
          `. Public alerts cover individual events; this SKU joins them.`
        : `Paid multi-event analysis for ${params.label}: ${params.events.length} related on-chain events in a short window. Public alerts stay free; this report ranks and correlates them.`;

    const composed = await composeDeepDivePrivate({
      kind: params.kind,
      label: params.label,
      events: params.events,
      defaultSummaryPublic,
    });
    if (!composed.ok) {
      result.skipped.push(composed.reason);
      return result;
    }

    const ensured = await ensureItem({
      slug,
      title,
      contentType: "deep_dive",
      summaryPublic: composed.summaryPublic,
      contentPrivate: composed.contentPrivate,
      sourceEventIds: params.events.map((e) => e.id),
      priceAmount: deepDivePrice(config.deepDiveBasePriceUsdc, params.events.length),
    });
    recordEnsure(result, ensured, `exists:${slug}`);
    return result;
  }

  async function mintClusterOrCascade(
    related: MonitoredEventRow[],
    key: string,
  ): Promise<ProductizerResult> {
    const result = emptyResult();
    if (related.length === 0) {
      result.skipped.push("no-related-events");
      return result;
    }

    const label = clusterLabel(key);
    const day = dayKey(related[0]?.captured_at ?? new Date().toISOString());
    const { liquidations, liquidationUsd } = summarizeLiquidations(related);
    const cascade = isCascadeSet(related);
    const isCluster = related.length >= config.minClusterEvents;

    if (!cascade && !isCluster) {
      result.skipped.push(
        `below-threshold:${key}:events=${related.length}:liqs=${liquidations.length}`,
      );
      return result;
    }

    return mintDeepDive({
      kind: cascade ? "cascade" : "cluster",
      label,
      day,
      events: related,
      liquidationUsd,
      liquidationCount: liquidations.length,
    });
  }

  /** Window-wide multi-protocol liquidation cascade (cross-protocol risk). */
  async function mintWindowCascade(windowEvents: MonitoredEventRow[]): Promise<ProductizerResult> {
    const result = emptyResult();
    const { liquidations, liquidationUsd, protocols } = summarizeLiquidations(windowEvents);
    if (!isCascadeSet(windowEvents)) {
      result.skipped.push(
        `window-cascade-below:liqs=${liquidations.length}:usd=${liquidationUsd}:protocols=${protocols.size}`,
      );
      return result;
    }
    const day = dayKey(liquidations[0]?.captured_at ?? new Date().toISOString());
    const label =
      protocols.size >= 2 ? `multi-protocol (${[...protocols].slice(0, 4).join("/")})` : clusterLabel(
        clusterKeyForEvent(liquidations[0]!),
      );
    return mintDeepDive({
      kind: "cascade",
      label,
      day,
      events: liquidations,
      liquidationUsd,
      liquidationCount: liquidations.length,
    });
  }

  async function loadQualifiedWindow(
    periodStart: string,
    periodEnd: string,
  ): Promise<MonitoredEventRow[]> {
    const listed = await deps.eventRepo.listInWindow({
      periodStart,
      periodEnd,
      status: "qualified",
      limit: 2000,
    });
    if (!listed.ok) {
      throw new Error(listed.error.message);
    }
    return listed.value;
  }

  /** LLM historical feeds for protocols that have enough lookback activity. */
  async function mintHistoricalForProtocols(
    triggerEvents: MonitoredEventRow[],
    asOf: Date,
  ): Promise<ProductizerResult> {
    const result = emptyResult();
    const protocols = new Set(
      triggerEvents
        .map((e) => e.protocol?.trim())
        .filter((p): p is string => Boolean(p)),
    );
    if (protocols.size === 0) {
      result.skipped.push("historical-no-protocols");
      return result;
    }

    const periodEnd = asOf.toISOString();
    const periodStart = new Date(
      asOf.getTime() - config.historicalLookbackDays * 24 * 60 * 60 * 1000,
    ).toISOString();
    const histEvents = await loadQualifiedWindow(periodStart, periodEnd);
    const histEndDay = dayKey(periodEnd);

    for (const protocol of protocols) {
      const protocolEvents = histEvents.filter(
        (e) => e.protocol?.trim().toLowerCase() === protocol.toLowerCase(),
      );
      if (protocolEvents.length < config.historicalMinEvents) {
        result.skipped.push(`historical-below-min:${protocol}:${protocolEvents.length}`);
        continue;
      }

      const slug = slugify(`historical-feed-${protocol}-${histEndDay}`);
      const exists = await slugExists(slug);
      if (exists === true) {
        result.skipped.push(`exists:${slug}`);
        continue;
      }
      if (exists === "error") {
        result.errors.push(`slug-check-failed:${slug}`);
        continue;
      }

      const structured = buildHistoricalFeedPrivate(protocol, protocolEvents);
      const defaultSummaryPublic = `Paid ${config.historicalLookbackDays}-day structured history for ${protocol}: ${protocolEvents.length} qualified events with daily aggregates. Public alerts cover singles; this SKU is the lookback.`;
      const composed = await composeDeepDivePrivate({
        kind: "historical",
        label: protocol,
        events: protocolEvents,
        defaultSummaryPublic,
        lookbackDays: config.historicalLookbackDays,
        extra: {
          protocol,
          periodStart: structured.periodStart,
          periodEnd: structured.periodEnd,
          feedEntries: structured.feedEntries,
        },
      });
      if (!composed.ok) {
        result.skipped.push(composed.reason);
        continue;
      }

      const ensured = await ensureItem({
        slug,
        title: `Historical Feed: ${protocol} (${config.historicalLookbackDays}d)`,
        contentType: "historical_feed",
        summaryPublic: composed.summaryPublic,
        contentPrivate: composed.contentPrivate,
        sourceEventIds: protocolEvents.map((e) => e.id),
        priceAmount: config.historicalFeedPriceUsdc,
      });
      recordEnsure(result, ensured, `exists:${slug}`);
    }

    return result;
  }

  const service: PremiumProductizerService = {
    async productizeAfterQualifiedEvent(event) {
      const result = emptyResult();
      try {
        const end = new Date(event.captured_at);
        if (Number.isNaN(end.getTime())) {
          result.errors.push("invalid-captured_at");
          return result;
        }
        const start = new Date(end.getTime() - config.clusterWindowHours * 60 * 60 * 1000);
        const windowEvents = await loadQualifiedWindow(start.toISOString(), end.toISOString());
        // Ensure trigger is included even if status race
        if (!windowEvents.some((e) => e.id === event.id)) {
          windowEvents.push(event);
        }
        const key = clusterKeyForEvent(event);
        const related = windowEvents.filter((e) => clusterKeyForEvent(e) === key);
        const clusterResult = await mintClusterOrCascade(related, key);
        // Also try window-wide multi-protocol liquidation cascade
        const cascadeResult =
          event.event_type === "liquidation"
            ? await mintWindowCascade(windowEvents)
            : emptyResult();
        return mergeResults(clusterResult, cascadeResult);
      } catch (error) {
        result.errors.push(error instanceof Error ? error.message : String(error));
        return result;
      }
    },

    async productizeDigest({ digest, events }) {
      const result = emptyResult();
      try {
        if (events.length === 0) {
          result.skipped.push("digest-no-events");
          return result;
        }

        const reportDate = digest.report_date;
        const label = reportDate;

        // Structured feed: any non-empty digest window (machine MPP product)
        const structuredSlug = slugify(`structured-feed-${reportDate}`);
        const structuredEnsure = await ensureItem({
          slug: structuredSlug,
          title: `Structured Feed — ${reportDate}`,
          contentType: "structured_feed",
          summaryPublic: `Machine-readable feed of ${events.length} qualified events for ${reportDate}. Public digest is narrative-only; this SKU returns the full structured event payload.`,
          contentPrivate: buildStructuredFeedPrivate(events),
          sourceEventIds: events.map((e) => e.id),
          priceAmount: config.structuredFeedPriceUsdc,
        });
        recordEnsure(result, structuredEnsure, `exists:${structuredSlug}`);

        if (events.length >= config.digestMinEventsForDeepDive) {
          const deepSlug = slugify(`deep-dive-digest-${reportDate}`);
          const exists = await slugExists(deepSlug);
          if (exists === true) {
            result.skipped.push(`exists:${deepSlug}`);
          } else if (exists === "error") {
            result.errors.push(`slug-check-failed:${deepSlug}`);
          } else {
            const defaultSummaryPublic = `Paid period deep dive for ${reportDate}: multi-event ranking, composition, and expanded analysis linked to the public digest. Free digest stays free.`;
            const composed = await composeDeepDivePrivate({
              kind: "digest",
              label,
              events,
              defaultSummaryPublic,
              digestSummary: digest.summary,
              digestHighlights: digest.highlights ?? [],
              digestAnalysis: digest.analysis,
            });
            if (!composed.ok) {
              result.skipped.push(composed.reason);
            } else {
              const deepEnsure = await ensureItem({
                slug: deepSlug,
                title: `Deep Dive: Daily Period Analysis — ${reportDate}`,
                contentType: "deep_dive",
                summaryPublic: composed.summaryPublic,
                contentPrivate: composed.contentPrivate,
                sourceEventIds: events.map((e) => e.id),
                priceAmount: deepDivePrice(config.deepDiveBasePriceUsdc, events.length),
              });
              recordEnsure(result, deepEnsure, `exists:${deepSlug}`);
            }
          }
        } else {
          result.skipped.push(
            `digest-deep-dive-below-min:${events.length}<${config.digestMinEventsForDeepDive}`,
          );
        }

        // Historical feeds when a protocol in this digest has enough lookback activity
        const asOf = digest.period_end ? new Date(digest.period_end) : new Date();
        const histResult = await mintHistoricalForProtocols(
          events,
          Number.isNaN(asOf.getTime()) ? new Date() : asOf,
        );
        return mergeResults(result, histResult);
      } catch (error) {
        result.errors.push(error instanceof Error ? error.message : String(error));
        return result;
      }
    },
  };

  return service;
}
