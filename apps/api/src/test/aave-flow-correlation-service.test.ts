import type {
  MonitoredEventRepository,
  MonitoredEventRow,
  PublicAlertRepository,
  PublicAlertRow,
} from "@chronicleai/db";
import { describe, expect, it, vi } from "vitest";
import {
  createAaveFlowCorrelationService,
  extractAaveFlowIdentity,
  isAaveFlowPair,
} from "../services/aave-flow-correlation-service.ts";

const RESERVE = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const POOL = "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2";
const USER = "0x9205A569B0ff45dF1E4f5ae48E21bC7F0656f0BB";
const AMOUNT = "309962173269145419775";

function makeEvent(
  eventType: "protocol_deposit" | "protocol_withdraw",
  overrides: Partial<MonitoredEventRow> = {},
): MonitoredEventRow {
  return {
    id: `${eventType}-event`,
    source: "keeperhub",
    source_event_id: `1:${eventType}-source`,
    event_type: eventType,
    chain_id: 1,
    protocol: "Aave V3",
    asset_symbols: ["WETH"],
    magnitude: { value: 581_000, unit: "USD" },
    transaction_hash: `0x${eventType}-tx`,
    observed_at: null,
    captured_at: "2026-08-02T06:06:00.000Z",
    significance_score: 0.8,
    raw_payload: {
      args: {
        reserve: RESERVE,
        user: USER,
        onBehalfOf: USER,
        to: USER,
        amount: AMOUNT,
      },
      flowContext: {
        fromRole: eventType === "protocol_deposit" ? "unknown" : "protocol",
        toRole: eventType === "protocol_deposit" ? "protocol" : "unknown",
        direction: eventType === "protocol_deposit" ? "rebalance" : "de_risk",
        subjectAddress: USER,
        counterpartyAddress: POOL,
        venue: "Aave V3",
      },
    },
    block_number: 25_665_298,
    block_hash: "0xblock",
    log_index: 0,
    source_contract: POOL,
    normalized_evidence: {},
    source_dedupe_key: `1:${eventType}:source`,
    status: "qualified",
    created_at: "2026-08-02T06:06:00.000Z",
    updated_at: "2026-08-02T06:06:00.000Z",
    ...overrides,
  };
}

function makeAlert(monitoredEventId: string): PublicAlertRow {
  return {
    id: `${monitoredEventId}-alert`,
    monitored_event_id: monitoredEventId,
    title: "Aave V3 protocol flow",
    summary: "Aave V3 protocol flow observed",
    source_references: [],
    audience: "public",
    destinations: null,
    delivery_status: "published",
    published_at: "2026-08-02T06:06:01.000Z",
    dedupe_key: "dedupe",
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
    created_at: "2026-08-02T06:06:00.000Z",
    updated_at: "2026-08-02T06:06:01.000Z",
    deterministic_evidence: {},
  };
}

describe("AaveFlowCorrelationService", () => {
  it("matches opposite same-block flows for the same wallet, reserve, pool, and amount", () => {
    const withdraw = makeEvent("protocol_withdraw");
    const supply = makeEvent("protocol_deposit");

    expect(isAaveFlowPair(supply, withdraw)).toBe(true);
    expect(extractAaveFlowIdentity(supply)).toMatchObject({
      eventType: "protocol_deposit",
      chainId: 1,
      sourceContract: POOL.toLowerCase(),
      subjectAddress: USER.toLowerCase(),
      assetKey: `reserve:${RESERVE.toLowerCase()}`,
      amountAtomic: AMOUNT,
      blockNumber: 25_665_298,
    });
  });

  it("does not match a different wallet, reserve amount, or event direction", () => {
    const withdraw = makeEvent("protocol_withdraw");
    expect(
      isAaveFlowPair(
        makeEvent("protocol_deposit", {
          raw_payload: {
            args: { reserve: RESERVE, user: "0x1111111111111111111111111111111111111111", amount: AMOUNT },
          },
        }),
        withdraw,
      ),
    ).toBe(false);
    expect(
      isAaveFlowPair(
        makeEvent("protocol_deposit", {
          raw_payload: {
            args: { reserve: RESERVE, user: USER, amount: "1" },
          },
        }),
        withdraw,
      ),
    ).toBe(false);
    expect(isAaveFlowPair(makeEvent("protocol_deposit"), makeEvent("protocol_deposit"))).toBe(false);
  });

  it("allows the timestamp fallback only when block numbers are unavailable", () => {
    const withdraw = makeEvent("protocol_withdraw", {
      block_number: null,
      captured_at: "2026-08-02T06:06:00.000Z",
    });
    expect(
      isAaveFlowPair(
        makeEvent("protocol_deposit", {
          block_number: null,
          captured_at: "2026-08-02T06:07:00.000Z",
        }),
        withdraw,
      ),
    ).toBe(true);
    expect(
      isAaveFlowPair(
        makeEvent("protocol_deposit", {
          block_number: null,
          captured_at: "2026-08-02T06:09:00.001Z",
        }),
        withdraw,
      ),
    ).toBe(false);
    expect(
      isAaveFlowPair(
        makeEvent("protocol_deposit", {
          block_number: 25_665_299,
          captured_at: "2026-08-02T06:06:01.000Z",
        }),
        makeEvent("protocol_withdraw", {
          block_number: 25_665_298,
          captured_at: "2026-08-02T06:06:00.000Z",
        }),
      ),
    ).toBe(false);
  });

  it("returns the existing alert anchor for a matched counterpart", async () => {
    const current = makeEvent("protocol_deposit");
    const counterpart = makeEvent("protocol_withdraw", { id: "withdraw-counterpart" });
    const listInWindow = vi.fn().mockResolvedValue({ ok: true, value: [current, counterpart] });
    const listByEventIds = vi.fn().mockResolvedValue({
      ok: true,
      value: [makeAlert(counterpart.id)],
    });
    const service = createAaveFlowCorrelationService({
      eventRepo: { listInWindow } as unknown as MonitoredEventRepository,
      alertRepo: { listByEventIds } as unknown as PublicAlertRepository,
    });

    const result = await service.findPair(current);

    expect(result).toMatchObject({
      currentEvent: current,
      counterpartEvent: counterpart,
      matchKind: "same_block",
      counterpartAlert: { monitored_event_id: counterpart.id },
    });
    expect(listByEventIds).toHaveBeenCalledWith([counterpart.id]);
  });
});
