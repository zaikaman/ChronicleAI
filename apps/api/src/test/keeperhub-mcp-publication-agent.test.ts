import { afterEach, describe, expect, it, vi } from "vitest";
import type { KeeperHubMcpClient } from "../services/keeperhub-mcp-client.ts";
import { publishViaDeterministicMcp } from "../agents/langchain/keeperhub-mcp-publication-agent.ts";
import { createKeeperHubMcpLangChainTools } from "../agents/langchain/keeperhub-mcp-tools.ts";

function mockMcpClient(
  handlers: Record<
    string,
    (args: Record<string, unknown>) => Promise<{ data: unknown; isError?: boolean; text?: string }>
  >,
): KeeperHubMcpClient {
  return {
    isConnected: () => true,
    connect: async () => {},
    close: async () => {},
    listServerTools: async () =>
      Object.keys(handlers).map((name) => ({ name, description: name })),
    callTool: async (name, args = {}) => {
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

describe("publishViaDeterministicMcp", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("lists workflows, executes publishAlert, polls get_execution until tx confirmed", async () => {
    const tx = "0x" + "11".repeat(32);
    let polls = 0;

    const client = mockMcpClient({
      list_workflows: async () => ({
        data: {
          workflows: [
            {
              id: "wf_publish_alert",
              name: "Chronicle Publish Alert",
              description: "publishAlert registry write",
            },
          ],
        },
      }),
      get_workflow: async ({ workflowId }) => ({
        data: { id: workflowId, name: "Chronicle Publish Alert", nodes: [] },
      }),
      execute_workflow: async ({ workflowId, input }) => {
        expect(workflowId).toBe("wf_publish_alert");
        expect(input).toMatchObject({
          contentUri: "https://chronicle.example/alerts/a1",
          network: "sepolia",
        });
        return { data: { executionId: "exec_mcp_1", status: "running" } };
      },
      get_execution: async ({ executionId, includeData }) => {
        expect(executionId).toBe("exec_mcp_1");
        polls += 1;
        if (polls < 2) {
          return {
            data: {
              status: { executionId, status: "running", completed: false },
              logs: includeData ? [] : undefined,
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
              gasUsedUnits: "50000",
            },
            logs: [{ nodeId: "write", status: "success" }],
          },
        };
      },
    });

    const receipt = await publishViaDeterministicMcp(client, {
      action: "publishAlert",
      preferredWorkflowId: "wf_publish_alert",
      input: {
        contentHash: "0x" + "aa".repeat(32),
        sourceEventHash: "0x" + "bb".repeat(32),
        contentUri: "https://chronicle.example/alerts/a1",
        contractAddress: "0x" + "11".repeat(20),
        network: "sepolia",
      },
      mcp: {
        mcpUrl: "https://app.keeperhub.com/mcp",
        apiKey: "kh_test",
      },
      network: "sepolia",
      pollIntervalMs: 1,
      pollTimeoutMs: 5_000,
      idempotencyKey: "test-alert-1",
    });

    expect(receipt.mode).toBe("deterministic-mcp");
    expect(receipt.keeperHubRunId).toBe("exec_mcp_1");
    expect(receipt.txHash).toBe(tx);
    expect(receipt.explorerUrl).toContain(tx);
    expect(receipt.gasUsed).toBe("50000");

    const names = receipt.toolCalls.map((t) => t.name);
    expect(names).toContain("list_workflows");
    expect(names).toContain("get_workflow");
    expect(names).toContain("execute_workflow");
    expect(names).toContain("get_execution");
  });

  it("discovers publishDigest workflow by name when preferred id is absent", async () => {
    const tx = "0x" + "22".repeat(32);

    const client = mockMcpClient({
      list_workflows: async () => ({
        data: {
          workflows: [
            { id: "wf_other", name: "Something Else" },
            {
              id: "wf_digest",
              name: "chronicle-publish-digest",
              description: "publishDigest on-chain",
            },
          ],
        },
      }),
      get_workflow: async ({ workflowId }) => ({
        data: { id: workflowId, name: "chronicle-publish-digest" },
      }),
      execute_workflow: async ({ workflowId }) => {
        expect(workflowId).toBe("wf_digest");
        return { data: { executionId: "exec_digest_1" } };
      },
      get_execution: async () => ({
        data: {
          status: {
            status: "completed",
            completed: true,
            transactionHashes: [
              {
                hash: tx,
                transactionLink: `https://sepolia.etherscan.io/tx/${tx}`,
              },
            ],
          },
          logs: [],
        },
      }),
    });

    const receipt = await publishViaDeterministicMcp(client, {
      action: "publishDigest",
      input: {
        contentHash: "0x" + "cc".repeat(32),
        sourceEventRoot: "0x" + "dd".repeat(32),
        contentUri: "https://chronicle.example/digests/d1",
        network: "sepolia",
      },
      mcp: { mcpUrl: "https://app.keeperhub.com/mcp", apiKey: "kh_test" },
      network: "sepolia",
      pollIntervalMs: 1,
      pollTimeoutMs: 5_000,
    });

    expect(receipt.txHash).toBe(tx);
    expect(receipt.keeperHubRunId).toBe("exec_digest_1");
  });
});

describe("createKeeperHubMcpLangChainTools", () => {
  it("exposes list/get/execute/status tool names for the ReAct agent", () => {
    const client = mockMcpClient({});
    const tools = createKeeperHubMcpLangChainTools(client);
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "execute_workflow",
        "get_execution",
        "get_execution_logs",
        "get_execution_status",
        "get_workflow",
        "list_workflows",
      ].sort(),
    );
  });

  it("routes get_execution_status to get_execution with includeData false", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const client = mockMcpClient({
      get_execution: async (args) => {
        calls.push({ name: "get_execution", args });
        return {
          data: { status: { status: "running", executionId: args.executionId } },
        };
      },
    });

    const tools = createKeeperHubMcpLangChainTools(client);
    const statusTool = tools.find((t) => t.name === "get_execution_status");
    expect(statusTool).toBeDefined();
    const raw = await statusTool!.invoke({ executionId: "exec_x" });
    expect(calls).toEqual([
      { name: "get_execution", args: { executionId: "exec_x", includeData: false } },
    ]);
    expect(String(raw)).toContain("exec_x");
  });
});
