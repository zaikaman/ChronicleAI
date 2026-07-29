import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createExecutionBridge,
  isDeskWorkflowExecutionError,
} from "../desk/execution-bridge.ts";

describe("execution-bridge", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fails hard when workflow id is missing", async () => {
    const bridge = createExecutionBridge({
      apiBaseUrl: "https://app.keeperhub.example",
      apiKey: "kh_test",
      network: "sepolia",
      workflowIds: {},
    });

    await expect(
      bridge.execute("defend", { intentId: "x" }),
    ).rejects.toThrow(/KEEPERHUB_WORKFLOW_DESK_DEFEND/);
  });

  it("POSTs workflow execute and polls to completion", async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/execute") && init?.method === "POST") {
        return new Response(JSON.stringify({ executionId: "exec-1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (u.includes("/wait") || u.includes("/status")) {
        return new Response(
          JSON.stringify({
            executionId: "exec-1",
            status: "completed",
            completed: true,
            transactionHash: "0xabc",
            transactionLink: "https://sepolia.etherscan.io/tx/0xabc",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      // Phase 2: empty logs still success path.
      if (u.includes("/logs")) {
        return new Response(JSON.stringify({ execution: { id: "exec-1" }, logs: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const bridge = createExecutionBridge({
      apiBaseUrl: "https://app.keeperhub.example",
      apiKey: "kh_test",
      network: "sepolia",
      workflowIds: { defend: "wf-defend-1" },
    });

    const receipt = await bridge.execute(
      "defend",
      { intentId: "intent-1", legs: [] },
      { idempotencyKey: "desk-defend-test" },
    );

    expect(receipt.keeperHubRunId).toBe("exec-1");
    expect(receipt.txHash).toBe("0xabc");
    expect(receipt.explorerUrl).toContain("0xabc");
    expect(receipt.executionAudit?.submit.status).toBe("started");
    expect(receipt.executionAudit?.submit.keeperHubRunId).toBe("exec-1");
    expect(receipt.executionAudit?.submit.workflowId).toBe("wf-defend-1");
    expect(receipt.executionAudit?.submit.workflowAction).toBe("defend");
    expect(receipt.executionAudit?.outcome?.status).toBe("filled");
    expect(receipt.executionAudit?.outcome?.txHashes).toEqual(["0xabc"]);
    expect(receipt.executionAudit?.outcome?.logsFetched).toBe(true);
    expect(receipt.executionAudit?.outcome?.runNodes).toEqual([]);

    const executeCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/workflows/wf-defend-1/execute"),
    );
    expect(executeCall).toBeTruthy();
    expect(executeCall![1]?.method).toBe("POST");
    const headers = executeCall![1]?.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer kh_test");
    expect(headers.get("Idempotency-Key")).toBe("desk-defend-test");

    const logsCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes("/logs"));
    expect(logsCalls).toHaveLength(1);
  });

  it("after poll success, fetches /logs once and attaches run nodes", async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/execute") && init?.method === "POST") {
        return new Response(JSON.stringify({ executionId: "exec-logs" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (u.includes("/wait") || u.includes("/status")) {
        return new Response(
          JSON.stringify({
            executionId: "exec-logs",
            status: "completed",
            completed: true,
            transactionHash: "0xswap",
            transactionLink: "https://sepolia.etherscan.io/tx/0xswap",
            // No top-level gas — nodes should derive units.
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (u.includes("/logs")) {
        return new Response(
          JSON.stringify({
            execution: { id: "exec-logs", status: "success" },
            logs: [
              {
                nodeId: "swap-1",
                nodeName: "Swap",
                nodeType: "web3/write-contract",
                status: "success",
                duration: "1200",
                startedAt: "2024-01-01T00:00:02Z",
                completedAt: "2024-01-01T00:00:03Z",
                output: {
                  success: true,
                  transactionHash: "0xswap",
                  gasUsed: "2100000882000",
                  gasUsedUnits: "61234",
                  transactionLink: "https://sepolia.etherscan.io/tx/0xswap",
                },
              },
              {
                nodeId: "approve-1",
                nodeName: "Approve USDC",
                nodeType: "web3/approve-token",
                status: "success",
                duration: "800",
                startedAt: "2024-01-01T00:00:00Z",
                completedAt: "2024-01-01T00:00:01Z",
                output: {
                  success: true,
                  transactionHash: "0xapprove",
                  gasUsed: "1000000000000",
                  gasUsedUnits: "21000",
                  transactionLink: "https://sepolia.etherscan.io/tx/0xapprove",
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const bridge = createExecutionBridge({
      apiBaseUrl: "https://app.keeperhub.example",
      apiKey: "kh_test",
      network: "sepolia",
      workflowIds: { defend: "wf-defend-1" },
    });

    const receipt = await bridge.execute("defend", { intentId: "i1" });
    expect(receipt.executionAudit?.outcome?.status).toBe("filled");
    expect(receipt.executionAudit?.outcome?.logsFetched).toBe(true);
    expect(receipt.executionAudit?.outcome?.runNodes).toHaveLength(2);
    // Sorted ascending by startedAt: approve then swap.
    expect(receipt.executionAudit?.outcome?.runNodes?.[0]?.nodeName).toBe(
      "Approve USDC",
    );
    expect(receipt.executionAudit?.outcome?.runNodes?.[1]?.nodeName).toBe("Swap");
    expect(receipt.executionAudit?.outcome?.runNodes?.[1]?.gasUsedUnits).toBe("61234");
    // Derived gas units when wait payload had none.
    expect(receipt.executionAudit?.outcome?.gasUsed).toBe("82234");
    expect(receipt.gasUsed).toBe("82234");

    const logsCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes("/logs"));
    expect(logsCalls).toHaveLength(1);
  });

  it("logs 500 soft-fails: outcome still filled, logsFetched false", async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/execute") && init?.method === "POST") {
        return new Response(JSON.stringify({ executionId: "exec-soft" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (u.includes("/wait") || u.includes("/status")) {
        return new Response(
          JSON.stringify({
            executionId: "exec-soft",
            status: "completed",
            completed: true,
            transactionHash: "0xok",
            transactionLink: "https://sepolia.etherscan.io/tx/0xok",
            gasUsedUnits: "50000",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (u.includes("/logs")) {
        return new Response("internal error", { status: 500 });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const bridge = createExecutionBridge({
      apiBaseUrl: "https://app.keeperhub.example",
      apiKey: "kh_test",
      network: "sepolia",
      workflowIds: { defend: "wf-defend-1" },
    });

    const receipt = await bridge.execute("defend", { intentId: "i1" });
    expect(receipt.txHash).toBe("0xok");
    expect(receipt.executionAudit?.outcome?.status).toBe("filled");
    expect(receipt.executionAudit?.outcome?.txHashes).toEqual(["0xok"]);
    expect(receipt.executionAudit?.outcome?.logsFetched).toBe(false);
    expect(receipt.executionAudit?.outcome?.logsFetchError).toMatch(/logs HTTP 500/);
    expect(receipt.executionAudit?.outcome?.runNodes).toEqual([]);
    // Receipt gas from wait payload still present (not wiped by logs fail).
    expect(receipt.executionAudit?.outcome?.gasUsed).toBe("50000");
  });

  it("records all multi-leg transaction hashes from KeeperHub", async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/execute") && init?.method === "POST") {
        return new Response(JSON.stringify({ executionId: "exec-rotate" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (u.includes("/wait") || u.includes("/status")) {
        return new Response(
          JSON.stringify({
            executionId: "exec-rotate",
            status: "completed",
            completed: true,
            transactionHashes: [
              {
                hash: "0xwithdraw",
                transactionLink: "https://sepolia.etherscan.io/tx/0xwithdraw",
              },
              {
                hash: "0xswap",
                transactionLink: "https://sepolia.etherscan.io/tx/0xswap",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (u.includes("/logs")) {
        return new Response(JSON.stringify({ logs: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const bridge = createExecutionBridge({
      apiBaseUrl: "https://app.keeperhub.example",
      apiKey: "kh_test",
      network: "sepolia",
      workflowIds: { rotate: "wf-rotate-1" },
    });

    const receipt = await bridge.execute("rotate", { intentId: "i1" });
    expect(receipt.txHash).toBe("0xwithdraw");
    expect(receipt.txHashes).toEqual(["0xwithdraw", "0xswap"]);
    expect(receipt.explorerUrls?.[1]).toContain("0xswap");
  });

  it("maps strategies to actions", () => {
    const bridge = createExecutionBridge({
      apiBaseUrl: "https://app.keeperhub.example",
      apiKey: "kh_test",
      network: "sepolia",
      workflowIds: {
        defend: "a",
        rotate: "b",
        oracleArb: "c",
      },
    });
    expect(bridge.actionForStrategy("risk_defend")).toBe("defend");
    expect(bridge.actionForStrategy("yield_rotation")).toBe("rotate");
    expect(bridge.actionForStrategy("oracle_amm")).toBe("oracle_arb");
  });

  it("throws on completed=true with status=error (does not fake success)", async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/execute") && init?.method === "POST") {
        return new Response(JSON.stringify({ executionId: "exec-err" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (u.includes("/wait") || u.includes("/status")) {
        return new Response(
          JSON.stringify({
            executionId: "exec-err",
            status: "error",
            completed: true,
            transactionHashes: [],
            error: "Contract call failed: Error(32)",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      // Failure path still attempts Layer B logs (soft).
      if (u.includes("/logs")) {
        return new Response(
          JSON.stringify({
            logs: [
              {
                nodeId: "fail-node",
                nodeName: "Write",
                nodeType: "web3/write-contract",
                status: "error",
                error: "Contract call failed: Error(32)",
                startedAt: "2024-01-01T00:00:00Z",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const bridge = createExecutionBridge({
      apiBaseUrl: "https://app.keeperhub.example",
      apiKey: "kh_test",
      network: "sepolia",
      workflowIds: { rotate: "wf-rotate-1" },
    });

    try {
      await bridge.execute("rotate", { direction: "out_of_aave_link" });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(isDeskWorkflowExecutionError(error)).toBe(true);
      if (isDeskWorkflowExecutionError(error)) {
        expect(error.message).toMatch(/Contract call failed: Error\(32\)/);
        expect(error.keeperHubRunId).toBe("exec-err");
        expect(error.executionAudit.submit.status).toBe("started");
        expect(error.executionAudit.submit.keeperHubRunId).toBe("exec-err");
        expect(error.executionAudit.outcome?.status).toBe("failed");
        expect(error.executionAudit.outcome?.errorMessage).toMatch(
          /Contract call failed/,
        );
        expect(error.executionAudit.outcome?.logsFetched).toBe(true);
        expect(error.executionAudit.outcome?.runNodes?.[0]?.nodeId).toBe("fail-node");
      }
    }
  });

  it("records submit with runId before wait completes (wait:false)", async () => {
    let executeResolved = false;
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/execute") && init?.method === "POST") {
        executeResolved = true;
        return new Response(JSON.stringify({ executionId: "exec-async" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      // wait/status should not be called when wait:false
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const bridge = createExecutionBridge({
      apiBaseUrl: "https://app.keeperhub.example",
      apiKey: "kh_test",
      network: "sepolia",
      workflowIds: { defend: "wf-defend-1" },
      routingPolicy: {
        enabled: true,
        strict: true,
        provider: "flashbots_protect",
        chainId: 11_155_111,
      },
    });

    const receipt = await bridge.execute(
      "defend",
      { intentId: "i1" },
      { wait: false, idempotencyKey: "async-key" },
    );

    expect(executeResolved).toBe(true);
    expect(receipt.status).toBe("started");
    expect(receipt.executionAudit?.submit.status).toBe("started");
    expect(receipt.executionAudit?.submit.keeperHubRunId).toBe("exec-async");
    expect(receipt.executionAudit?.submit.routing).toBe("private_mempool");
    expect(receipt.executionAudit?.outcome).toBeUndefined();
    expect(fetchMock.mock.calls.every((c) => !String(c[0]).includes("/wait"))).toBe(
      true,
    );
  });

  it("logs desk_workflow started + succeeded when execLogRepo is set", async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/execute") && init?.method === "POST") {
        return new Response(JSON.stringify({ executionId: "exec-log" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (u.includes("/wait") || u.includes("/status")) {
        return new Response(
          JSON.stringify({
            executionId: "exec-log",
            status: "completed",
            completed: true,
            transactionHash: "0xabc",
            transactionLink: "https://sepolia.etherscan.io/tx/0xabc",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (u.includes("/logs")) {
        return new Response(JSON.stringify({ logs: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const append = vi.fn().mockResolvedValue({ ok: true, value: {} });
    const bridge = createExecutionBridge({
      apiBaseUrl: "https://app.keeperhub.example",
      apiKey: "kh_test",
      network: "sepolia",
      workflowIds: { defend: "wf-defend-1" },
      execLogRepo: {
        append,
        listByEntity: vi.fn(),
        listRecent: vi.fn(),
        listPage: vi.fn(),
      } as never,
    });

    const intentUuid = "22222222-2222-4222-8222-222222222222";
    await bridge.execute(
      "defend",
      { intentId: intentUuid },
      { idempotencyKey: "k1" },
    );

    expect(append).toHaveBeenCalledTimes(2);
    expect(append.mock.calls[0]?.[0]).toMatchObject({
      action_type: "desk_workflow",
      status: "started",
      entity_id: intentUuid,
      entity_type: "desk_intent",
      details: expect.objectContaining({ method: "defend", action: "defend" }),
    });
    expect(append.mock.calls[1]?.[0]).toMatchObject({
      action_type: "desk_workflow",
      status: "succeeded",
      details: expect.objectContaining({
        keeper_hub_run_id: "exec-log",
        tx_hash: "0xabc",
      }),
    });
  });

  it("includes private routing metadata when routingPolicy is set", async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/execute") && init?.method === "POST") {
        return new Response(JSON.stringify({ executionId: "exec-route" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (u.includes("/wait") || u.includes("/status")) {
        return new Response(
          JSON.stringify({
            executionId: "exec-route",
            status: "completed",
            completed: true,
            transactionHash: "0xdef",
            transactionLink: "https://sepolia.etherscan.io/tx/0xdef",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (u.includes("/logs")) {
        return new Response(JSON.stringify({ logs: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const append = vi.fn().mockResolvedValue({ ok: true, value: {} });
    const bridge = createExecutionBridge({
      apiBaseUrl: "https://app.keeperhub.example",
      apiKey: "kh_test",
      network: "sepolia",
      workflowIds: { rotate: "wf-rotate-1" },
      routingPolicy: {
        enabled: true,
        strict: true,
        provider: "flashbots_protect",
        chainId: 11_155_111,
      },
      execLogRepo: {
        append,
        listByEntity: vi.fn(),
        listRecent: vi.fn(),
        listPage: vi.fn(),
      } as never,
    });

    await bridge.execute("rotate", {}, { idempotencyKey: "k-route" });

    expect(append.mock.calls[0]?.[0]).toMatchObject({
      details: expect.objectContaining({
        routing: "private_mempool",
        routingRequested: "private_mempool",
        routingApplied: "unknown",
        routingStrict: true,
        routingProvider: "flashbots_protect",
        chainId: 11_155_111,
      }),
    });
  });
});
