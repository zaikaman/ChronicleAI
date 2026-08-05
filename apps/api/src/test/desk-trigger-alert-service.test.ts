import { ACTIVE_INTELLIGENCE_CHAIN_ID } from "@chronicleai/config";
import {
  RepositoryError,
  type DeskSignalRepository,
  type DeskSignalRow,
  type PublicAlertInsert,
  type PublicAlertRepository,
  type PublicAlertRow,
} from "@chronicleai/db";
import { DESK_CHAIN_ID } from "@chronicleai/schemas";
import { describe, expect, it, vi } from "vitest";
import type { CapitalDecision } from "../desk/types.ts";
import type { AlertPublicationService } from "../services/alert-publication-service.ts";
import {
  actionStatusForVerdict,
  buildCapitalAlertCopy,
  buildSignalAlertCopy,
  capitalSourceDedupeKey,
  createDeskTriggerAlertService,
  deskTriggerSourceLabel,
  isDeskTriggerCapitalAction,
  isDeskTriggerSignalType,
  redactPublicEvidence,
  shouldCreateAlertForVerdict,
  signalSourceDedupeKey,
  sourceTriggerLabelFromAlert,
} from "../services/desk-trigger-alert-service.ts";

function signalRow(overrides: Partial<DeskSignalRow> = {}): DeskSignalRow {
  return {
    id: "sig-1",
    signal_type: "health_factor",
    chain_id: DESK_CHAIN_ID,
    severity: 80,
    features: { hf: 1.15, totalCollateralUsd: 100, totalDebtUsd: 50 },
    sources: { pollKind: "aave_hf" },
    policy_verdict: "defend",
    dedupe_key: "hf:1.15:defend",
    created_at: "2026-08-01T00:00:00.000Z",
    signal_origin: "desk_read",
    source_dedupe_key: "hf:1.15:defend",
    ...overrides,
  };
}

function alertRow(overrides: Partial<PublicAlertRow> = {}): PublicAlertRow {
  return {
    id: "alert-1",
    monitored_event_id: null,
    title: "Desk health factor 1.150 → defend",
    summary: "test",
    source_references: ["desk:health_factor"],
    audience: "public",
    destinations: null,
    delivery_status: "queued",
    published_at: null,
    dedupe_key: "hf:1.15:defend",
    confidence: "high",
    generation_provider: null,
    generation_attempt_ids: [],
    registry_tx_hash: null,
    source_event_hash: null,
    content_uri: null,
    content_hash: null,
    gas_used: null,
    gas_used_wei: null,
    keeper_hub_run_id: null,
    explorer_url: null,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    alert_kind: "desk_trigger",
    chain_id: ACTIVE_INTELLIGENCE_CHAIN_ID,
    publication_chain_id: ACTIVE_INTELLIGENCE_CHAIN_ID,
    source_dedupe_key: "hf:1.15:defend",
    desk_signal_id: "sig-1",
    signal_type: "health_factor",
    signal_status: "created",
    policy_verdict: "defend",
    action_status: "pending",
    deterministic_evidence: { triggerLabel: "Health factor" },
    ...overrides,
  };
}

function memoryAlertRepo(seed: PublicAlertRow[] = []) {
  const rows = new Map<string, PublicAlertRow>(seed.map((r) => [r.id, { ...r }]));
  let seq = seed.length;

  const repo: PublicAlertRepository = {
    async create(data: PublicAlertInsert) {
      seq += 1;
      const id = `alert-${seq}`;
      const row: PublicAlertRow = {
        id,
        monitored_event_id: data.monitored_event_id ?? null,
        title: data.title,
        summary: data.summary,
        source_references: data.source_references,
        audience: data.audience ?? "public",
        destinations: null,
        delivery_status: data.delivery_status ?? "queued",
        published_at: data.published_at ?? null,
        dedupe_key: data.dedupe_key ?? null,
        confidence: data.confidence ?? null,
        generation_provider: null,
        generation_attempt_ids: [],
        registry_tx_hash: null,
        source_event_hash: null,
        content_uri: null,
        content_hash: null,
        gas_used: null,
        gas_used_wei: null,
        keeper_hub_run_id: null,
        explorer_url: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        alert_kind: data.alert_kind ?? "desk_trigger",
        chain_id: data.chain_id ?? ACTIVE_INTELLIGENCE_CHAIN_ID,
        publication_chain_id: data.publication_chain_id ?? ACTIVE_INTELLIGENCE_CHAIN_ID,
        source_dedupe_key: data.source_dedupe_key ?? null,
        desk_signal_id: data.desk_signal_id ?? null,
        signal_type: data.signal_type ?? null,
        signal_status: data.signal_status ?? "not_eligible",
        policy_verdict: data.policy_verdict ?? null,
        action_status: data.action_status ?? "not_created",
        intent_id: data.intent_id ?? null,
        ticket_id: data.ticket_id ?? null,
        transaction_hash: data.transaction_hash ?? null,
        deterministic_evidence: data.deterministic_evidence ?? {},
      };
      rows.set(id, row);
      return { ok: true as const, value: row };
    },
    async findById(id) {
      const row = rows.get(id);
      if (!row) {
        return {
          ok: false as const,
          error: new RepositoryError("NOT_FOUND", "not found", 404),
        };
      }
      return { ok: true as const, value: row };
    },
    async findByDedupeKey(key) {
      for (const row of rows.values()) {
        if (row.dedupe_key === key) return row;
      }
      return null;
    },
    async findBySourceDedupeKey(key) {
      for (const row of rows.values()) {
        if (row.source_dedupe_key === key) return row;
      }
      return null;
    },
    async findByIntentId(intentId) {
      for (const row of rows.values()) {
        if (row.intent_id === intentId) return row;
      }
      return null;
    },
    async findByTicketId(ticketId) {
      for (const row of rows.values()) {
        if (row.ticket_id === ticketId) return row;
      }
      return null;
    },
    async list() {
      return { ok: true as const, value: [...rows.values()] };
    },
    async listPage() {
      const items = [...rows.values()];
      return {
        ok: true as const,
        value: {
          items,
          page: 1,
          limit: 20,
          total: items.length,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      };
    },
    async updateDeliveryStatus(id, status, publishedAt) {
      const row = rows.get(id);
      if (!row) {
        return {
          ok: false as const,
          error: new RepositoryError("NOT_FOUND", "not found", 404),
        };
      }
      row.delivery_status = status as PublicAlertRow["delivery_status"];
      if (publishedAt) row.published_at = publishedAt;
      if (status === "published" && !row.published_at) {
        row.published_at = new Date().toISOString();
      }
      return { ok: true as const, value: row };
    },
    async updateGenerationMetadata(id) {
      const row = rows.get(id)!;
      return { ok: true as const, value: row };
    },
    async updateRegistryMetadata(id) {
      const row = rows.get(id)!;
      return { ok: true as const, value: row };
    },
    async updateContent(id, content) {
      const row = rows.get(id);
      if (!row) {
        return {
          ok: false as const,
          error: new RepositoryError("NOT_FOUND", "not found", 404),
        };
      }
      if (content.title) row.title = content.title;
      if (content.summary) row.summary = content.summary;
      if (content.deterministicEvidence) {
        row.deterministic_evidence = content.deterministicEvidence;
      }
      return { ok: true as const, value: row };
    },
    async updateCausalMetadata(id, metadata) {
      const row = rows.get(id);
      if (!row) {
        return {
          ok: false as const,
          error: new RepositoryError("NOT_FOUND", "not found", 404),
        };
      }
      if (metadata.deskSignalId !== undefined) row.desk_signal_id = metadata.deskSignalId;
      if (metadata.signalType !== undefined) row.signal_type = metadata.signalType;
      if (metadata.signalStatus !== undefined) row.signal_status = metadata.signalStatus;
      if (metadata.policyVerdict !== undefined) row.policy_verdict = metadata.policyVerdict;
      if (metadata.actionStatus !== undefined) row.action_status = metadata.actionStatus;
      if (metadata.intentId !== undefined) row.intent_id = metadata.intentId;
      if (metadata.ticketId !== undefined) row.ticket_id = metadata.ticketId;
      if (metadata.actionTransactionHash !== undefined) {
        row.action_transaction_hash = metadata.actionTransactionHash;
      }
      if (metadata.actionKeeperHubRunId !== undefined) {
        row.action_keeper_hub_run_id = metadata.actionKeeperHubRunId;
      }
      if (metadata.actionExplorerUrl !== undefined) {
        row.action_explorer_url = metadata.actionExplorerUrl;
      }
      return { ok: true as const, value: row };
    },
  };

  return { repo, rows };
}

function memorySignalRepo(seed: DeskSignalRow[] = []) {
  const rows = new Map<string, DeskSignalRow>(seed.map((r) => [r.id, { ...r }]));
  const repo: DeskSignalRepository = {
    async create(data) {
      const row: DeskSignalRow = {
        id: `sig-${rows.size + 1}`,
        signal_type: data.signal_type,
        chain_id: data.chain_id ?? DESK_CHAIN_ID,
        severity: data.severity ?? 0,
        features: data.features ?? {},
        sources: data.sources ?? {},
        policy_verdict: data.policy_verdict ?? "ignore",
        dedupe_key: data.dedupe_key,
        created_at: data.created_at ?? new Date().toISOString(),
        source_alert_id: data.source_alert_id ?? null,
        signal_origin: data.signal_origin ?? "desk_read",
        source_dedupe_key: data.source_dedupe_key ?? null,
      };
      rows.set(row.id, row);
      return { ok: true as const, value: row };
    },
    async findById(id) {
      return { ok: true as const, value: rows.get(id) ?? null };
    },
    async findByDedupeKey(key) {
      for (const r of rows.values()) {
        if (r.dedupe_key === key) return { ok: true as const, value: r };
      }
      return { ok: true as const, value: null };
    },
    async linkSourceAlertId(signalId, alertId, options) {
      const row = rows.get(signalId);
      if (!row) {
        return {
          ok: false as const,
          error: new RepositoryError("NOT_FOUND", "not found", 404),
        };
      }
      row.source_alert_id = alertId;
      row.signal_origin = options?.signalOrigin ?? "desk_read";
      return { ok: true as const, value: row };
    },
    async listRecent() {
      return { ok: true as const, value: [...rows.values()] };
    },
    async listByType(type) {
      return {
        ok: true as const,
        value: [...rows.values()].filter((r) => r.signal_type === type),
      };
    },
  };
  return { repo, rows };
}

describe("desk-trigger-alert pure helpers", () => {
  it("qualifies only non-ignore verdicts", () => {
    expect(shouldCreateAlertForVerdict("trade")).toBe(true);
    expect(shouldCreateAlertForVerdict("defend")).toBe(true);
    expect(shouldCreateAlertForVerdict("defer")).toBe(true);
    expect(shouldCreateAlertForVerdict("ignore")).toBe(false);
  });

  it("maps defer → deferred action status", () => {
    expect(actionStatusForVerdict("defer")).toBe("deferred");
    expect(actionStatusForVerdict("defend")).toBe("pending");
    expect(actionStatusForVerdict("trade")).toBe("pending");
  });

  it("allowlists desk-trigger signal and capital types", () => {
    expect(isDeskTriggerSignalType("health_factor")).toBe(true);
    expect(isDeskTriggerSignalType("manual")).toBe(false);
    expect(isDeskTriggerCapitalAction("topup")).toBe(true);
    expect(isDeskTriggerCapitalAction("none")).toBe(false);
  });

  it("redacts non-public feature keys", () => {
    const redacted = redactPublicEvidence({
      hf: 1.2,
      walletPrivateKey: "secret",
      rawReadResult: { balance: "0x" },
      basisBps: 40,
    });
    expect(redacted).toEqual({ hf: 1.2, basisBps: 40 });
    expect(redacted.walletPrivateKey).toBeUndefined();
  });

  it("builds deterministic health_factor copy", () => {
    const copy = buildSignalAlertCopy(signalRow());
    expect(copy.title).toContain("Position safety");
    expect(copy.title).toContain("protecting the position");
    expect(copy.summary).toContain("1.150");
    expect(copy.summary).toContain("safety score");
  });

  it("names ETH in oracle-basis copy", () => {
    const copy = buildSignalAlertCopy(
      signalRow({
        signal_type: "oracle_basis",
        policy_verdict: "defer",
        features: { basisBps: 229_935, oraclePrice: 1_862.15, ammPrice: 44_679.55 },
      }),
    );
    expect(copy.title).toContain("ETH");
    expect(copy.summary).toContain("price for ETH");
    expect(copy.summary).toContain("reference feed priced ETH");
  });

  it("builds capital topup copy without a Signal step implication", () => {
    const decision: CapitalDecision = {
      action: "topup",
      amountUsdc: 10,
      reason: "equity_below_target",
      direction: "topup",
    };
    const copy = buildCapitalAlertCopy(decision);
    expect(copy.title).toContain("Adding $10.00 to desk funds");
    expect(copy.summary).toContain("ready-to-use funds");
    expect(copy.summary).toContain("Chronicle Desk");
  });

  it("labels sources for UI without parsing evidence", () => {
    expect(deskTriggerSourceLabel({ signalType: "oracle_basis" })).toBe("Oracle basis");
    expect(deskTriggerSourceLabel({ capitalAction: "sweep" })).toBe("Capital sweep");
    expect(deskTriggerSourceLabel({ microtrade: true })).toBe("Event microtrade");
  });

  it("derives stable capital dedupe keys within the hour", () => {
    const decision: CapitalDecision = {
      action: "sweep",
      amountUsdc: 5.5,
      reason: "equity_above_max",
    };
    const a = capitalSourceDedupeKey(decision, 1_700_000_000_000);
    const b = capitalSourceDedupeKey(decision, 1_700_000_000_000 + 60_000);
    expect(a).toBe(b);
    expect(a).toContain("desk-capital:sweep");
  });
});

describe("createDeskTriggerAlertService", () => {
  it("health_factor with defend creates exactly one desk_trigger Alert", async () => {
    const { repo: alertRepo, rows: alertRows } = memoryAlertRepo();
    const { repo: signalRepo, rows: signalRows } = memorySignalRepo([signalRow()]);
    const publishAlert = vi.fn().mockResolvedValue({
      success: true,
      deliveryStatus: "published",
      message: "ok",
    });
    const publication: AlertPublicationService = { publishAlert };

    const service = createDeskTriggerAlertService({
      alertRepo,
      signalRepo,
      publicationService: publication,
    });

    const result = await service.createFromSignal({ signal: signalRow() });
    expect(result).not.toBeNull();
    expect(result!.created).toBe(true);
    expect(result!.alert.alert_kind).toBe("desk_trigger");
    expect(result!.alert.policy_verdict).toBe("defend");
    expect(result!.alert.signal_status).toBe("created");
    expect(alertRows.size).toBe(1);
    expect(signalRows.get("sig-1")?.source_alert_id).toBe(result!.alert.id);
    expect(publishAlert).toHaveBeenCalledOnce();
  });

  it("oracle_basis and apy_delta with trade create Alerts", async () => {
    const { repo: alertRepo } = memoryAlertRepo();
    const { repo: signalRepo } = memorySignalRepo();
    const service = createDeskTriggerAlertService({ alertRepo, signalRepo });

    const oracle = await service.createFromSignal({
      signal: signalRow({
        id: "sig-oracle",
        signal_type: "oracle_basis",
        policy_verdict: "trade",
        dedupe_key: "oracle:40",
        source_dedupe_key: "oracle:40",
        features: { basisBps: 40, oraclePrice: 3000, ammPrice: 3012 },
      }),
    });
    const apy = await service.createFromSignal({
      signal: signalRow({
        id: "sig-apy",
        signal_type: "apy_delta",
        policy_verdict: "trade",
        dedupe_key: "apy:120",
        source_dedupe_key: "apy:120",
        features: { apyDeltaBps: 120, aaveSupplyApyBps: 500, idleUsdcApyBps: 0 },
      }),
    });

    expect(oracle?.alert.alert_kind).toBe("desk_trigger");
    expect(oracle?.alert.signal_type).toBe("oracle_basis");
    expect(apy?.alert.signal_type).toBe("apy_delta");
    expect(apy?.alert.action_status).toBe("pending");
  });

  it("gas_regime with defer creates Alert with action_status deferred", async () => {
    const { repo: alertRepo } = memoryAlertRepo();
    const service = createDeskTriggerAlertService({ alertRepo });

    const result = await service.createFromSignal({
      signal: signalRow({
        signal_type: "gas_regime",
        policy_verdict: "defer",
        dedupe_key: "gas:critical",
        source_dedupe_key: "gas:critical",
        features: { gasGwei: 120, gasRegime: "critical" },
      }),
    });

    expect(result?.alert.action_status).toBe("deferred");
    expect(result?.alert.policy_verdict).toBe("defer");
  });

  it("ignore signals create no Desk-trigger Alert", async () => {
    const { repo: alertRepo, rows } = memoryAlertRepo();
    const service = createDeskTriggerAlertService({ alertRepo });

    const result = await service.createFromSignal({
      signal: signalRow({ policy_verdict: "ignore" }),
    });

    expect(result).toBeNull();
    expect(rows.size).toBe(0);
  });

  it("duplicate polls reuse the existing Alert", async () => {
    const { repo: alertRepo, rows } = memoryAlertRepo();
    const { repo: signalRepo } = memorySignalRepo([signalRow()]);
    const service = createDeskTriggerAlertService({ alertRepo, signalRepo });

    const first = await service.createFromSignal({ signal: signalRow() });
    const second = await service.createFromSignal({
      signal: signalRow({ id: "sig-2" }),
    });

    expect(first?.created).toBe(true);
    expect(second?.deduped).toBe(true);
    expect(second?.alert.id).toBe(first?.alert.id);
    expect(rows.size).toBe(1);
  });

  it("capital topup/sweep/free_inventory/emergency_return create Alerts before execution", async () => {
    const { repo: alertRepo, rows } = memoryAlertRepo();
    const service = createDeskTriggerAlertService({ alertRepo });

    for (const action of ["topup", "sweep", "free_inventory", "emergency_return"] as const) {
      const result = await service.createFromCapital({
        decision: {
          action,
          amountUsdc: 12,
          reason: `test_${action}`,
        },
        dedupeKey: `test-capital:${action}`,
      });
      expect(result?.created).toBe(true);
      expect(result?.alert.alert_kind).toBe("desk_trigger");
      expect(result?.alert.signal_status).toBe("not_eligible");
      expect(result?.alert.action_status).toBe("pending");
      expect(result?.alert.deterministic_evidence?.capitalAction).toBe(action);
    }

    expect(rows.size).toBe(4);

    const none = await service.createFromCapital({
      decision: { action: "none", amountUsdc: 0, reason: "no_action" },
    });
    expect(none).toBeNull();
  });

  it("event microtrade reuses an existing market Alert instead of duplicating", async () => {
    const market = alertRow({
      id: "market-1",
      alert_kind: "market_event",
      title: "Large swap observed",
      source_dedupe_key: "market:swap:1",
      signal_status: "created",
      deterministic_evidence: {},
    });
    const { repo: alertRepo, rows } = memoryAlertRepo([market]);
    const service = createDeskTriggerAlertService({ alertRepo });

    const result = await service.createOrAttachForMicrotrade({
      existingAlertId: "market-1",
      monitoredEventId: "event-1",
      eventType: "large_swap",
      notionalUsdc: 5,
      strategy: "yield_rotation",
      mode: "maintenance_rebalance",
    });

    expect(result?.deduped).toBe(true);
    expect(result?.alert.id).toBe("market-1");
    expect(rows.size).toBe(1);
  });

  it("publication failure does not throw and still returns the Alert", async () => {
    const { repo: alertRepo, rows } = memoryAlertRepo();
    const publishAlert = vi.fn().mockRejectedValue(new Error("registry down"));
    const service = createDeskTriggerAlertService({
      alertRepo,
      publicationService: { publishAlert },
    });

    const result = await service.createFromSignal({ signal: signalRow() });
    expect(result).not.toBeNull();
    expect(result!.alert.id).toBeTruthy();
    expect(result!.publicationOk).toBe(false);
    expect(result!.publicationAttempted).toBe(true);
    expect(rows.size).toBe(1);
  });

  it("execution callbacks update the linked Alert using intent_id", async () => {
    const existing = alertRow({ id: "alert-cap", intent_id: null });
    const { repo: alertRepo } = memoryAlertRepo([existing]);
    const service = createDeskTriggerAlertService({ alertRepo });

    await service.updateAfterExecution("alert-cap", {
      actionStatus: "pending",
      intentId: "intent-99",
    });

    const byIntent = await service.findByIntentId("intent-99");
    expect(byIntent?.id).toBe("alert-cap");

    await service.updateAfterExecution("alert-cap", {
      actionStatus: "filled",
      intentId: "intent-99",
      ticketId: "ticket-7",
      actionTransactionHash: "0xabc",
      actionKeeperHubRunId: "run-1",
      actionExplorerUrl: "https://sepolia.etherscan.io/tx/0xabc",
    });

    const byTicket = await service.findByTicketId("ticket-7");
    expect(byTicket?.action_status).toBe("filled");
    expect(byTicket?.action_transaction_hash).toBe("0xabc");
  });

  it("sourceTriggerLabelFromAlert returns typed labels for desk triggers", () => {
    expect(sourceTriggerLabelFromAlert(alertRow())).toBe("Health factor");
    expect(
      sourceTriggerLabelFromAlert(
        alertRow({
          alert_kind: "market_event",
          deterministic_evidence: {},
        }),
      ),
    ).toBeUndefined();
    expect(
      sourceTriggerLabelFromAlert(
        alertRow({
          deterministic_evidence: { capitalAction: "topup" },
          signal_type: "capital_tick",
        }),
      ),
    ).toBe("Capital top-up");
  });

  it("signalSourceDedupeKey prefers source_dedupe_key", () => {
    expect(signalSourceDedupeKey(signalRow())).toBe("hf:1.15:defend");
    expect(
      signalSourceDedupeKey(
        signalRow({ source_dedupe_key: null, dedupe_key: "fallback-key" }),
      ),
    ).toBe("fallback-key");
  });
});
