// Unit tests for KeeperHub write client (workflow-only execute + poll)

import { afterEach, describe, expect, it, vi } from "vitest";
import { createKeeperHubWriteClient } from "../services/keeperhub-write-client.ts";

vi.mock("../services/keeperhub-mcp-execute.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/keeperhub-mcp-execute.ts")>();
  return {
    ...actual,
    executeViaKeeperHubMcp: vi.fn(),
  };
});

vi.mock("../agents/langchain/keeperhub-mcp-publication-agent.ts", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../agents/langchain/keeperhub-mcp-publication-agent.ts")
    >();
  return {
    ...actual,
    publishViaKeeperHubMcp: vi.fn(),
  };
});

const baseConfig = {
  apiBaseUrl: "https://app.keeperhub.com",
  apiKey: "kh_test_key",
  network: "sepolia",
  registryAddress: "0x" + "11".repeat(20),
  usdcAddress: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  pollIntervalMs: 1,
  pollTimeoutMs: 5_000,
} as const;

describe("createKeeperHubWriteClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("publishes an alert via workflow execute and polls wait for tx + explorer URL", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/workflows/wf_publish_alert/execute") && init?.method === "POST") {
        return new Response(JSON.stringify({ executionId: "exec_alert_1", status: "running" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/api/workflows/executions/exec_alert_1/wait")) {
        return new Response(
          JSON.stringify({
            executionId: "exec_alert_1",
            status: "success",
            completed: true,
            transactionHashes: [
              {
                hash: "0x" + "ab".repeat(32),
                transactionLink: "https://sepolia.etherscan.io/tx/0x" + "ab".repeat(32),
              },
            ],
            gasUsedUnits: "91234",
            gasUsed: "91234000000000",
            result: {
              gasUsedUnits: "91234",
              gasUsed: "91234000000000",
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
      return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createKeeperHubWriteClient({
      ...baseConfig,
      workflowIds: { publishAlert: "wf_publish_alert" },
    });

    const receipt = await client.publishAlert(
      "alert-id-1",
      "source-event-hash-1",
      "https://chronicle.example/alerts/alert-id-1",
    );

    expect(receipt.keeperHubRunId).toBe("exec_alert_1");
    expect(receipt.txHash).toBe("0x" + "ab".repeat(32));
    expect(receipt.explorerUrl).toContain("sepolia.etherscan.io");
    expect(receipt.gasUsed).toBe("91234");
    expect(receipt.gasUsedWei).toBe("91234000000000");

    const executeCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/api/workflows/wf_publish_alert/execute"),
    );
    expect(executeCall).toBeDefined();
    const body = JSON.parse(String((executeCall?.[1] as RequestInit).body));
    expect(body.input.contentUri).toBe("https://chronicle.example/alerts/alert-id-1");
    expect(body.input.network).toBe("sepolia");
    // Must never hit Direct Execution
    expect(
      fetchMock.mock.calls.some((c) => String(c[0]).includes("/api/execute/")),
    ).toBe(false);
  });

  it("sends USDC transfer via transfer workflow only", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/workflows/wf_transfer/execute") && init?.method === "POST") {
        return new Response(JSON.stringify({ executionId: "exec_xfer_1", status: "running" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/api/workflows/executions/exec_xfer_1/wait")) {
        return new Response(
          JSON.stringify({
            executionId: "exec_xfer_1",
            status: "success",
            completed: true,
            transactionHashes: [
              {
                hash: "0x" + "cd".repeat(32),
                transactionLink: "https://sepolia.etherscan.io/tx/0x" + "cd".repeat(32),
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("{}", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createKeeperHubWriteClient({
      ...baseConfig,
      workflowIds: { transfer: "wf_transfer" },
    });

    const receipt = await client.sendTransfer("0x" + "22".repeat(20), 12.5);
    const xferCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/api/workflows/wf_transfer/execute"),
    );
    expect(xferCall).toBeDefined();
    const xferBody = JSON.parse(String((xferCall?.[1] as RequestInit).body));
    expect(xferBody.input.tokenAddress).toBe("0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238");
    expect(xferBody.input.amount).toBe("12.5");
    expect(receipt.keeperHubRunId).toBe("exec_xfer_1");
    expect(receipt.txHash).toBe("0x" + "cd".repeat(32));
    expect(
      fetchMock.mock.calls.some((c) => String(c[0]).includes("/api/execute/transfer")),
    ).toBe(false);
  });

  it("falls back to workflow status poll when wait is non-terminal", async () => {
    let waitCalls = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/workflows/wf_publish_alert/execute") && init?.method === "POST") {
        return new Response(JSON.stringify({ executionId: "exec_poll_1", status: "running" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/api/workflows/executions/exec_poll_1/wait")) {
        waitCalls += 1;
        // First wait is still running
        return new Response(
          JSON.stringify({
            executionId: "exec_poll_1",
            status: "running",
            completed: false,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("/api/workflows/executions/exec_poll_1/status")) {
        return new Response(
          JSON.stringify({
            executionId: "exec_poll_1",
            status: "completed",
            completed: true,
            transactionHash: "0x" + "ef".repeat(32),
            transactionLink: "https://sepolia.etherscan.io/tx/0x" + "ef".repeat(32),
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json", "X-Poll-Interval-Hint": "0" },
          },
        );
      }
      return new Response("{}", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createKeeperHubWriteClient({
      ...baseConfig,
      workflowIds: { publishAlert: "wf_publish_alert" },
    });

    const receipt = await client.publishAlert("a1", "source-1", "uri");
    expect(receipt.keeperHubRunId).toBe("exec_poll_1");
    expect(receipt.txHash).toBe("0x" + "ef".repeat(32));
    expect(waitCalls).toBeGreaterThanOrEqual(1);
    expect(
      fetchMock.mock.calls.some((c) =>
        String(c[0]).includes("/api/workflows/executions/exec_poll_1/status"),
      ),
    ).toBe(true);
    expect(
      fetchMock.mock.calls.some((c) => String(c[0]).includes("/api/execute/")),
    ).toBe(false);
  });

  it("rejects publishAlert when workflow id is missing (no Direct Execution fallback)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const client = createKeeperHubWriteClient({
      ...baseConfig,
      // no workflowIds
    });

    await expect(client.publishAlert("a1", "source-1", "uri")).rejects.toThrow(
      /KEEPERHUB_WORKFLOW_PUBLISH_ALERT/,
    );
    await expect(client.publishAlert("a1", "source-1", "uri")).rejects.toThrow(
      /Direct Execution is disabled/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects sendTransfer when transfer workflow id is missing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const client = createKeeperHubWriteClient({
      ...baseConfig,
      workflowIds: { publishAlert: "wf_publish_alert" },
    });

    await expect(client.sendTransfer("0x" + "22".repeat(20), 1)).rejects.toThrow(
      /KEEPERHUB_WORKFLOW_TRANSFER/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("publishes a trade ticket via workflow execute", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/workflows/wf_publish_ticket/execute") && init?.method === "POST") {
        return new Response(JSON.stringify({ executionId: "exec_ticket_1", status: "running" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/api/workflows/executions/exec_ticket_1/wait")) {
        return new Response(
          JSON.stringify({
            executionId: "exec_ticket_1",
            status: "success",
            completed: true,
            transactionHash: "0x" + "cd".repeat(32),
            transactionLink: "https://sepolia.etherscan.io/tx/0x" + "cd".repeat(32),
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createKeeperHubWriteClient({
      ...baseConfig,
      workflowIds: { publishTradeTicket: "wf_publish_ticket" },
    });

    const receipt = await client.publishTradeTicket(
      "ticket-1",
      "signal-1",
      "intent-1",
      "https://chronicle.example/desk/tickets/ticket-1",
    );

    expect(receipt.keeperHubRunId).toBe("exec_ticket_1");
    expect(receipt.txHash).toBe("0x" + "cd".repeat(32));

    const executeCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/api/workflows/wf_publish_ticket/execute"),
    );
    expect(executeCall).toBeDefined();
    const body = JSON.parse(String((executeCall?.[1] as RequestInit).body));
    expect(body.input.contentUri).toBe("https://chronicle.example/desk/tickets/ticket-1");
    expect(body.input.ticketHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(body.input.signalHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(body.input.intentHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("rejects publishTradeTicket when workflow id is missing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const client = createKeeperHubWriteClient({
      ...baseConfig,
      workflowIds: {},
    });

    await expect(
      client.publishTradeTicket("t1", "s1", "i1", "https://example.com/desk/tickets/t1"),
    ).rejects.toThrow(/KEEPERHUB_WORKFLOW_PUBLISH_TRADE_TICKET/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("logs started + succeeded execution_logs when execLogRepo is provided", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/execute") && init?.method === "POST") {
        return new Response(JSON.stringify({ executionId: "exec_log_1", status: "running" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/wait") || url.includes("/status")) {
        return new Response(
          JSON.stringify({
            executionId: "exec_log_1",
            status: "success",
            completed: true,
            transactionHash: "0x" + "ef".repeat(32),
            transactionLink: "https://sepolia.etherscan.io/tx/0x" + "ef".repeat(32),
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const append = vi.fn().mockResolvedValue({ ok: true, value: {} });
    const client = createKeeperHubWriteClient({
      ...baseConfig,
      workflowIds: { publishAlert: "wf_publish_alert" },
      execLogRepo: {
        append,
        listByEntity: vi.fn(),
        listRecent: vi.fn(),
        listPage: vi.fn(),
      } as never,
    });

    await client.publishAlert("a1", "s1", "https://example.com/a1");

    expect(append).toHaveBeenCalledTimes(2);
    expect(append.mock.calls[0]?.[0]).toMatchObject({
      action_type: "registry_write",
      status: "started",
      details: expect.objectContaining({ method: "publishAlert" }),
    });
    expect(append.mock.calls[1]?.[0]).toMatchObject({
      action_type: "registry_write",
      status: "succeeded",
      details: expect.objectContaining({
        method: "publishAlert",
        keeper_hub_run_id: "exec_log_1",
        tx_hash: "0x" + "ef".repeat(32),
        executionPath: "rest",
      }),
    });
  });

  it("publishTradeTicket via MCP builds correct workflow input and sets executionPath", async () => {
    const { executeViaKeeperHubMcp } = await import(
      "../services/keeperhub-mcp-execute.ts"
    );
    const mcpMock = vi.mocked(executeViaKeeperHubMcp);
    mcpMock.mockResolvedValue({
      keeperHubRunId: "exec_mcp_ticket",
      txHash: "0x" + "ab".repeat(32),
      explorerUrl: "https://sepolia.etherscan.io/tx/0x" + "ab".repeat(32),
      mode: "deterministic-mcp",
      toolCalls: [
        { name: "list_workflows", arguments: {}, result: {} },
        {
          name: "execute_workflow",
          arguments: {},
          result: { executionId: "exec_mcp_ticket" },
        },
      ],
      gasUsed: "11111",
    });

    const append = vi.fn().mockResolvedValue({ ok: true, value: {} });
    const client = createKeeperHubWriteClient({
      ...baseConfig,
      workflowIds: { publishTradeTicket: "wf_trade_ticket" },
      execLogRepo: {
        append,
        listByEntity: vi.fn(),
        listRecent: vi.fn(),
        listPage: vi.fn(),
      } as never,
      mcp: {
        enabled: true,
        restFallback: true,
        langchainAgent: false,
      },
    });

    const ticketHash = "0x" + "11".repeat(32);
    const signalHash = "0x" + "22".repeat(32);
    const intentHash = "0x" + "33".repeat(32);
    const receipt = await client.publishTradeTicket(
      ticketHash,
      signalHash,
      intentHash,
      "https://chronicle.example/desk/tickets/t1",
    );

    expect(receipt.keeperHubRunId).toBe("exec_mcp_ticket");
    expect(receipt.txHash).toBe("0x" + "ab".repeat(32));
    expect(receipt.gasUsed).toBe("11111");

    expect(mcpMock).toHaveBeenCalledTimes(1);
    const call = mcpMock.mock.calls[0]![0];
    expect(call.action).toBe("publishTradeTicket");
    expect(call.preferredWorkflowId).toBe("wf_trade_ticket");
    expect(call.workflowInput).toMatchObject({
      ticketHash,
      signalHash,
      intentHash,
      contentUri: "https://chronicle.example/desk/tickets/t1",
      network: "sepolia",
      contractAddress: baseConfig.registryAddress,
    });

    expect(append.mock.calls[0]?.[0]).toMatchObject({
      details: expect.objectContaining({
        executionPath: "mcp",
        method: "publishTradeTicket",
      }),
    });
  });

  it("sendTransfer via MCP uses transfer action and human USDC amount input", async () => {
    const { executeViaKeeperHubMcp } = await import(
      "../services/keeperhub-mcp-execute.ts"
    );
    const mcpMock = vi.mocked(executeViaKeeperHubMcp);
    mcpMock.mockResolvedValue({
      keeperHubRunId: "exec_mcp_xfer",
      txHash: "0x" + "cd".repeat(32),
      explorerUrl: "https://sepolia.etherscan.io/tx/0x" + "cd".repeat(32),
      mode: "deterministic-mcp",
      toolCalls: [],
    });

    const client = createKeeperHubWriteClient({
      ...baseConfig,
      workflowIds: { transfer: "wf_transfer" },
      mcp: { enabled: true, langchainAgent: false },
    });

    const to = "0x" + "99".repeat(20);
    await client.sendTransfer(to, 12.5);

    const call = mcpMock.mock.calls[mcpMock.mock.calls.length - 1]![0];
    expect(call.action).toBe("transfer");
    expect(call.workflowInput).toMatchObject({
      recipientAddress: to,
      amount: "12.5",
      network: "sepolia",
      tokenAddress: baseConfig.usdcAddress,
    });
  });
});
