import { afterEach, describe, expect, it, vi } from "vitest";
import type { KeeperHubMcpClient } from "../services/keeperhub-mcp-client.ts";
import {
  defaultWorkflowHints,
  executeViaDeterministicMcp,
  isAlreadyPublishedError,
  isRpcTimeoutError,
  isSingleExecuteAction,
  mcpActionFromDeskAction,
  pickWorkflowId,
  summarizeMcpToolCalls,
} from "../services/keeperhub-mcp-execute.ts";

function mockMcpClient(
  handlers: Record<
    string,
    (args: Record<string, unknown>) => Promise<{
      data: unknown;
      isError?: boolean;
      text?: string;
    }>
  >,
  callLog?: Array<{ name: string; args: Record<string, unknown> }>,
): KeeperHubMcpClient {
  return {
    isConnected: () => true,
    connect: async () => {},
    close: async () => {},
    listServerTools: async () => Object.keys(handlers).map((name) => ({ name, description: name })),
    callTool: async (name, args = {}) => {
      callLog?.push({ name, args });
      const handler = handlers[name];
      if (!handler) {
        return {
          data: { error: `unknown tool ${name}` },
          isError: true,
          text: `unknown tool ${name}`,
        };
      }
      const res = await handler(args);
      return {
        data: res.data,
        isError: res.isError === true,
        text: res.text ?? (typeof res.data === "string" ? res.data : JSON.stringify(res.data)),
      };
    },
  };
}

const baseParams = {
  mcp: { mcpUrl: "https://app.keeperhub.com/mcp", apiKey: "kh_test" },
  network: "sepolia",
  pollIntervalMs: 1,
  pollTimeoutMs: 5_000,
} as const;

describe("executeViaDeterministicMcp", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("picks preferred workflow ID, executes once, polls until tx confirmed", async () => {
    const tx = "0x" + "11".repeat(32);
    const callLog: Array<{ name: string; args: Record<string, unknown> }> = [];
    let polls = 0;

    const client = mockMcpClient(
      {
        list_workflows: async () => ({
          data: {
            workflows: [
              { id: "wf_other", name: "Other" },
              { id: "wf_ticket", name: "Publish Trade Ticket" },
            ],
          },
        }),
        get_workflow: async ({ workflowId }) => ({
          data: { id: workflowId, name: "Publish Trade Ticket" },
        }),
        execute_workflow: async ({ workflowId, input }) => {
          expect(workflowId).toBe("wf_ticket");
          expect(input).toMatchObject({ network: "sepolia" });
          return { data: { executionId: "exec_ticket_1", status: "running" } };
        },
        get_execution: async ({ executionId }) => {
          expect(executionId).toBe("exec_ticket_1");
          polls += 1;
          if (polls < 2) {
            return {
              data: {
                status: { executionId, status: "running", completed: false },
              },
            };
          }
          return {
            data: {
              status: {
                executionId,
                status: "success",
                completed: true,
                transactionHash: tx,
                transactionLink: `https://sepolia.etherscan.io/tx/${tx}`,
                gasUsedUnits: "42000",
              },
              logs: [],
            },
          };
        },
      },
      callLog,
    );

    const receipt = await executeViaDeterministicMcp(client, {
      action: "publishTradeTicket",
      preferredWorkflowId: "wf_ticket",
      workflowInput: {
        ticketHash: "0x" + "aa".repeat(32),
        signalHash: "0x" + "bb".repeat(32),
        intentHash: "0x" + "cc".repeat(32),
        contentUri: "https://chronicle.example/desk/tickets/1",
        network: "sepolia",
      },
      ...baseParams,
      idempotencyKey: "test-ticket-1",
    });

    expect(receipt.mode).toBe("deterministic-mcp");
    expect(receipt.keeperHubRunId).toBe("exec_ticket_1");
    expect(receipt.txHash).toBe(tx);
    expect(receipt.gasUsed).toBe("42000");

    const executeCalls = callLog.filter((c) => c.name === "execute_workflow");
    expect(executeCalls).toHaveLength(1);
    expect(callLog.map((c) => c.name)).toContain("list_workflows");
    expect(callLog.map((c) => c.name)).toContain("get_workflow");
    expect(callLog.map((c) => c.name)).toContain("get_execution");
  });

  it("single-execute: only one execute_workflow is sent per session", async () => {
    const tx = "0x" + "22".repeat(32);
    let executeCount = 0;
    const callLog: Array<{ name: string; args: Record<string, unknown> }> = [];

    const client = mockMcpClient(
      {
        list_workflows: async () => ({
          data: { workflows: [{ id: "wf_alert", name: "publish-alert" }] },
        }),
        get_workflow: async () => ({ data: { id: "wf_alert" } }),
        execute_workflow: async () => {
          executeCount += 1;
          return { data: { executionId: `exec_${executeCount}` } };
        },
        get_execution: async () => ({
          data: {
            status: {
              status: "completed",
              completed: true,
              transactionHash: tx,
            },
          },
        }),
      },
      callLog,
    );

    await executeViaDeterministicMcp(client, {
      action: "publishAlert",
      preferredWorkflowId: "wf_alert",
      workflowInput: { contentHash: "0x" + "aa".repeat(32), network: "sepolia" },
      ...baseParams,
      singleExecute: true,
    });

    expect(executeCount).toBe(1);
    expect(callLog.filter((c) => c.name === "execute_workflow")).toHaveLength(1);
  });

  it("maps gas and multi-tx hashes for desk defend without requiring single hash early", async () => {
    const tx1 = "0x" + "33".repeat(32);
    const tx2 = "0x" + "44".repeat(32);

    const client = mockMcpClient({
      list_workflows: async () => ({
        data: { workflows: [{ id: "wf_defend", name: "desk-defend" }] },
      }),
      get_workflow: async () => ({ data: { id: "wf_defend" } }),
      execute_workflow: async () => ({
        data: { executionId: "exec_defend_1" },
      }),
      get_execution: async () => ({
        data: {
          status: {
            status: "success",
            completed: true,
            transactionHashes: [
              {
                hash: tx1,
                transactionLink: `https://sepolia.etherscan.io/tx/${tx1}`,
              },
              {
                hash: tx2,
                transactionLink: `https://sepolia.etherscan.io/tx/${tx2}`,
              },
            ],
            gasUsedUnits: "99000",
          },
        },
      }),
    });

    const receipt = await executeViaDeterministicMcp(client, {
      action: "deskDefend",
      preferredWorkflowId: "wf_defend",
      workflowInput: { intentId: "i1", legs: [], network: "sepolia" },
      ...baseParams,
    });

    expect(receipt.txHash).toBe(tx1);
    expect(receipt.txHashes).toEqual([tx1, tx2]);
    expect(receipt.gasUsed).toBe("99000");
  });

  it("wait=false returns after execute without polling", async () => {
    const callLog: Array<{ name: string; args: Record<string, unknown> }> = [];
    const client = mockMcpClient(
      {
        list_workflows: async () => ({
          data: { workflows: [{ id: "wf_sweep", name: "desk-sweep" }] },
        }),
        get_workflow: async () => ({ data: { id: "wf_sweep" } }),
        execute_workflow: async () => ({
          data: { executionId: "exec_sweep_1" },
        }),
        get_execution: async () => {
          throw new Error("should not poll when wait=false");
        },
      },
      callLog,
    );

    const receipt = await executeViaDeterministicMcp(client, {
      action: "deskSweep",
      preferredWorkflowId: "wf_sweep",
      workflowInput: { network: "sepolia" },
      ...baseParams,
      wait: false,
    });

    expect(receipt.keeperHubRunId).toBe("exec_sweep_1");
    expect(receipt.status).toBe("started");
    expect(receipt.txHash).toBe("");
    expect(callLog.some((c) => c.name === "get_execution")).toBe(false);
  });
});

describe("pickWorkflowId / hints", () => {
  it("returns preferred ID immediately when set", () => {
    expect(
      pickWorkflowId({ workflows: [{ id: "wf_a", name: "alert" }] }, ["alert"], "wf_preferred"),
    ).toBe("wf_preferred");
  });

  it("scores by name hints when preferred id absent", () => {
    expect(
      pickWorkflowId(
        {
          workflows: [
            { id: "wf_other", name: "Something" },
            { id: "wf_ticket", name: "chronicle-publish-trade-ticket" },
          ],
        },
        defaultWorkflowHints("publishTradeTicket"),
      ),
    ).toBe("wf_ticket");
  });
});

describe("helpers", () => {
  it("identifies RPC timeouts but not KeeperHub polling deadlines", () => {
    expect(
      isRpcTimeoutError(
        'Token approval failed: timeout (operation="request.send", reason="timeout", code=TIMEOUT)',
      ),
    ).toBe(true);
    expect(isRpcTimeoutError("Step did not record completion")).toBe(true);
    expect(isRpcTimeoutError("Timed out waiting for KeeperHub execution exec_1")).toBe(false);
    expect(isRpcTimeoutError("contract reverted: insufficient balance")).toBe(false);
  });

  it("isSingleExecuteAction for contentHash registry writes", () => {
    expect(isSingleExecuteAction("publishAlert")).toBe(true);
    expect(isSingleExecuteAction("publishTradeTicket")).toBe(true);
    expect(isSingleExecuteAction("transfer")).toBe(false);
    expect(isSingleExecuteAction("deskDefend")).toBe(false);
  });

  it("mcpActionFromDeskAction maps desk actions", () => {
    expect(mcpActionFromDeskAction("defend")).toBe("deskDefend");
    expect(mcpActionFromDeskAction("kill_switch")).toBe("deskKillSwitch");
  });

  it("summarizeMcpToolCalls keeps names + executionId only", () => {
    const summary = summarizeMcpToolCalls([
      {
        name: "execute_workflow",
        arguments: { workflowId: "wf", input: { secret: "nope" } },
        result: { executionId: "exec_1" },
      },
      {
        name: "get_execution",
        arguments: { executionId: "exec_1" },
        result: { status: { status: "running" } },
        isError: false,
      },
    ]);
    expect(summary).toEqual([
      { name: "execute_workflow", executionId: "exec_1" },
      { name: "get_execution" },
    ]);
    expect(JSON.stringify(summary)).not.toContain("secret");
  });

  it("isAlreadyPublishedError detects registry duplicates", () => {
    expect(isAlreadyPublishedError("alert already published")).toBe(true);
    expect(isAlreadyPublishedError("timeout")).toBe(false);
  });
});
