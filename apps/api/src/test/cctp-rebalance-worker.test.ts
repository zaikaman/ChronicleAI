import { afterEach, describe, expect, it, vi } from "vitest";
import { createCctpRebalanceWorker } from "../cctp/rebalance-worker.ts";
import type { CctpRebalanceService } from "../cctp/rebalance-service.ts";
import type { CctpResumeResult, CctpTickResult } from "../cctp/types.ts";

function mockService(
  overrides: Partial<CctpRebalanceService> = {},
): CctpRebalanceService {
  return {
    async tick(): Promise<CctpTickResult> {
      return { outcome: "skipped", reason: "disabled" };
    },
    async resumeInFlight(): Promise<CctpResumeResult> {
      return { processed: 0, results: [] };
    },
    async forceRebalance(): Promise<CctpTickResult> {
      return { outcome: "skipped", reason: "disabled" };
    },
    async getStatus() {
      return {
        enabled: false,
        inFlightCount: 0,
        inFlightUsdc: 0,
        lastSuccessfulBurnAt: null,
        recent: [],
      };
    },
    async readBalances() {
      return {
        treasuryBaseUsdc: 0,
        treasurySepoliaUsdc: 0,
        treasuryBaseEth: 0,
        treasurySepoliaEth: 0,
        inFlightUsdc: 0,
      };
    },
    ...overrides,
  };
}

describe("createCctpRebalanceWorker", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs resume then tick in that order", async () => {
    const order: string[] = [];
    const service = mockService({
      async resumeInFlight() {
        order.push("resume");
        return {
          processed: 1,
          results: [
            {
              transferId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
              outcome: "awaiting_attestation",
              status: "awaiting_attestation",
            },
          ],
        };
      },
      async tick() {
        order.push("tick");
        return { outcome: "started", transferId: "t2", amountUsdc: 10 };
      },
    });

    const logs: string[] = [];
    const worker = createCctpRebalanceWorker({
      service,
      intervalMs: 60_000,
      log: {
        info: (m) => logs.push(m),
        warn: (m) => logs.push(m),
        error: (m) => logs.push(m),
      },
    });

    const result = await worker.cycle();
    expect(order).toEqual(["resume", "tick"]);
    expect(result?.resume.processed).toBe(1);
    expect(result?.tick.outcome).toBe("started");
    expect(logs.some((l) => l.includes("resume processed=1"))).toBe(true);
    expect(logs.some((l) => l.includes("tick outcome=started"))).toBe(true);
  });

  it("still runs tick when resume throws", async () => {
    const tick = vi.fn().mockResolvedValue({
      outcome: "skipped",
      reason: "below_threshold",
    } satisfies CctpTickResult);
    const service = mockService({
      async resumeInFlight() {
        throw new Error("db down");
      },
      tick,
    });

    const worker = createCctpRebalanceWorker({
      service,
      intervalMs: 60_000,
      log: { info: () => {}, warn: () => {}, error: () => {} },
    });

    const result = await worker.cycle();
    expect(tick).toHaveBeenCalledOnce();
    expect(result?.resume.processed).toBe(0);
    expect(result?.tick.outcome).toBe("skipped");
  });

  it("skips overlapping cycles while in flight", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const resumeInFlight = vi.fn().mockImplementation(async () => {
      await gate;
      return { processed: 0, results: [] };
    });
    const tick = vi.fn().mockResolvedValue({
      outcome: "skipped",
      reason: "disabled",
    } satisfies CctpTickResult);

    const worker = createCctpRebalanceWorker({
      service: mockService({ resumeInFlight, tick }),
      intervalMs: 60_000,
      log: { info: () => {}, warn: () => {}, error: () => {} },
    });

    const first = worker.cycle();
    const second = await worker.cycle();
    expect(second).toBeNull();
    expect(resumeInFlight).toHaveBeenCalledTimes(1);
    release();
    await first;
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it("start is no-op when enabled=false", async () => {
    const resumeInFlight = vi.fn();
    const worker = createCctpRebalanceWorker({
      service: mockService({ resumeInFlight }),
      intervalMs: 10,
      enabled: false,
      log: { info: () => {}, warn: () => {}, error: () => {} },
    });
    worker.start();
    await new Promise((r) => setTimeout(r, 30));
    expect(resumeInFlight).not.toHaveBeenCalled();
    worker.stop();
  });

  it("start fires immediate cycle and interval ticks", async () => {
    vi.useFakeTimers();
    const resumeInFlight = vi.fn().mockResolvedValue({ processed: 0, results: [] });
    const tick = vi.fn().mockResolvedValue({
      outcome: "skipped",
      reason: "disabled",
    } satisfies CctpTickResult);

    const worker = createCctpRebalanceWorker({
      service: mockService({ resumeInFlight, tick }),
      intervalMs: 12_000,
      log: { info: () => {}, warn: () => {}, error: () => {} },
    });

    worker.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(resumeInFlight).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(12_000);
    expect(resumeInFlight).toHaveBeenCalledTimes(2);

    worker.stop();
    await vi.advanceTimersByTimeAsync(24_000);
    expect(resumeInFlight).toHaveBeenCalledTimes(2);
  });
});
