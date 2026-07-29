import { describe, expect, it } from "vitest";
import {
  attachRunNodesToOutcome,
  DESK_AUDIT_RUN_NODES_MAX,
  deriveGasFromRunNodes,
  fetchAndNormalizeExecutionLogs,
  normalizeKeeperHubExecutionLogs,
  normalizeKeeperHubLogRow,
  type KeeperHubExecutionLogsResponse,
} from "../desk/keeperhub-execution-logs.ts";
import { buildOutcomeStage, buildRunNode } from "../desk/execution-audit.ts";

/** Fixture shaped like keeperhub/docs/api/executions.md sample (desc order). */
const KH_DOCS_SAMPLE_LOGS: KeeperHubExecutionLogsResponse = {
  execution: {
    id: "exec_123",
    status: "success",
    gasUsedWei: "4200001764000",
  },
  logs: [
    {
      id: "log_002",
      executionId: "exec_123",
      nodeId: "swap-1",
      nodeName: "Swap",
      nodeType: "web3/write-contract",
      status: "success",
      input: { secret: "must-not-leak" },
      output: {
        success: true,
        transactionHash: "0xswap",
        gasUsed: "2100000882000",
        gasUsedUnits: "42000",
        effectiveGasPrice: "50000021",
        transactionLink: "https://sepolia.etherscan.io/tx/0xswap",
      },
      error: null,
      duration: "2100",
      startedAt: "2024-01-01T00:00:02Z",
      completedAt: "2024-01-01T00:00:04Z",
    },
    {
      id: "log_001",
      executionId: "exec_123",
      nodeId: "transfer-1",
      nodeName: "Approve USDC",
      nodeType: "web3/approve-token",
      status: "success",
      input: { amount: "100" },
      output: {
        success: true,
        transactionHash: "0xapprove",
        gasUsed: "2100000882000",
        gasUsedUnits: "21000",
        effectiveGasPrice: "100000042",
        transactionLink: "https://sepolia.etherscan.io/tx/0xapprove",
      },
      error: null,
      duration: "1850",
      startedAt: "2024-01-01T00:00:00Z",
      completedAt: "2024-01-01T00:00:01Z",
    },
    {
      id: "log_000",
      executionId: "exec_123",
      nodeId: "trigger-1",
      nodeName: "Manual trigger",
      nodeType: "trigger",
      status: "success",
      output: { success: true, data: { triggered: true } },
      error: null,
      duration: "12",
      startedAt: "2024-01-01T00:00:00Z",
      completedAt: "2024-01-01T00:00:00Z",
    },
  ],
};

describe("keeperhub-execution-logs normalizer", () => {
  it("maps KH docs sample rows and sorts by startedAt ascending", () => {
    const result = normalizeKeeperHubExecutionLogs(KH_DOCS_SAMPLE_LOGS);
    expect(result.parsed).toBe(true);
    expect(result.rawCount).toBe(3);
    expect(result.truncated).toBe(false);
    expect(result.nodes).toHaveLength(3);

    // Ascending narrative order: trigger/approve first (00:00:00), then swap (00:00:02).
    // Approve and trigger share startedAt — stable by nodeId after time.
    expect(result.nodes.map((n) => n.nodeId)).toEqual([
      "transfer-1",
      "trigger-1",
      "swap-1",
    ]);

    const approve = result.nodes.find((n) => n.nodeId === "transfer-1");
    expect(approve).toMatchObject({
      nodeName: "Approve USDC",
      nodeType: "web3/approve-token",
      status: "success",
      durationMs: 1850,
      txHash: "0xapprove",
      explorerUrl: "https://sepolia.etherscan.io/tx/0xapprove",
      gasUsed: "2100000882000",
      gasUsedUnits: "21000",
    });
    // Never leak raw input/output.
    expect(approve).not.toHaveProperty("input");
    expect(approve).not.toHaveProperty("output");
    expect(JSON.stringify(result.nodes)).not.toContain("must-not-leak");
  });

  it("normalizeKeeperHubLogRow returns null without nodeId", () => {
    expect(normalizeKeeperHubLogRow({ status: "success" })).toBeNull();
    expect(normalizeKeeperHubLogRow(null)).toBeNull();
  });

  it("caps public list at DESK_AUDIT_RUN_NODES_MAX", () => {
    const logs = Array.from({ length: 25 }, (_, i) => ({
      nodeId: `n-${String(i).padStart(2, "0")}`,
      nodeName: `Step ${i}`,
      nodeType: "code/run-code",
      status: "success",
      duration: "10",
      startedAt: `2024-01-01T00:00:${String(i).padStart(2, "0")}Z`,
    }));
    const result = normalizeKeeperHubExecutionLogs({ logs });
    expect(result.rawCount).toBe(25);
    expect(result.truncated).toBe(true);
    expect(result.nodes).toHaveLength(DESK_AUDIT_RUN_NODES_MAX);
    expect(result.nodes[0]?.nodeId).toBe("n-00");
    expect(result.nodes[DESK_AUDIT_RUN_NODES_MAX - 1]?.nodeId).toBe("n-19");
  });

  it("returns parsed:false when logs array missing", () => {
    expect(normalizeKeeperHubExecutionLogs({})).toEqual({
      nodes: [],
      parsed: false,
      rawCount: 0,
      truncated: false,
    });
    expect(normalizeKeeperHubExecutionLogs(null)).toMatchObject({ parsed: false });
  });

  it("deriveGasFromRunNodes sums successful web3 units (derived)", () => {
    const nodes = normalizeKeeperHubExecutionLogs(KH_DOCS_SAMPLE_LOGS).nodes;
    const derived = deriveGasFromRunNodes(nodes);
    // 21000 + 42000 from approve + swap; trigger has no gas.
    expect(derived.gasUsedUnits).toBe("63000");
    // Wei costs from dual-field rows.
    expect(derived.gasUsedWei).toBe(
      (BigInt("2100000882000") + BigInt("2100000882000")).toString(),
    );
  });

  it("attachRunNodesToOutcome prefers receipt gas over derived", () => {
    const outcome = buildOutcomeStage({
      status: "filled",
      txHashes: ["0xabc"],
      gasUsed: "99999",
      gasUsedWei: "1",
    });
    const attached = attachRunNodesToOutcome(outcome, {
      logsFetched: true,
      logsFetchError: null,
      nodes: [
        buildRunNode({
          nodeId: "n1",
          status: "success",
          nodeType: "web3/transfer-funds",
          gasUsedUnits: "21000",
          gasUsed: "100",
          txHash: "0xabc",
        }),
      ],
      derivedGasUsedUnits: "21000",
      derivedGasUsedWei: "100",
      rawCount: 1,
      truncated: false,
    });
    expect(attached.gasUsed).toBe("99999");
    expect(attached.gasUsedWei).toBe("1");
    expect(attached.logsFetched).toBe(true);
    expect(attached.runNodes).toHaveLength(1);
  });

  it("attachRunNodesToOutcome fills gas from derived when receipt gas missing", () => {
    const outcome = buildOutcomeStage({
      status: "filled",
      txHashes: ["0xabc"],
    });
    const attached = attachRunNodesToOutcome(outcome, {
      logsFetched: true,
      nodes: [],
      derivedGasUsedUnits: "63000",
      derivedGasUsedWei: "4200",
      rawCount: 0,
      truncated: false,
    });
    expect(attached.gasUsed).toBe("63000");
    expect(attached.gasUsedWei).toBe("4200");
  });

  it("fetchAndNormalizeExecutionLogs soft-fails on HTTP 500", async () => {
    const result = await fetchAndNormalizeExecutionLogs("exec-x", async () => {
      return new Response("boom", { status: 500 });
    });
    expect(result.logsFetched).toBe(false);
    expect(result.logsFetchError).toMatch(/logs HTTP 500/);
    expect(result.nodes).toEqual([]);
  });

  it("fetchAndNormalizeExecutionLogs maps success body", async () => {
    const result = await fetchAndNormalizeExecutionLogs("exec_123", async (path) => {
      expect(path).toBe("/api/workflows/executions/exec_123/logs");
      return new Response(JSON.stringify(KH_DOCS_SAMPLE_LOGS), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    expect(result.logsFetched).toBe(true);
    expect(result.logsFetchError).toBeNull();
    expect(result.nodes).toHaveLength(3);
    expect(result.derivedGasUsedUnits).toBe("63000");
  });
});
