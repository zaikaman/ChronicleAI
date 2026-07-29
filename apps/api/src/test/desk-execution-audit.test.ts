import { describe, expect, it } from "vitest";
import {
  buildExecutionAudit,
  buildGasNarrative,
  buildOutcomeStage,
  buildPreflightStage,
  buildRunNode,
  buildSubmitStage,
  buildSummaryLine,
  emptyAuditSkeleton,
  formatAuditGas,
  isDeskExecutionAuditV1,
  parseExecutionAuditFromPayload,
  publicExecutionAuditFields,
  redactRunNodeForPublic,
  toExecutionAuditLogDetails,
  toPublicExecutionAudit,
  type DeskExecutionAuditV1,
} from "../desk/execution-audit.ts";
import { createExecutionAuditBuilder } from "../desk/execution-audit-builder.ts";

function sampleFilledAudit(
  overrides?: Partial<{
    privateRouting: boolean;
    gasUsed: string;
    khSim: boolean;
    runNodes: boolean;
  }>,
): DeskExecutionAuditV1 {
  const privateRouting = overrides?.privateRouting ?? true;
  const gasUsed = overrides?.gasUsed ?? "61234";
  return buildExecutionAudit({
    preflight: buildPreflightStage({
      at: "2026-07-28T12:00:00.000Z",
      status: "passed",
      policy: {
        allow: true,
        reasonCodes: ["hf_ok", "gas_normal"],
        simulatedHfAfter: 1.42,
        gasRegime: "normal",
        notionalUsdc: 25,
        strategy: "risk_defend",
      },
      ...(overrides?.khSim
        ? {
            khSimulate: {
              attempted: true,
              status: "passed" as const,
              wouldRevert: false,
              gasEstimate: "55000",
              endpoint: "contract-call" as const,
            },
          }
        : {}),
    }),
    submit: buildSubmitStage({
      at: "2026-07-28T12:00:01.000Z",
      status: "started",
      keeperHubRunId: "run_abc123",
      workflowId: "wf_defend",
      workflowAction: "defend",
      idempotencyKey: "intent-1-defend",
      routing: privateRouting ? "private_mempool" : "public",
      routingStrict: privateRouting,
      routingProvider: privateRouting ? "flashbots_protect" : null,
      chainId: 11155111,
      network: "sepolia",
    }),
    outcome: buildOutcomeStage({
      at: "2026-07-28T12:00:08.000Z",
      status: "filled",
      terminalKhStatus: "succeeded",
      txHashes: ["0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"],
      gasUsed,
      gasUsedWei: "1234567890",
      ...(overrides?.runNodes
        ? {
            runNodes: [
              buildRunNode({
                nodeId: "n1",
                nodeName: "aave_repay",
                nodeType: "web3_write",
                status: "succeeded",
                durationMs: 1200,
                txHash: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
                gasUsed: "61234",
                gasUsedUnits: "61234",
              }),
            ],
            logsFetched: true,
          }
        : {}),
    }),
  });
}

describe("execution-audit types & builders", () => {
  it("emptyAuditSkeleton has version 1 and skipped stages", () => {
    const skeleton = emptyAuditSkeleton("2026-07-28T00:00:00.000Z");
    expect(skeleton.version).toBe(1);
    expect(skeleton.stages.preflight.id).toBe("preflight");
    expect(skeleton.stages.preflight.status).toBe("skipped");
    expect(skeleton.stages.submit.status).toBe("skipped");
    expect(skeleton.stages.outcome.status).toBe("skipped");
    expect(skeleton.stages.outcome.txHashes).toEqual([]);
    expect(skeleton.summaryLine).toContain("Preflight skipped");
    expect(skeleton.summaryLine).toContain("Submit skipped");
  });

  it("buildExecutionAudit recomputes summaryLine from stages", () => {
    const audit = sampleFilledAudit();
    expect(audit.summaryLine).toBe(
      "Preflight passed → Submit run · private → Filled · 61234 gas",
    );
  });

  it("buildRunNode never accepts or stores raw input/output", () => {
    const node = buildRunNode({
      nodeId: "n1",
      status: "succeeded",
      nodeName: "swap",
    });
    expect(node).toEqual({
      nodeId: "n1",
      status: "succeeded",
      nodeName: "swap",
    });
    expect("input" in node).toBe(false);
    expect("output" in node).toBe(false);
  });

  it("isDeskExecutionAuditV1 accepts valid and rejects garbage", () => {
    expect(isDeskExecutionAuditV1(sampleFilledAudit())).toBe(true);
    expect(isDeskExecutionAuditV1(null)).toBe(false);
    expect(isDeskExecutionAuditV1({ version: 1 })).toBe(false);
    expect(isDeskExecutionAuditV1({ version: 2, summaryLine: "", stages: {} })).toBe(
      false,
    );
  });

  it("parseExecutionAuditFromPayload reads sibling executionAudit", () => {
    const audit = sampleFilledAudit();
    expect(parseExecutionAuditFromPayload({ executionAudit: audit })).toEqual(audit);
    expect(parseExecutionAuditFromPayload({ version: 1, legs: [] })).toBeNull();
    expect(parseExecutionAuditFromPayload(null)).toBeNull();
  });
});

describe("buildSummaryLine", () => {
  it("happy path: private fill with gas", () => {
    const line = buildSummaryLine(sampleFilledAudit());
    expect(line).toBe(
      "Preflight passed → Submit run · private → Filled · 61234 gas",
    );
  });

  it("includes KH sim status when present", () => {
    const line = buildSummaryLine(sampleFilledAudit({ khSim: true }));
    expect(line).toContain("· KH sim passed");
    expect(line).toContain("Preflight passed · KH sim passed → Submit run");
  });

  it("uses submit status when no run id", () => {
    const audit = buildExecutionAudit({
      preflight: buildPreflightStage({
        at: "2026-07-28T12:00:00.000Z",
        status: "failed",
        policy: {
          allow: false,
          reasonCodes: ["simulated_hf_below_warn"],
        },
        notes: "simulated_hf_below_warn",
      }),
      submit: buildSubmitStage({
        at: "2026-07-28T12:00:00.000Z",
        status: "skipped",
      }),
      outcome: buildOutcomeStage({
        at: "2026-07-28T12:00:00.000Z",
        status: "unknown",
      }),
    });
    expect(audit.summaryLine).toBe(
      "Preflight failed → Submit skipped → Unknown · simulated_hf_below_warn",
    );
  });

  it("appends truncated error on failed outcome", () => {
    const long =
      "insufficient allowance for token transfer on secondary leg after first hop completed successfully and left residual debt";
    const audit = buildExecutionAudit({
      preflight: buildPreflightStage({
        at: "2026-07-28T12:00:00.000Z",
        status: "passed",
      }),
      submit: buildSubmitStage({
        at: "2026-07-28T12:00:01.000Z",
        status: "started",
        keeperHubRunId: "run_fail",
      }),
      outcome: buildOutcomeStage({
        at: "2026-07-28T12:00:05.000Z",
        status: "failed",
        errorMessage: long,
      }),
    });
    expect(audit.summaryLine).toContain("→ Failed ·");
    expect(audit.summaryLine.length).toBeLessThanOrEqual(240);
    expect(audit.summaryLine).toMatch(/…$/);
  });

  it("omits private badge for public routing", () => {
    const line = buildSummaryLine(sampleFilledAudit({ privateRouting: false }));
    expect(line).not.toContain("private");
    expect(line).toContain("Submit run → Filled");
  });

  it("caps summary at 240 characters", () => {
    const audit = buildExecutionAudit({
      preflight: buildPreflightStage({
        at: "2026-07-28T12:00:00.000Z",
        status: "passed",
      }),
      submit: buildSubmitStage({
        at: "2026-07-28T12:00:01.000Z",
        status: "started",
        keeperHubRunId: "run_x",
        routing: "private_mempool",
      }),
      outcome: buildOutcomeStage({
        at: "2026-07-28T12:00:05.000Z",
        status: "failed",
        gasUsed: "999999",
        errorMessage: "x".repeat(400),
      }),
    });
    expect(audit.summaryLine.length).toBeLessThanOrEqual(240);
  });

  it("formatAuditGas strips leading zeros without inventing precision", () => {
    expect(formatAuditGas("061234")).toBe("61234");
    expect(formatAuditGas("0")).toBe("0");
    expect(formatAuditGas("  42  ")).toBe("42");
  });
});

describe("public redaction", () => {
  it("redactRunNodeForPublic drops raw input/output and secrets", () => {
    const raw = {
      nodeId: "node-1",
      nodeName: "morpho_supply",
      status: "succeeded",
      durationMs: 800,
      txHash: "0xabc",
      gasUsed: 42000,
      gasUsedUnits: "42000",
      input: { calldata: "0xsecret", privateKey: "0xdead" },
      output: { receipt: { logs: [] } },
      apiKey: "should-not-appear",
      authorization: "Bearer xyz",
    };

    const redacted = redactRunNodeForPublic(raw);
    expect(redacted).not.toBeNull();
    expect(redacted).toEqual({
      nodeId: "node-1",
      nodeName: "morpho_supply",
      status: "succeeded",
      durationMs: 800,
      txHash: "0xabc",
      gasUsed: "42000",
      gasUsedUnits: "42000",
    });
    expect(redacted).not.toHaveProperty("input");
    expect(redacted).not.toHaveProperty("output");
    expect(redacted).not.toHaveProperty("apiKey");
    expect(redacted).not.toHaveProperty("authorization");
    expect(JSON.stringify(redacted)).not.toContain("0xsecret");
    expect(JSON.stringify(redacted)).not.toContain("privateKey");
  });

  it("redactRunNodeForPublic returns null without nodeId", () => {
    expect(redactRunNodeForPublic({ status: "ok" })).toBeNull();
    expect(redactRunNodeForPublic(null)).toBeNull();
    expect(redactRunNodeForPublic("x")).toBeNull();
  });

  it("toPublicExecutionAudit strips forbidden keys from runNodes", () => {
    const dirty: DeskExecutionAuditV1 = sampleFilledAudit({ runNodes: true });
    const dirtyNode = dirty.stages.outcome.runNodes?.[0];
    expect(dirtyNode).toBeDefined();
    // Simulate accidental merge of raw log fields onto a node.
    const dirtyRecord = dirtyNode as unknown as Record<string, unknown>;
    dirtyRecord.input = { secretCalldata: "0xbad" };
    dirtyRecord.output = { logs: ["leak"] };

    const pub = toPublicExecutionAudit(dirty);
    expect(pub).not.toBeNull();
    expect(pub!.stages.outcome.runNodes).toHaveLength(1);
    const node = pub!.stages.outcome.runNodes?.[0];
    expect(node).toBeDefined();
    expect(node).not.toHaveProperty("input");
    expect(node).not.toHaveProperty("output");
    expect(JSON.stringify(node)).not.toContain("0xbad");
    expect(JSON.stringify(node)).not.toContain("leak");
    expect(node?.nodeName).toBe("aave_repay");
    expect(node?.gasUsed).toBe("61234");
  });

  it("toPublicExecutionAudit returns null for missing/invalid audit", () => {
    expect(toPublicExecutionAudit(null)).toBeNull();
    expect(toPublicExecutionAudit(undefined)).toBeNull();
    expect(
      toPublicExecutionAudit({ version: 99 } as unknown as DeskExecutionAuditV1),
    ).toBeNull();
  });

  it("publicExecutionAuditFields exposes convenience gas + summary", () => {
    const fields = publicExecutionAuditFields(sampleFilledAudit());
    expect(fields.executionAuditSummary).toContain("Preflight passed");
    expect(fields.gasUsed).toBe("61234");
    expect(fields.gasUsedWei).toBe("1234567890");
    expect(fields.executionAudit?.version).toBe(1);
  });

  it("publicExecutionAuditFields is null-safe for legacy tickets", () => {
    expect(publicExecutionAuditFields(null)).toEqual({
      executionAudit: null,
      executionAuditSummary: null,
      gasUsed: null,
      gasUsedWei: null,
    });
  });

  it("toExecutionAuditLogDetails mirrors compact Activity fields", () => {
    const details = toExecutionAuditLogDetails(sampleFilledAudit({ runNodes: true }));
    expect(details.execution_audit_version).toBe(1);
    expect(details.execution_audit_summary).toMatch(/Filled/i);
    expect(details.keeper_hub_run_id).toBe("run_abc123");
    expect(details.preflight_status).toBe("passed");
    expect(details.outcome_status).toBe("filled");
    expect(details.gas_used).toBe("61234");
    expect(details.tx_hashes).toHaveLength(1);
    expect(details.logs_node_count).toBe(1);
    expect(details.kh_simulate_status).toBe("skipped");
  });

  it("never invents wouldRevert or gas on public surface", () => {
    const audit = buildExecutionAudit({
      preflight: buildPreflightStage({
        at: "2026-07-28T12:00:00.000Z",
        status: "passed",
      }),
      submit: buildSubmitStage({
        at: "2026-07-28T12:00:01.000Z",
        status: "started",
        keeperHubRunId: "run_1",
      }),
      outcome: buildOutcomeStage({
        at: "2026-07-28T12:00:02.000Z",
        status: "filled",
        txHashes: ["0x1"],
        // intentionally no gasUsed
      }),
    });
    const pub = toPublicExecutionAudit(audit)!;
    expect(pub.stages.outcome.gasUsed).toBeUndefined();
    expect(pub.stages.preflight.khSimulate).toBeUndefined();
    expect(pub.summaryLine).not.toMatch(/\d+ gas/);
    expect(JSON.stringify(pub)).not.toContain("wouldRevert");
  });

  it("buildGasNarrative synthesizes estimate, used, regime correctly", () => {
    const preflight = buildPreflightStage({
      status: "passed",
      policy: { allow: true, reasonCodes: [], gasRegime: "elevated" },
      khSimulate: { attempted: true, status: "passed", gasEstimate: "84212" },
    });
    const outcome = buildOutcomeStage({
      status: "filled",
      gasUsed: "91004",
      gasUsedWei: "91004000000000",
    });

    const narrative = buildGasNarrative(preflight, outcome);
    expect(narrative).toEqual({
      estimate: "84212",
      used: "91004",
      usedWei: "91004000000000",
      regime: "elevated",
      notes: "estimate from Layer A dry-run; used from workflow execution logs",
    });
  });

  it("ExecutionAuditBuilder synthesizes gasNarrative on build()", () => {
    const builder = createExecutionAuditBuilder();
    builder.recordPolicyPreflight({
      allow: true,
      reasonCodes: ["hf_ok"],
      gasRegime: "normal",
    });
    builder.recordKhSimulate({
      attempted: true,
      status: "passed",
      gasEstimate: "50000",
    });
    builder.recordSubmit({
      status: "started",
      keeperHubRunId: "run_99",
    });
    builder.recordOutcome({
      status: "filled",
      gasUsed: "52000",
    });

    const audit = builder.build();
    expect(audit.stages.outcome.gasNarrative).toBeDefined();
    expect(audit.stages.outcome.gasNarrative?.estimate).toBe("50000");
    expect(audit.stages.outcome.gasNarrative?.used).toBe("52000");
    expect(audit.stages.outcome.gasNarrative?.regime).toBe("normal");
    expect(audit.stages.outcome.gasEstimateVsUsed).toEqual({
      estimate: "50000",
      used: "52000",
    });
  });
});
