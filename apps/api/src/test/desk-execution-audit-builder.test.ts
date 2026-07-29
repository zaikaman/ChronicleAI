import { describe, expect, it } from "vitest";
import { createExecutionAuditBuilder } from "../desk/execution-audit-builder.ts";
import {
  buildOutcomeStage,
  buildSubmitStage,
} from "../desk/execution-audit.ts";

describe("ExecutionAuditBuilder", () => {
  it("records policy preflight → submit → outcome with stable summary", () => {
    const builder = createExecutionAuditBuilder();
    builder.recordPolicyPreflight({
      at: "2026-07-28T12:00:00.000Z",
      allow: true,
      reasonCodes: ["hf_ok"],
      simulatedHfAfter: 1.5,
      gasRegime: "normal",
      notionalUsdc: 25,
      strategy: "risk_defend",
    });
    builder.recordSubmit({
      at: "2026-07-28T12:00:01.000Z",
      status: "started",
      keeperHubRunId: "run_abc",
      workflowId: "wf_defend",
      workflowAction: "defend",
      routing: "private_mempool",
    });
    builder.recordOutcome({
      at: "2026-07-28T12:00:08.000Z",
      status: "filled",
      txHashes: ["0xabc"],
      gasUsed: "61234",
    });

    const audit = builder.build();
    expect(audit.version).toBe(1);
    expect(audit.stages.preflight.status).toBe("passed");
    expect(audit.stages.preflight.policy?.allow).toBe(true);
    expect(audit.stages.submit.keeperHubRunId).toBe("run_abc");
    expect(audit.stages.outcome.status).toBe("filled");
    expect(audit.summaryLine).toContain("Preflight passed");
    expect(audit.summaryLine).toContain("Submit run");
    expect(audit.summaryLine).toContain("private");
    expect(audit.summaryLine).toContain("61234 gas");
  });

  it("defaults missing stages to skipped", () => {
    const builder = createExecutionAuditBuilder();
    builder.recordPolicyPreflight({
      allow: false,
      reasonCodes: ["gas_critical"],
      status: "failed",
    });
    const audit = builder.build("2026-07-28T00:00:00.000Z");
    expect(audit.stages.preflight.status).toBe("failed");
    expect(audit.stages.submit.status).toBe("skipped");
    expect(audit.stages.outcome.status).toBe("skipped");
    expect(audit.summaryLine).toMatch(/Preflight failed/);
  });

  it("merges bridge submit/outcome fragments without wiping preflight", () => {
    const builder = createExecutionAuditBuilder();
    builder.recordPolicyPreflight({
      allow: true,
      reasonCodes: ["ok"],
      strategy: "oracle_amm",
    });
    builder.mergeSubmit(
      buildSubmitStage({
        status: "started",
        keeperHubRunId: "exec-1",
        workflowAction: "oracle_arb",
        routing: "public",
      }),
    );
    builder.mergeOutcome(
      buildOutcomeStage({
        status: "failed",
        errorMessage: "Contract call failed",
        txHashes: [],
      }),
    );
    const audit = builder.build();
    expect(audit.stages.preflight.policy?.strategy).toBe("oracle_amm");
    expect(audit.stages.submit.keeperHubRunId).toBe("exec-1");
    expect(audit.stages.outcome.status).toBe("failed");
    expect(audit.stages.outcome.errorMessage).toContain("Contract call failed");
  });
});
