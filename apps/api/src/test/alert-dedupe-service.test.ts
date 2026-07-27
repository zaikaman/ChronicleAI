// Unit tests for alert deduplication service

import { describe, it, expect } from "vitest";
import { createAlertDedupeService } from "../services/alert-dedupe-service.ts";

describe("AlertDedupeService", () => {
  const service = createAlertDedupeService();

  it("generates dedupe key from sourceEventId", () => {
    const key = service.generateDedupeKey({
      sourceEventId: "whale-001",
      source: "keeperhub",
      eventType: "large_swap",
    });

    expect(key).toBe("keeperhub-whale-001-large_swap");
  });

  it("generates dedupe key without sourceEventId", () => {
    const key = service.generateDedupeKey({
      sourceEventId: null,
      source: "test",
      eventType: "liquidation" as const,
    });

    expect(key).toContain("test-");
    expect(key).toContain("-liquidation");
  });

  it("detects events within dedupe window", () => {
    const recent = new Date(Date.now() - 60_000).toISOString(); // 1 minute ago
    expect(service.isWithinWindow(recent)).toBe(true);
  });

  it("detects events outside dedupe window", () => {
    const old = new Date(Date.now() - 200_000_000).toISOString(); // ~2.3 days ago
    expect(service.isWithinWindow(old)).toBe(false);
  });

  it("generates deterministic dedupe keys for same inputs", () => {
    const params = {
      sourceEventId: "test-123",
      source: "keeperhub",
      eventType: "gas_spike" as const,
    };

    const key1 = service.generateDedupeKey(params);
    const key2 = service.generateDedupeKey(params);

    expect(key1).toBe(key2);
  });
});
