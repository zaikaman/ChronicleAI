import { afterEach, describe, expect, it, vi } from "vitest";
import { createExecutionBridge } from "../desk/execution-bridge.ts";

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

    const executeCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/workflows/wf-defend-1/execute"),
    );
    expect(executeCall).toBeTruthy();
    expect(executeCall![1]?.method).toBe("POST");
    const headers = executeCall![1]?.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer kh_test");
    expect(headers.get("Idempotency-Key")).toBe("desk-defend-test");
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
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const bridge = createExecutionBridge({
      apiBaseUrl: "https://app.keeperhub.example",
      apiKey: "kh_test",
      network: "sepolia",
      workflowIds: { rotate: "wf-rotate-1" },
    });

    await expect(bridge.execute("rotate", { direction: "out_of_aave_link" })).rejects.toThrow(
      /Contract call failed: Error\(32\)/,
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
});
