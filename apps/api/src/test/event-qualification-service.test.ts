// Unit tests for event qualification service

import { describe, expect, it } from "vitest";
import { createEventQualificationService } from "../services/event-qualification-service.ts";

describe("EventQualificationService", () => {
  const service = createEventQualificationService();

  it("qualifies large_swap above threshold", () => {
    const result = service.qualify({
      eventType: "large_swap",
      magnitude: { value: 2_500_000, unit: "USD" },
      chainId: 1,
    });

    expect(result.qualified).toBe(true);
    expect(result.score).toBeGreaterThan(0);
  });

  it("ignores large_swap below threshold", () => {
    const result = service.qualify({
      eventType: "large_swap",
      magnitude: { value: 50_000, unit: "USD" },
      chainId: 1,
    });

    expect(result.qualified).toBe(false);
    expect(result.score).toBe(0);
  });

  it("qualifies liquidation above threshold", () => {
    const result = service.qualify({
      eventType: "liquidation",
      magnitude: { value: 2_500_000, unit: "USD" },
      chainId: 1,
    });

    expect(result.qualified).toBe(true);
  });

  it("qualifies liquidation above dust threshold", () => {
    const result = service.qualify({
      eventType: "liquidation",
      magnitude: { value: 0.01, unit: "USD" },
      chainId: 1,
    });

    expect(result.qualified).toBe(true);
  });

  it("ignores liquidation below dust threshold", () => {
    const result = service.qualify({
      eventType: "liquidation",
      magnitude: { value: 0.009, unit: "USD" },
      chainId: 1,
    });

    expect(result.qualified).toBe(false);
  });

  it("ignores non-positive liquidation magnitude", () => {
    const result = service.qualify({
      eventType: "liquidation",
      magnitude: { value: 0, unit: "USD" },
      chainId: 1,
    });

    expect(result.qualified).toBe(false);
  });

  it("qualifies gas_spike above threshold", () => {
    const result = service.qualify({
      eventType: "gas_spike",
      magnitude: { value: 75, unit: "gwei" },
      chainId: 1,
    });

    expect(result.qualified).toBe(true);
  });

  it("ignores gas_spike below threshold", () => {
    const result = service.qualify({
      eventType: "gas_spike",
      magnitude: { value: 25, unit: "gwei" },
      chainId: 1,
    });

    expect(result.qualified).toBe(false);
  });

  it("does not auto-qualify contract_deployment (noise control)", () => {
    const result = service.qualify({
      eventType: "contract_deployment",
      chainId: 137,
    });

    expect(result.qualified).toBe(false);
    expect(result.score).toBe(0);
    expect(result.reason).toContain("not auto-qualified");
  });

  it("ignores events with missing magnitude for threshold-based types", () => {
    const result = service.qualify({
      eventType: "large_swap",
      chainId: 1,
    });

    expect(result.qualified).toBe(false);
    expect(result.reason).toContain("Missing magnitude");
  });

  it("ignores unsupported event types", () => {
    const result = service.qualify({
      eventType: "unknown_type" as never,
      chainId: 1,
    });

    expect(result.qualified).toBe(false);
    expect(result.reason).toContain("Unsupported event type");
  });

  it("qualifies cex_inflow above $500k", () => {
    const result = service.qualify({
      eventType: "cex_inflow",
      magnitude: { value: 600_000, unit: "USD" },
      chainId: 1,
    });
    expect(result.qualified).toBe(true);
  });

  it("ignores cex_outflow below threshold", () => {
    const result = service.qualify({
      eventType: "cex_outflow",
      magnitude: { value: 100_000, unit: "USD" },
      chainId: 1,
    });
    expect(result.qualified).toBe(false);
  });

  it("qualifies stablecoin_mint at $1M+", () => {
    expect(
      service.qualify({
        eventType: "stablecoin_mint",
        magnitude: { value: 1_000_000, unit: "USD" },
        chainId: 1,
      }).qualified,
    ).toBe(true);
    expect(
      service.qualify({
        eventType: "stablecoin_mint",
        magnitude: { value: 999_999, unit: "USD" },
        chainId: 1,
      }).qualified,
    ).toBe(false);
  });

  it("qualifies protocol_deposit and protocol_withdraw at $1B+", () => {
    expect(
      service.qualify({
        eventType: "protocol_deposit",
        magnitude: { value: 1_000_000_000, unit: "USD" },
        chainId: 11_155_111,
      }).qualified,
    ).toBe(true);
    expect(
      service.qualify({
        eventType: "protocol_withdraw",
        magnitude: { value: 999_999_999, unit: "USD" },
        chainId: 11_155_111,
      }).qualified,
    ).toBe(false);
  });

  it("requires dual gate for liquidation_cluster (count + notional)", () => {
    expect(
      service.qualify({
        eventType: "liquidation_cluster",
        magnitude: { value: 100_000, unit: "USD" },
        chainId: 1,
        clusterCount: 2,
      }).qualified,
    ).toBe(false);

    expect(
      service.qualify({
        eventType: "liquidation_cluster",
        magnitude: { value: 40_000, unit: "USD" },
        chainId: 1,
        clusterCount: 5,
      }).qualified,
    ).toBe(false);

    expect(
      service.qualify({
        eventType: "liquidation_cluster",
        magnitude: { value: 50_000, unit: "USD" },
        chainId: 1,
        clusterCount: 3,
      }).qualified,
    ).toBe(true);
  });
});
