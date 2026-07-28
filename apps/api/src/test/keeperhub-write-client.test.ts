// Unit tests for KeeperHub write client (Direct Execution + poll)

import { afterEach, describe, expect, it, vi } from "vitest";
import { createKeeperHubWriteClient } from "../services/keeperhub-write-client.ts";

describe("createKeeperHubWriteClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("publishes an alert via contract-call and polls status for tx + explorer URL", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/execute/contract-call") && init?.method === "POST") {
        return new Response(JSON.stringify({ executionId: "direct_alert_1", status: "running" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/api/execute/direct_alert_1/status")) {
        return new Response(
          JSON.stringify({
            executionId: "direct_alert_1",
            status: "completed",
            transactionHash: "0x" + "ab".repeat(32),
            transactionLink: "https://sepolia.basescan.org/tx/0x" + "ab".repeat(32),
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json", "X-Poll-Interval-Hint": "0" },
          },
        );
      }
      // wait endpoint may 404 for direct executions — client falls back to status
      return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createKeeperHubWriteClient({
      apiBaseUrl: "https://app.keeperhub.com",
      apiKey: "kh_test_key",
      network: "base-sepolia",
      registryAddress: "0x" + "11".repeat(20),
      pollIntervalMs: 1,
      pollTimeoutMs: 5_000,
    });

    const receipt = await client.publishAlert(
      "alert-id-1",
      "source-event-hash-1",
      "https://chronicle.example/alerts/alert-id-1",
    );

    expect(receipt.keeperHubRunId).toBe("direct_alert_1");
    expect(receipt.txHash).toBe("0x" + "ab".repeat(32));
    expect(receipt.explorerUrl).toContain("basescan.org");

    const contractCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/api/execute/contract-call"),
    );
    expect(contractCall).toBeDefined();
    const body = JSON.parse(String((contractCall?.[1] as RequestInit).body));
    expect(body.functionName).toBe("publishAlert");
    expect(body.network).toBe("base-sepolia");
    const args = JSON.parse(body.functionArgs as string) as unknown[];
    // IDEA: publishAlert(contentHash, sourceEventHash, contentUri)
    expect(args).toHaveLength(3);
    expect(typeof args[0]).toBe("string"); // contentHash bytes32
    expect(typeof args[1]).toBe("string"); // sourceEventHash bytes32
    expect(args[2]).toBe("https://chronicle.example/alerts/alert-id-1");
  });

  it("sends native transfer via KeeperHub transfer API", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/execute/transfer") && init?.method === "POST") {
        return new Response(JSON.stringify({ executionId: "direct_xfer_1", status: "running" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/api/execute/direct_xfer_1/status")) {
        return new Response(
          JSON.stringify({
            executionId: "direct_xfer_1",
            status: "completed",
            transactionHash: "0x" + "cd".repeat(32),
            transactionLink: "https://sepolia.basescan.org/tx/0x" + "cd".repeat(32),
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("{}", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createKeeperHubWriteClient({
      apiBaseUrl: "https://app.keeperhub.com",
      apiKey: "kh_test_key",
      network: "base-sepolia",
      registryAddress: "0x" + "11".repeat(20),
      pollIntervalMs: 1,
      pollTimeoutMs: 5_000,
    });

    const receipt = await client.sendTransfer("0x" + "22".repeat(20), 0.001);
    expect(receipt.keeperHubRunId).toBe("direct_xfer_1");
    expect(receipt.txHash).toBe("0x" + "cd".repeat(32));
  });

  it("prefers workflow execute when workflow id is configured", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/workflows/wf_publish_alert/execute") && init?.method === "POST") {
        return new Response(JSON.stringify({ executionId: "exec_wf_1", status: "running" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/api/workflows/executions/exec_wf_1/wait")) {
        return new Response(
          JSON.stringify({
            executionId: "exec_wf_1",
            status: "success",
            completed: true,
            transactionHashes: [
              {
                hash: "0x" + "ef".repeat(32),
                transactionLink: "https://sepolia.basescan.org/tx/0x" + "ef".repeat(32),
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
      apiBaseUrl: "https://app.keeperhub.com",
      apiKey: "kh_test_key",
      network: "base-sepolia",
      registryAddress: "0x" + "11".repeat(20),
      workflowIds: { publishAlert: "wf_publish_alert" },
      pollIntervalMs: 1,
      pollTimeoutMs: 5_000,
    });

    const receipt = await client.publishAlert("a1", "source-1", "uri");
    expect(receipt.keeperHubRunId).toBe("exec_wf_1");
    expect(receipt.txHash).toBe("0x" + "ef".repeat(32));
    expect(
      fetchMock.mock.calls.some((c) => String(c[0]).includes("/api/workflows/wf_publish_alert/execute")),
    ).toBe(true);
  });
});
