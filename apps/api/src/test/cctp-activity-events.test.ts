import { describe, expect, it, vi } from "vitest";
import { emitCctpActivityEvent } from "../cctp/activity-events.ts";

describe("emitCctpActivityEvent", () => {
  it("no-ops when logger is null", async () => {
    await expect(
      emitCctpActivityEvent(null, {
        phase: "created",
        transferId: "t1",
        amountUsdc: 1,
      }),
    ).resolves.toBeUndefined();
  });

  it("writes cctp_rebalance execution log with explorers on burn", async () => {
    const append = vi.fn().mockResolvedValue(undefined);
    await emitCctpActivityEvent(
      { append },
      {
        phase: "burned",
        transferId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        amountUsdc: 10,
        mode: "direct",
        status: "awaiting_attestation",
        burnTxHash:
          "0x1111111111111111111111111111111111111111111111111111111111111111",
      },
    );

    expect(append).toHaveBeenCalledOnce();
    const [actionType, status, params] = append.mock.calls[0]!;
    expect(actionType).toBe("cctp_rebalance");
    expect(status).toBe("started");
    expect(params.entityType).toBe("cctp_rebalance_transfer");
    expect(params.entityId).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(params.message).toContain("burn");
    expect(params.details.burnTxHash).toMatch(/^0x1111/);
    expect(params.details.burnExplorerUrl).toContain("basescan");
  });

  it("marks minted as succeeded and prefers mint explorer", async () => {
    const append = vi.fn().mockResolvedValue(undefined);
    await emitCctpActivityEvent(
      { append },
      {
        phase: "minted",
        transferId: "t2",
        amountUsdc: 5,
        mode: "forwarding",
        burnTxHash:
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        mintTxHash:
          "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
    );

    const [, status, params] = append.mock.calls[0]!;
    expect(status).toBe("succeeded");
    expect(params.message).toContain("complete");
    expect(params.details.mintExplorerUrl).toContain("sepolia.etherscan");
    expect(params.details.explorer_url).toBe(params.details.mintExplorerUrl);
  });

  it("marks failed/stuck correctly and swallows logger errors", async () => {
    const append = vi.fn().mockRejectedValue(new Error("db down"));
    await expect(
      emitCctpActivityEvent(
        { append },
        {
          phase: "failed",
          transferId: "t3",
          errorMessage: "revert",
        },
      ),
    ).resolves.toBeUndefined();

    const append2 = vi.fn().mockResolvedValue(undefined);
    await emitCctpActivityEvent(
      { append: append2 },
      { phase: "stuck", transferId: "t4", errorMessage: "timeout" },
    );
    expect(append2.mock.calls[0]![1]).toBe("retrying");
  });
});
