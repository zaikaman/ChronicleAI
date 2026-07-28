import { describe, expect, it } from "vitest";
import {
  isKeeperHubMcpConfigured,
  resolveKeeperHubMcpUrl,
} from "../services/keeperhub-mcp-client.ts";
import {
  extractExecutionId,
  extractTxFromExecutionPayload,
} from "../agents/langchain/keeperhub-mcp-publication-agent.ts";

describe("resolveKeeperHubMcpUrl", () => {
  it("appends /mcp to the API base URL", () => {
    expect(resolveKeeperHubMcpUrl("https://app.keeperhub.com")).toBe(
      "https://app.keeperhub.com/mcp",
    );
  });

  it("strips trailing slashes and /api suffix", () => {
    expect(resolveKeeperHubMcpUrl("https://app.keeperhub.com/api/")).toBe(
      "https://app.keeperhub.com/mcp",
    );
  });

  it("prefers an explicit MCP URL", () => {
    expect(
      resolveKeeperHubMcpUrl(
        "https://app.keeperhub.com",
        "https://custom.example/mcp/",
      ),
    ).toBe("https://custom.example/mcp");
  });
});

describe("isKeeperHubMcpConfigured", () => {
  it("requires kh_ key, base URL, and enabled flag", () => {
    expect(
      isKeeperHubMcpConfigured({
        keeperhubApiBaseUrl: "https://app.keeperhub.com",
        keeperhubApiKey: "kh_test",
        keeperhubMcpEnabled: true,
      }),
    ).toBe(true);

    expect(
      isKeeperHubMcpConfigured({
        keeperhubApiBaseUrl: "https://app.keeperhub.com",
        keeperhubApiKey: "kh_test",
        keeperhubMcpEnabled: false,
      }),
    ).toBe(false);

    expect(
      isKeeperHubMcpConfigured({
        keeperhubApiBaseUrl: "https://app.keeperhub.com",
        keeperhubApiKey: "not_a_kh_key",
      }),
    ).toBe(false);
  });
});

describe("MCP execution payload parsers", () => {
  it("extracts executionId from nested shapes", () => {
    expect(extractExecutionId({ executionId: "exec_1" })).toBe("exec_1");
    expect(extractExecutionId({ data: { execution_id: "exec_2" } })).toBe(
      "exec_2",
    );
    expect(
      extractExecutionId(JSON.stringify({ result: { id: "exec_3" } })),
    ).toBe("exec_3");
  });

  it("extracts tx hash from get_execution status envelope", () => {
    const tx = "0x" + "ab".repeat(32);
    const found = extractTxFromExecutionPayload({
      status: {
        status: "success",
        completed: true,
        transactionHash: tx,
        transactionLink: `https://sepolia.etherscan.io/tx/${tx}`,
      },
      logs: [],
    });
    expect(found.txHash).toBe(tx);
    expect(found.explorerUrl).toContain("sepolia.etherscan.io");
  });

  it("extracts tx hash from transactionHashes array", () => {
    const tx = "0x" + "cd".repeat(32);
    const found = extractTxFromExecutionPayload({
      status: {
        status: "completed",
        transactionHashes: [
          { hash: tx, transactionLink: `https://sepolia.etherscan.io/tx/${tx}` },
        ],
      },
    });
    expect(found.txHash).toBe(tx);
  });
});
