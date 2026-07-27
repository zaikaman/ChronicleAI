// Unit tests: Treasury Status Service
// Tests healthy, warning, critical transitions, and registry write suspension

import { describe, expect, it } from "vitest";
import { createTreasuryStatusService } from "../services/treasury-status-service.ts";

const service = createTreasuryStatusService();

describe("TreasuryStatusService", () => {
  describe("evaluate", () => {
    it("should return healthy when balance is above safety buffer", () => {
      const result = service.evaluate({
        availableBalance: 50000,
        safetyBuffer: 10000,
      });

      expect(result.status).toBe("healthy");
      expect(result.changed).toBe(false);
      expect(result.deficitPercentage).toBeUndefined();
    });

    it("should return warning when balance is below safety buffer but above critical threshold", () => {
      const result = service.evaluate({
        availableBalance: 7000,
        safetyBuffer: 10000,
      });

      expect(result.status).toBe("warning");
      expect(result.deficitPercentage).toBeDefined();
      expect(result.deficitPercentage).toBeGreaterThan(0);
    });

    it("should return critical when balance is below critical threshold (50% of safety buffer)", () => {
      const result = service.evaluate({
        availableBalance: 3000,
        safetyBuffer: 10000,
      });

      expect(result.status).toBe("critical");
      expect(result.deficitPercentage).toBeDefined();
      expect(result.deficitPercentage).toBeGreaterThan(0);
    });

    it("should return critical when balance is zero", () => {
      const result = service.evaluate({
        availableBalance: 0,
        safetyBuffer: 10000,
      });

      expect(result.status).toBe("critical");
    });

    it("should return critical when balance is negative", () => {
      const result = service.evaluate({
        availableBalance: -1000,
        safetyBuffer: 10000,
      });

      expect(result.status).toBe("critical");
    });

    it("should detect status change from healthy to warning", () => {
      const result = service.evaluate({
        availableBalance: 7000,
        safetyBuffer: 10000,
        previousStatus: "healthy",
      });

      expect(result.status).toBe("warning");
      expect(result.changed).toBe(true);
      expect(result.previousStatus).toBe("healthy");
    });

    it("should detect no change when status stays the same", () => {
      const result = service.evaluate({
        availableBalance: 50000,
        safetyBuffer: 10000,
        previousStatus: "healthy",
      });

      expect(result.status).toBe("healthy");
      expect(result.changed).toBe(false);
    });

    it("should detect change from warning to critical", () => {
      const result = service.evaluate({
        availableBalance: 1000,
        safetyBuffer: 10000,
        previousStatus: "warning",
      });

      expect(result.status).toBe("critical");
      expect(result.changed).toBe(true);
    });

    it("should handle edge case where balance exactly equals safety buffer", () => {
      const result = service.evaluate({
        availableBalance: 10000,
        safetyBuffer: 10000,
      });

      expect(result.status).toBe("healthy");
    });

    it("should handle edge case where balance is exactly at critical threshold", () => {
      const result = service.evaluate({
        availableBalance: 5000,
        safetyBuffer: 10000,
      });

      expect(result.status).toBe("warning");
    });
  });

  describe("shouldSuspendRegistryWrites", () => {
    it("should suspend when balance is below safety buffer", () => {
      const result = service.shouldSuspendRegistryWrites(5000, 10000);
      expect(result).toBe(true);
    });

    it("should not suspend when balance is above safety buffer", () => {
      const result = service.shouldSuspendRegistryWrites(15000, 10000);
      expect(result).toBe(false);
    });

    it("should not suspend when balance equals safety buffer", () => {
      const result = service.shouldSuspendRegistryWrites(10000, 10000);
      expect(result).toBe(false);
    });

    it("should suspend when balance is zero", () => {
      const result = service.shouldSuspendRegistryWrites(0, 10000);
      expect(result).toBe(true);
    });
  });

  describe("shouldRouteRevenue", () => {
    it("should allow routing when balance exceeds safety buffer and revenue is positive", () => {
      const result = service.shouldRouteRevenue(20000, 10000, 5000);
      expect(result.canRoute).toBe(true);
    });

    it("should deny routing when balance is below safety buffer", () => {
      const result = service.shouldRouteRevenue(5000, 10000, 5000);
      expect(result.canRoute).toBe(false);
      expect(result.reason).toBeDefined();
      expect(result.reason).toContain("below safety buffer");
    });

    it("should deny routing when revenue is zero", () => {
      const result = service.shouldRouteRevenue(20000, 10000, 0);
      expect(result.canRoute).toBe(false);
      expect(result.reason).toContain("No positive revenue");
    });

    it("should deny routing when revenue is negative", () => {
      const result = service.shouldRouteRevenue(20000, 10000, -1000);
      expect(result.canRoute).toBe(false);
    });
  });
});
