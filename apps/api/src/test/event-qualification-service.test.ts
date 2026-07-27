// Unit tests for event qualification service

import { describe, expect, it } from "vitest";
import { createEventQualificationService } from "../services/event-qualification-service.ts";

describe("EventQualificationService", () => {
  const service = createEventQualificationService();

  it("qualifies large_swap above threshold", () => {
    const result = service.qualify({
      eventType: "large_swap",
      magnitude: { value: 2_000_000, unit: "USD" },
      chainId: 1,
    });

    expect(result.qualified).toBe(true);
    expect(result.score).toBeGreaterThan(0);
  });

  it("ignores large_swap below threshold", () => {
    const result = service.qualify({
      eventType: "large_swap",
      magnitude: { value: 100, unit: "USD" },
      chainId: 1,
    });

    expect(result.qualified).toBe(false);
    expect(result.score).toBe(0);
  });

  it("qualifies liquidation above threshold", () => {
    const result = service.qualify({
      eventType: "liquidation",
      magnitude: { value: 1_000_000, unit: "USD" },
      chainId: 1,
    });

    expect(result.qualified).toBe(true);
  });

  it("ignores liquidation below threshold", () => {
    const result = service.qualify({
      eventType: "liquidation",
      magnitude: { value: 100, unit: "USD" },
      chainId: 1,
    });

    expect(result.qualified).toBe(false);
  });

  it("qualifies gas_spike above threshold", () => {
    const result = service.qualify({
      eventType: "gas_spike",
      magnitude: { value: 600, unit: "gwei" },
      chainId: 1,
    });

    expect(result.qualified).toBe(true);
  });

  it("qualifies contract_deployment by default", () => {
    const result = service.qualify({
      eventType: "contract_deployment",
      chainId: 137,
    });

    expect(result.qualified).toBe(true);
    expect(result.score).toBeGreaterThan(0);
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
});
