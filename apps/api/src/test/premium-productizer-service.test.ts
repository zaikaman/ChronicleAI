import type {
  MonitoredEventRepository,
  MonitoredEventRow,
  PremiumIntelligenceItemRow,
  PremiumIntelligenceRepository,
} from "@chronicleai/db";
import { describe, expect, it } from "vitest";
import {
  clusterKeyForEvent,
  createPremiumProductizerService,
} from "../services/premium-productizer-service.ts";

function makeEvent(overrides: Partial<MonitoredEventRow> = {}): MonitoredEventRow {
  return {
    id: overrides.id ?? "00000000-0000-4000-8000-000000000001",
    source: "test",
    source_event_id: "src-1",
    event_type: "large_swap",
    chain_id: 11155111,
    protocol: "Uniswap",
    asset_symbols: ["WETH", "USDC"],
    magnitude: { value: 150_000, unit: "USD" },
    transaction_hash: "0xabc",
    observed_at: null,
    captured_at: "2026-07-28T12:00:00.000Z",
    significance_score: 0.8,
    raw_payload: {},
    status: "qualified",
    created_at: "2026-07-28T12:00:00.000Z",
    updated_at: "2026-07-28T12:00:00.000Z",
    ...overrides,
  };
}

function makePremiumRepo(seed: PremiumIntelligenceItemRow[] = []) {
  const items = [...seed];
  const repo: PremiumIntelligenceRepository = {
    async listTeasers() {
      return { ok: true, value: items.filter((i) => i.status === "available") };
    },
    async listTeasersPage(params) {
      const page = Math.max(1, params?.page ?? 1);
      const limit = Math.max(1, params?.limit ?? 20);
      const available = items.filter((i) => i.status === "available");
      const offset = (page - 1) * limit;
      const slice = available.slice(offset, offset + limit);
      const total = available.length;
      const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
      return {
        ok: true,
        value: {
          items: slice,
          page,
          limit,
          total,
          totalPages,
          hasNextPage: totalPages > 0 && page < totalPages,
          hasPreviousPage: page > 1 && totalPages > 0,
        },
      };
    },
    async findBySlug(slug) {
      return {
        ok: true,
        value: items.find((i) => i.slug === slug && i.status === "available") ?? null,
      };
    },
    async findById(id) {
      return { ok: true, value: items.find((i) => i.id === id) ?? null };
    },
    async findPrivateContent(id) {
      const row = items.find((i) => i.id === id);
      return { ok: true, value: row?.content_private ?? null };
    },
    async create(item) {
      const row: PremiumIntelligenceItemRow = {
        id: `prem-${items.length + 1}`,
        slug: item.slug,
        title: item.title,
        content_type: item.content_type,
        summary_public: item.summary_public,
        content_private: item.content_private,
        source_event_ids: item.source_event_ids,
        price_amount: item.price_amount,
        price_currency: item.price_currency,
        payment_routes: item.payment_routes,
        status: item.status ?? "available",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      items.push(row);
      return { ok: true, value: row };
    },
    async update(id, update) {
      const idx = items.findIndex((i) => i.id === id);
      if (idx < 0) return { ok: false, error: new Error("not found") as never };
      items[idx] = { ...items[idx]!, ...update } as PremiumIntelligenceItemRow;
      return { ok: true, value: items[idx]! };
    },
    async archiveNonLlmAutoProducts() {
      return { ok: true, value: 0 };
    },
    async findSponsoredMonitorsByIntentKey() {
      return { ok: true, value: [] };
    },
  };
  return { repo, items };
}

function makeEventRepo(events: MonitoredEventRow[]) {
  const repo: MonitoredEventRepository = {
    async create() {
      throw new Error("not used");
    },
    async findById(id) {
      const row = events.find((e) => e.id === id);
      return row
        ? { ok: true, value: row }
        : { ok: false, error: new Error("missing") as never };
    },
    async findBySourceAndEventId() {
      return null;
    },
    async updateStatus() {
      throw new Error("not used");
    },
    async list() {
      return { ok: true, value: events };
    },
    async listInWindow({ periodStart, periodEnd, status }) {
      const value = events.filter((e) => {
        if (status && e.status !== status) return false;
        return e.captured_at >= periodStart && e.captured_at <= periodEnd;
      });
      return { ok: true, value };
    },
  };
  return repo;
}

describe("clusterKeyForEvent", () => {
  it("prefers protocol, then asset, then type+chain", () => {
    expect(clusterKeyForEvent(makeEvent({ protocol: "Aave" }))).toBe("protocol:aave");
    expect(
      clusterKeyForEvent(makeEvent({ protocol: null, asset_symbols: ["eth"] })),
    ).toBe("asset:eth");
    expect(
      clusterKeyForEvent(
        makeEvent({ protocol: null, asset_symbols: null, event_type: "gas_spike", chain_id: 1 }),
      ),
    ).toBe("type:gas_spike:chain:1");
  });
});

describe("createPremiumProductizerService", () => {
  it("does not mint a deep dive below cluster threshold", async () => {
    const events = [
      makeEvent({ id: "e1", captured_at: "2026-07-28T10:00:00.000Z" }),
      makeEvent({ id: "e2", captured_at: "2026-07-28T11:00:00.000Z" }),
    ];
    const { repo, items } = makePremiumRepo();
    const service = createPremiumProductizerService({
      premiumRepo: repo,
      eventRepo: makeEventRepo(events),
    });

    const result = await service.productizeAfterQualifiedEvent(events[1]!);
    expect(result.created).toHaveLength(0);
    expect(items).toHaveLength(0);
    expect(result.skipped.some((s) => s.includes("below-threshold"))).toBe(true);
  });

  it("mints a cluster deep dive when enough related events share a protocol", async () => {
    const events = [
      makeEvent({ id: "e1", captured_at: "2026-07-28T10:00:00.000Z" }),
      makeEvent({ id: "e2", captured_at: "2026-07-28T11:00:00.000Z" }),
      makeEvent({ id: "e3", captured_at: "2026-07-28T12:00:00.000Z" }),
    ];
    const { repo, items } = makePremiumRepo();
    const service = createPremiumProductizerService({
      premiumRepo: repo,
      eventRepo: makeEventRepo(events),
      deepDiveGenerator: {
        async generateNarrative(params) {
          return {
            summaryPublic: "LLM teaser",
            sections: [{ title: "Executive Summary", body: "LLM body" }],
            analysis: "LLM analysis",
            confidence: "high",
            generationProvider: "gemini",
            usedLlm: true,
          };
        },
      },
    });

    const result = await service.productizeAfterQualifiedEvent(events[2]!);
    expect(result.errors).toEqual([]);
    expect(result.created).toHaveLength(1);
    expect(result.created[0]?.content_type).toBe("deep_dive");
    expect(result.created[0]?.slug).toContain("deep-dive-cluster-uniswap");
    expect(result.created[0]?.source_event_ids).toHaveLength(3);
    expect(result.created[0]?.price_amount).toBeGreaterThan(0);
    expect(result.created[0]?.summary_public).toBe("LLM teaser");
    expect(items).toHaveLength(1);

    const privateContent = result.created[0]?.content_private as {
      sections?: unknown[];
      analysis?: string;
      usedLlm?: boolean;
      generationProvider?: string;
    };
    expect(Array.isArray(privateContent.sections)).toBe(true);
    expect(privateContent.analysis).toBe("LLM analysis");
    expect(privateContent.usedLlm).toBe(true);
    expect(privateContent.generationProvider).toBe("gemini");
  });

  it("mints a cascade deep dive for multi-protocol liquidations in one window", async () => {
    const cascadeEvents = [
      makeEvent({
        id: "c1",
        event_type: "liquidation",
        protocol: "Aave",
        magnitude: { value: 60_000, unit: "USD" },
        captured_at: "2026-07-28T10:00:00.000Z",
      }),
      makeEvent({
        id: "c2",
        event_type: "liquidation",
        protocol: "Compound",
        magnitude: { value: 70_000, unit: "USD" },
        captured_at: "2026-07-28T10:30:00.000Z",
      }),
      makeEvent({
        id: "c3",
        event_type: "liquidation",
        protocol: "Morpho",
        magnitude: { value: 80_000, unit: "USD" },
        captured_at: "2026-07-28T11:00:00.000Z",
      }),
    ];
    const { repo } = makePremiumRepo();
    const service = createPremiumProductizerService({
      premiumRepo: repo,
      eventRepo: makeEventRepo(cascadeEvents),
      deepDiveGenerator: {
        async generateNarrative() {
          return {
            summaryPublic: "Cascade teaser",
            sections: [{ title: "Executive Summary", body: "Cascade body" }],
            analysis: "Cascade analysis",
            confidence: "high",
            generationProvider: "gemini",
            usedLlm: true,
          };
        },
      },
    });

    const result = await service.productizeAfterQualifiedEvent(cascadeEvents[2]!);
    expect(result.created.some((c) => c.slug.includes("cascade"))).toBe(true);
    expect(result.created.some((c) => /Cascade/i.test(c.title))).toBe(true);
  });

  it("is idempotent — second call skips existing slug", async () => {
    const events = [
      makeEvent({ id: "e1", captured_at: "2026-07-28T10:00:00.000Z" }),
      makeEvent({ id: "e2", captured_at: "2026-07-28T11:00:00.000Z" }),
      makeEvent({ id: "e3", captured_at: "2026-07-28T12:00:00.000Z" }),
    ];
    const { repo, items } = makePremiumRepo();
    const service = createPremiumProductizerService({
      premiumRepo: repo,
      eventRepo: makeEventRepo(events),
      deepDiveGenerator: {
        async generateNarrative() {
          return {
            summaryPublic: "LLM teaser",
            sections: [{ title: "Executive Summary", body: "LLM body" }],
            analysis: "LLM analysis",
            confidence: "high",
            generationProvider: "gemini",
            usedLlm: true,
          };
        },
      },
    });

    const first = await service.productizeAfterQualifiedEvent(events[2]!);
    const second = await service.productizeAfterQualifiedEvent(events[2]!);
    expect(first.created).toHaveLength(1);
    expect(second.created).toHaveLength(0);
    expect(second.skipped.some((s) => s.startsWith("exists:"))).toBe(true);
    expect(items).toHaveLength(1);
  });

  it("mints structured feed + deep dive from a digest event set", async () => {
    const events = [
      makeEvent({ id: "d1", captured_at: "2026-07-09T01:00:00.000Z" }),
      makeEvent({ id: "d2", captured_at: "2026-07-09T08:00:00.000Z" }),
      makeEvent({ id: "d3", captured_at: "2026-07-09T15:00:00.000Z" }),
    ];
    const { repo, items } = makePremiumRepo();
    const service = createPremiumProductizerService({
      premiumRepo: repo,
      eventRepo: makeEventRepo(events),
      config: { historicalMinEvents: 99 },
      deepDiveGenerator: {
        async generateNarrative() {
          return {
            summaryPublic: "Digest deep dive teaser",
            sections: [{ title: "Executive Summary", body: "Digest body" }],
            analysis: "Digest analysis",
            confidence: "high",
            generationProvider: "openai",
            usedLlm: true,
          };
        },
      },
    });

    const result = await service.productizeDigest({
      digest: {
        id: "digest-1",
        report_date: "2026-07-09",
        period_start: "2026-07-09T00:00:00.000Z",
        period_end: "2026-07-28T00:00:00.000Z",
        title: "Daily Digest",
        summary: "Busy day on Uniswap.",
        highlights: ["Large swaps dominated"],
        analysis: "Public analysis only.",
      },
      events,
    });

    expect(result.errors).toEqual([]);
    expect(result.created).toHaveLength(2);
    const types = result.created.map((c) => c.content_type).sort();
    expect(types).toEqual(["deep_dive", "structured_feed"]);
    expect(items).toHaveLength(2);
  });

  it("skips deep dive mint when LLM is unavailable", async () => {
    const events = [
      makeEvent({ id: "e1", captured_at: "2026-07-28T10:00:00.000Z" }),
      makeEvent({ id: "e2", captured_at: "2026-07-28T11:00:00.000Z" }),
      makeEvent({ id: "e3", captured_at: "2026-07-28T12:00:00.000Z" }),
    ];
    const { repo, items } = makePremiumRepo();
    const service = createPremiumProductizerService({
      premiumRepo: repo,
      eventRepo: makeEventRepo(events),
      // No provider configs → deterministic fallback → skip mint
    });

    const result = await service.productizeAfterQualifiedEvent(events[2]!);
    expect(result.created).toHaveLength(0);
    expect(items).toHaveLength(0);
    expect(result.skipped.some((s) => s.startsWith("llm-unavailable:"))).toBe(true);
  });

  it("mints historical feed from digest when protocol has enough lookback events", async () => {
    const now = new Date("2026-07-28T12:00:00.000Z");
    const events = Array.from({ length: 5 }, (_, i) =>
      makeEvent({
        id: `h${i + 1}`,
        protocol: "Aave",
        captured_at: new Date(now.getTime() - i * 3_600_000).toISOString(),
      }),
    );
    const { repo, items } = makePremiumRepo();
    const service = createPremiumProductizerService({
      premiumRepo: repo,
      eventRepo: makeEventRepo(events),
      config: { historicalMinEvents: 5, digestMinEventsForDeepDive: 99 },
      deepDiveGenerator: {
        async generateNarrative(params) {
          return {
            summaryPublic: `Historical teaser for ${params.label}`,
            sections: [{ title: "Executive Summary", body: "Hist body" }],
            analysis: "Hist analysis",
            confidence: "medium",
            generationProvider: "gemini",
            usedLlm: true,
          };
        },
      },
    });

    const result = await service.productizeDigest({
      digest: {
        id: "digest-hist",
        report_date: "2026-07-28",
        period_start: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
        period_end: now.toISOString(),
        title: "Digest",
        summary: "Summary",
        highlights: ["h1"],
        analysis: null,
      },
      events,
    });

    expect(result.errors).toEqual([]);
    expect(result.created.some((c) => c.content_type === "historical_feed")).toBe(true);
    expect(result.created.some((c) => c.content_type === "structured_feed")).toBe(true);
    expect(items.some((i) => i.content_type === "historical_feed")).toBe(true);
  });
});
