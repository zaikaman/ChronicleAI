// Unit tests for type-diverse digest event selection

import { describe, expect, it } from "vitest";
import type { MonitoredEventRow } from "@chronicleai/db";
import { selectDiverseEvents } from "../services/digest-event-selection-service.ts";

function row(
  id: string,
  eventType: MonitoredEventRow["event_type"],
  score: number,
): MonitoredEventRow {
  return {
    id,
    source: "keeperhub",
    source_event_id: id,
    event_type: eventType,
    chain_id: 1,
    protocol: null,
    asset_symbols: null,
    magnitude: { value: score * 1_000_000, unit: "USD" },
    transaction_hash: null,
    observed_at: null,
    captured_at: new Date().toISOString(),
    raw_payload: {},
    status: "qualified",
    significance_score: score,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

describe("selectDiverseEvents", () => {
  it("includes best of each type even when swaps dominate by score", () => {
    const events = [
      row("s1", "large_swap", 0.99),
      row("s2", "large_swap", 0.98),
      row("s3", "large_swap", 0.97),
      row("s4", "large_swap", 0.96),
      row("s5", "large_swap", 0.95),
      row("cex", "cex_inflow", 0.5),
      row("mint", "stablecoin_mint", 0.4),
      row("liq", "liquidation", 0.3),
      row("cluster", "liquidation_cluster", 0.6),
    ];

    const selected = selectDiverseEvents(events, 8);
    const types = new Set(selected.map((e) => e.event_type));

    expect(types.has("cex_inflow")).toBe(true);
    expect(types.has("stablecoin_mint")).toBe(true);
    expect(types.has("liquidation")).toBe(true);
    expect(types.has("liquidation_cluster")).toBe(true);

    const swapCount = selected.filter((e) => e.event_type === "large_swap").length;
    // Cap applies while non-swap types still compete for slots (~40%)
    expect(swapCount).toBeLessThanOrEqual(Math.max(1, Math.ceil(8 * 0.4)));
    // Non-swap diversity still present
    expect(selected.length).toBeGreaterThan(swapCount);
  });

  it("fills by significance when diversity types are sparse", () => {
    const events = [
      row("s1", "large_swap", 0.9),
      row("s2", "large_swap", 0.8),
      row("g1", "gas_spike", 0.7),
    ];
    const selected = selectDiverseEvents(events, 3);
    expect(selected).toHaveLength(3);
  });

  it("returns empty for empty input", () => {
    expect(selectDiverseEvents([], 10)).toEqual([]);
  });
});
