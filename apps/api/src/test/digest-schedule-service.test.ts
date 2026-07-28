import { describe, expect, it } from "vitest";
import {
  computePreviousUtcDayWindow,
  isPreviousUtcDayWindowReady,
  resolveDigestRunWindow,
} from "../services/digest-schedule-service.ts";

describe("digest-schedule-service", () => {
  it("computes previous completed UTC day bounds", () => {
    const now = new Date("2026-07-28T08:15:00.000Z");
    const window = computePreviousUtcDayWindow(now);
    expect(window.periodStart).toBe("2026-07-28T00:00:00.000Z");
    expect(window.periodEnd).toBe("2026-07-28T00:00:00.000Z");
  });

  it("is ready only after grace past UTC midnight", () => {
    expect(
      isPreviousUtcDayWindowReady(new Date("2026-07-28T00:10:00.000Z"), 15),
    ).toBe(false);
    expect(
      isPreviousUtcDayWindowReady(new Date("2026-07-28T00:15:00.000Z"), 15),
    ).toBe(true);
  });

  it("resolves explicit periodStart/periodEnd", () => {
    const resolved = resolveDigestRunWindow({
      periodStart: "2026-07-09T00:00:00.000Z",
      periodEnd: "2026-07-28T00:00:00.000Z",
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.source).toBe("explicit");
    expect(resolved.window.periodStart).toBe("2026-07-09T00:00:00.000Z");
  });

  it("defaults empty body to previous_utc_day", () => {
    const now = new Date("2026-07-28T12:00:00.000Z");
    const resolved = resolveDigestRunWindow({}, now);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.source).toBe("previous_utc_day");
    expect(resolved.window.periodEnd).toBe("2026-07-28T00:00:00.000Z");
  });

  it("rejects partial explicit windows", () => {
    const resolved = resolveDigestRunWindow({ periodStart: "2026-07-28T00:00:00.000Z" });
    expect(resolved.ok).toBe(false);
  });
});
