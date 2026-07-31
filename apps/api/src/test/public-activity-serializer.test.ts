import type { ExecutionLogRow } from "@chronicleai/db";
import { describe, expect, it } from "vitest";
import { serializePublicActivityLog } from "../services/public-activity-serializer.ts";

describe("serializePublicActivityLog", () => {
  it("returns only allow-listed details and preserves derived routing links", () => {
    const log: ExecutionLogRow = {
      id: "log-1",
      action_type: "treasury_check",
      entity_type: "treasury_snapshot",
      entity_id: "snapshot-1",
      status: "failed",
      message: "Treasury check failed",
      details: {
        routing: "private_mempool",
        routingStrict: true,
        routingProvider: "flashbots_protect",
        routingRequested: "private_mempool",
        routingApplied: "unknown",
        chainId: 11_155_111,
        txHash: `0x${"a".repeat(64)}`,
        phase: "submit",
        providerError: "secret provider response",
        agentMessage: "internal workflow message",
        walletAddress: "0xprivate",
        authorization: "Bearer secret",
        nested: { secret: "must not leak" },
      },
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    };

    const serialized = serializePublicActivityLog(log);
    expect(serialized.details).toEqual({
      routing: "private_mempool",
      routingStrict: true,
      routingProvider: "flashbots_protect",
      routingRequested: "private_mempool",
      routingApplied: "unknown",
      chainId: 11_155_111,
      txHash: `0x${"a".repeat(64)}`,
      phase: "submit",
    });
    expect(JSON.stringify(serialized)).not.toContain("secret");
    expect(serialized.protectStatusUrl).toBe(
      `https://protect-sepolia.flashbots.net/tx/0x${"a".repeat(64)}`,
    );
  });

  it("returns null details when no public fields are present", () => {
    const log = {
      id: "log-2",
      action_type: "notification",
      entity_type: null,
      entity_id: null,
      status: "succeeded",
      message: null,
      details: { password: "secret", internalWorkflowId: "private" },
      started_at: new Date().toISOString(),
      completed_at: null,
      created_at: new Date().toISOString(),
    } satisfies ExecutionLogRow;

    expect(serializePublicActivityLog(log).details).toBeNull();
  });
});
