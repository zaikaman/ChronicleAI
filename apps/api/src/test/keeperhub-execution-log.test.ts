import { describe, expect, it, vi } from "vitest";
import type { ExecutionLogRepository } from "@chronicleai/db";
import {
  actionTypeForWriteMethod,
  isExecutionLogEntityUuid,
  sanitizeExecutionLogInsert,
  softAppendExecutionLog,
  withKeeperHubLog,
} from "../services/keeperhub-execution-log.ts";

const ALERT_UUID = "11111111-1111-4111-8111-111111111111";

function mockExecLog(): ExecutionLogRepository & {
  append: ReturnType<typeof vi.fn>;
} {
  return {
    append: vi.fn().mockResolvedValue({
      ok: true,
      value: {
        id: "log-1",
        action_type: "registry_write",
        entity_type: null,
        entity_id: null,
        status: "started",
        message: null,
        details: {},
        started_at: new Date().toISOString(),
        completed_at: null,
        created_at: new Date().toISOString(),
      },
    }),
    listByEntity: vi.fn(),
    listRecent: vi.fn(),
    listPage: vi.fn(),
  };
}

describe("keeperhub-execution-log", () => {
  it("maps write methods to action types", () => {
    expect(actionTypeForWriteMethod("publishAlert")).toBe("registry_write");
    expect(actionTypeForWriteMethod("publishDigest")).toBe("registry_write");
    expect(actionTypeForWriteMethod("publishTradeTicket")).toBe("registry_write");
    expect(actionTypeForWriteMethod("recordCapitalMove")).toBe("registry_write");
    expect(actionTypeForWriteMethod("createSponsoredWatch")).toBe("sponsored_watch");
    expect(actionTypeForWriteMethod("publishSponsoredReport")).toBe("sponsored_watch");
    expect(actionTypeForWriteMethod("publishPremiumReceipt")).toBe("premium_receipt");
    expect(actionTypeForWriteMethod("recordPayout")).toBe("payout");
    expect(actionTypeForWriteMethod("transfer")).toBe("payout");
  });

  it("sanitizes non-UUID entity_id and preserves raw ref in details", () => {
    expect(isExecutionLogEntityUuid("1xtr9dcbk668hsvukd2f1")).toBe(false);
    expect(isExecutionLogEntityUuid(ALERT_UUID)).toBe(true);

    const sanitized = sanitizeExecutionLogInsert({
      action_type: "registry_write",
      status: "started",
      entity_id: "1xtr9dcbk668hsvukd2f1",
      details: { workflowId: "1xtr9dcbk668hsvukd2f1" },
    });
    expect(sanitized.entity_id).toBeNull();
    expect(sanitized.details).toMatchObject({
      workflowId: "1xtr9dcbk668hsvukd2f1",
      entity_id_raw: "1xtr9dcbk668hsvukd2f1",
      entity_ref: "1xtr9dcbk668hsvukd2f1",
    });
  });

  it("withKeeperHubLog records started then succeeded with receipt details", async () => {
    const execLog = mockExecLog();
    const result = await withKeeperHubLog(
      execLog,
      {
        actionType: "registry_write",
        entityType: "public_alert",
        entityId: ALERT_UUID,
        method: "publishAlert",
      },
      async () => ({
        keeperHubRunId: "run-1",
        txHash: "0x" + "ab".repeat(32),
        explorerUrl: "https://sepolia.etherscan.io/tx/0xab",
        gasUsed: "21000",
      }),
    );

    expect(result.keeperHubRunId).toBe("run-1");
    expect(execLog.append).toHaveBeenCalledTimes(2);
    expect(execLog.append.mock.calls[0]?.[0]).toMatchObject({
      action_type: "registry_write",
      status: "started",
      entity_id: ALERT_UUID,
      details: { method: "publishAlert" },
    });
    expect(execLog.append.mock.calls[1]?.[0]).toMatchObject({
      action_type: "registry_write",
      status: "succeeded",
      entity_id: ALERT_UUID,
      details: {
        method: "publishAlert",
        keeper_hub_run_id: "run-1",
        tx_hash: "0x" + "ab".repeat(32),
        executedViaKeeperHub: true,
        gas_used: "21000",
      },
    });
  });

  it("softAppendExecutionLog nulls KeeperHub workflow ids used as entity_id", async () => {
    const execLog = mockExecLog();
    await softAppendExecutionLog(execLog, {
      action_type: "registry_write",
      status: "started",
      entity_type: "keeperhub_workflow",
      entity_id: "1xtr9dcbk668hsvukd2f1",
      message: "workflow started",
      details: { method: "publishTradeTicket" },
    });
    expect(execLog.append).toHaveBeenCalledWith(
      expect.objectContaining({
        entity_id: null,
        details: expect.objectContaining({
          method: "publishTradeTicket",
          entity_id_raw: "1xtr9dcbk668hsvukd2f1",
        }),
      }),
    );
  });

  it("withKeeperHubLog records failed and rethrows", async () => {
    const execLog = mockExecLog();
    await expect(
      withKeeperHubLog(
        execLog,
        {
          actionType: "desk_workflow",
          entityType: "desk_workflow",
          method: "rotate",
        },
        async () => {
          throw new Error("Timed out waiting for KeeperHub desk execution exec-42");
        },
      ),
    ).rejects.toThrow(/Timed out/);

    expect(execLog.append).toHaveBeenCalledTimes(2);
    expect(execLog.append.mock.calls[0]?.[0]).toMatchObject({ status: "started" });
    expect(execLog.append.mock.calls[1]?.[0]).toMatchObject({
      status: "failed",
      action_type: "desk_workflow",
      details: {
        method: "rotate",
        reason: "keeperhub_execute_failed",
      },
    });
    expect(
      (execLog.append.mock.calls[1]?.[0] as { details: { keeper_hub_run_id?: string } })
        .details.keeper_hub_run_id,
    ).toBe("exec-42");
  });

  it("softAppendExecutionLog swallows append failures", async () => {
    const execLog = mockExecLog();
    execLog.append.mockResolvedValueOnce({
      ok: false,
      error: { code: "db", message: "insert failed" },
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await softAppendExecutionLog(execLog, {
      action_type: "desk_agent",
      status: "failed",
      message: "test",
    });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("withKeeperHubLog is a no-op when execLog is null", async () => {
    const value = await withKeeperHubLog(null, {
      actionType: "payment",
      method: "settle",
    }, async () => 42);
    expect(value).toBe(42);
  });
});
