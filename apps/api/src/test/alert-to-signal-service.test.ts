import { ACTIVE_INTELLIGENCE_CHAIN_ID } from "@chronicleai/config";
import type { MonitoredEventRow, PublicAlertRepository, PublicAlertRow } from "@chronicleai/db";
import { describe, expect, it } from "vitest";
import type { SignalEngine } from "../desk/signal-engine.ts";
import type { DeskSignalInput, DeskSignalRecord } from "../desk/types.ts";
import { createAlertToSignalService } from "../services/alert-to-signal-service.ts";

const ZERO = "0x0000000000000000000000000000000000000000";

function alertRow(id = "alert-1"): PublicAlertRow {
  return {
    id,
    monitored_event_id: "event-1",
    title: "Aave liquidation observed",
    summary: "deterministic shell",
    source_references: [],
    audience: "public",
    destinations: null,
    delivery_status: "queued",
    published_at: null,
    dedupe_key: "alert-dedupe",
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
    source_dedupe_key: "source-1",
    signal_status: "pending",
    action_status: "pending",
    transaction_hash: "0xsource",
    deterministic_evidence: {},
  };
}

function eventRow(overrides: Partial<MonitoredEventRow> = {}): MonitoredEventRow {
  return {
    id: "event-1",
    source: "keeperhub",
    source_event_id: "sepolia-tx-1-0",
    event_type: "liquidation",
    chain_id: ACTIVE_INTELLIGENCE_CHAIN_ID,
    protocol: "Aave V3",
    asset_symbols: ["USDC", "WETH"],
    magnitude: { value: 125_000, unit: "USD" },
    transaction_hash: "0xsource",
    observed_at: null,
    captured_at: "2026-08-01T00:00:00.000Z",
    significance_score: 0.95,
    raw_payload: { args: { user: "0xuser" } },
    status: "qualified",
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    block_number: 100,
    block_hash: "0xblock",
    log_index: 0,
    source_contract: "0xaave",
    normalized_evidence: { severity: 0.95 },
    source_dedupe_key: "sepolia:liquidation:sepolia-tx-1-0",
    ...overrides,
  };
}

function testHarness() {
  const updates: Array<{ id: string; metadata: Record<string, unknown> }> = [];
  const inputs: DeskSignalInput[] = [];
  const alert = alertRow();
  const signal = {
    id: "signal-1",
    signal_type: "liquidation_cluster",
    chain_id: ACTIVE_INTELLIGENCE_CHAIN_ID,
    severity: 95,
    features: {},
    sources: {},
    policy_verdict: "defend",
    dedupe_key: "alert:alert-1",
    created_at: "2026-08-01T00:00:00.000Z",
    source_alert_id: alert.id,
    source_event_id: "sepolia-tx-1-0",
    signal_origin: "alert",
    source_dedupe_key: "source-1",
    source_evidence: {},
  } as const;
  const engine = {
    ingest: async (input: DeskSignalInput) => {
      inputs.push(input);
      const signalType = input.signalType;
      const policyVerdict = signalType === "event_supply" ? "ignore" : "defend";
      return {
        signal: {
          signalType,
          chainId: ACTIVE_INTELLIGENCE_CHAIN_ID,
          severity: signalType === "event_supply" ? 10 : 95,
          policyVerdict,
          features: input.features,
          sources: input.sources,
          dedupeKey: input.dedupeKey,
          createdAt: "2026-08-01T00:00:00.000Z",
        } as DeskSignalRecord,
        row: signal,
        deduped: false,
      };
    },
  } as unknown as SignalEngine;
  const alertRepo = {
    updateCausalMetadata: async (id: string, metadata: Record<string, unknown>) => {
      updates.push({ id, metadata });
      return { ok: true, value: alert };
    },
  } as unknown as PublicAlertRepository;

  return {
    service: createAlertToSignalService({ alertRepo, signalEngine: engine }),
    updates,
    inputs,
  };
}

describe("AlertToSignalService", () => {
  it("projects a Sepolia liquidation into exactly one risk-defend signal with evidence", async () => {
    const harness = testHarness();
    const result = await harness.service.project({
      alert: alertRow(),
      event: eventRow(),
    });

    expect(result).toMatchObject({
      status: "created",
      signalId: "signal-1",
      signalType: "liquidation_cluster",
      policyVerdict: "defend",
      actionStatus: "pending",
    });
    expect(harness.inputs).toHaveLength(1);
    expect(harness.inputs[0]).toMatchObject({
      chainId: ACTIVE_INTELLIGENCE_CHAIN_ID,
      dedupeKey: "alert:alert-1",
      sourceAlertId: "alert-1",
      sourceEventId: "sepolia-tx-1-0",
      signalOrigin: "alert",
    });
    expect(harness.inputs[0]?.sourceEvidence).toMatchObject({
      eventType: "liquidation",
      chainId: ACTIVE_INTELLIGENCE_CHAIN_ID,
      blockNumber: 100,
      logIndex: 0,
    });
    expect(harness.updates[0]).toMatchObject({
      id: "alert-1",
      metadata: {
        deskSignalId: "signal-1",
        signalStatus: "created",
        policyVerdict: "defend",
        actionStatus: "pending",
      },
    });
  });

  it("keeps supply observations visible but explicitly non-trading", async () => {
    const harness = testHarness();
    const result = await harness.service.project({
      alert: alertRow(),
      event: eventRow({
        event_type: "stablecoin_mint",
        asset_symbols: ["USDC"],
        raw_payload: { args: { from: ZERO, to: "0xuser" } },
      }),
    });

    expect(result).toMatchObject({
      status: "created",
      signalType: "event_supply",
      actionStatus: "ignored",
    });
    expect(harness.inputs[0]?.signalType).toBe("event_supply");
    expect(harness.updates[0]?.metadata).toMatchObject({
      signalType: "event_supply",
      actionStatus: "ignored",
    });
  });

  it("rejects Mainnet observations from the executable projection path", async () => {
    const harness = testHarness();
    const result = await harness.service.project({
      alert: alertRow(),
      event: eventRow({ chain_id: 1 }),
    });

    expect(result).toMatchObject({
      status: "not_eligible",
      actionStatus: "ignored",
    });
    expect(harness.inputs).toHaveLength(0);
    expect(harness.updates[0]?.metadata).toMatchObject({
      signalStatus: "not_eligible",
      actionStatus: "ignored",
    });
  });
});
