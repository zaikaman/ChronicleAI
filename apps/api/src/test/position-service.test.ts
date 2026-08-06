import { describe, expect, it } from "vitest";
import { NO_DEBT_HEALTH_FACTOR, parseHealthFactor } from "../desk/position-service.ts";

describe("Aave health-factor normalization", () => {
  it("maps Aave's max uint no-debt value to the public finite sentinel", () => {
    expect(parseHealthFactor(2n ** 256n - 1n)).toBe(NO_DEBT_HEALTH_FACTOR);
  });

  it("preserves finite ray values", () => {
    expect(parseHealthFactor(125n * 10n ** 16n)).toBeCloseTo(1.25, 8);
  });

  it("preserves a zero health factor", () => {
    expect(parseHealthFactor(0n)).toBe(0);
  });
});
