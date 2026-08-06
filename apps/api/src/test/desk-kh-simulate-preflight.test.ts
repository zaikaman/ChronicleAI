import { describe, expect, it, vi } from "vitest";
import { SEPOLIA_DESK } from "@chronicleai/config";
import {
  assertSimulateTrueOnly,
  buildPrimaryLegSimulateRequest,
  buildWorkflowSimulateLegs,
  createKhSimulatePreflight,
  type KhSimulateRequestBody,
} from "../desk/kh-simulate-preflight.ts";

const DESK = "0x1111111111111111111111111111111111111111";
const API = "https://app.keeperhub.example";
const KEY = "kh_test_key_phase3";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function passSim(gas = "65000"): Response {
  return jsonResponse({
    success: true,
    status: "simulated",
    from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    to: SEPOLIA_DESK.aaveV3Pool,
    gasEstimate: gas,
    wouldRevert: false,
  });
}

describe("buildWorkflowSimulateLegs", () => {
  it("builds approve + repay for risk_defend repay", () => {
    const legs = buildWorkflowSimulateLegs({
      strategy: "risk_defend",
      workflowAction: "defend",
      deskAddress: DESK,
      workflowInput: {
        mode: "repay",
        asset: SEPOLIA_DESK.usdc,
        amount: "10000000",
        deskAddress: DESK,
        network: "11155111",
      },
    });
    expect(legs).toHaveLength(2);
    expect(legs[0]?.kind).toBe("approve");
    expect(legs[0]?.body).toMatchObject({ simulate: true });
    if (!("functionName" in legs[0]!.body)) throw new Error("expected contract-call");
    expect(legs[0]!.body.functionName).toBe("approve");
    expect(legs[0]!.body.contractAddress).toBe(SEPOLIA_DESK.usdc);

    expect(legs[1]?.kind).toBe("aave_repay");
    if (!("functionName" in legs[1]!.body)) throw new Error("expected contract-call");
    expect(legs[1]!.body.functionName).toBe("repay");
    expect(legs[1]!.body.contractAddress).toBe(SEPOLIA_DESK.aaveV3Pool);
    const args = JSON.parse(legs[1]!.body.functionArgs) as unknown[];
    expect(args[0]).toBe(SEPOLIA_DESK.usdc);
    expect(args[1]).toBe("10000000");
    expect(args[2]).toBe(2);
    expect(args[3]).toBe(DESK);
  });

  it("builds approve + swap for oracle_amm (desk-oracle-arb path)", () => {
    const legs = buildWorkflowSimulateLegs({
      strategy: "oracle_amm",
      workflowAction: "oracle_arb",
      deskAddress: DESK,
      workflowInput: {
        tokenIn: SEPOLIA_DESK.usdc,
        tokenOut: SEPOLIA_DESK.weth,
        amountIn: "5000000",
        amountOutMinimum: "0",
        fee: "3000",
        deskAddress: DESK,
      },
    });
    expect(legs).toHaveLength(2);
    expect(legs.map((l) => l.kind)).toEqual(["approve", "swap"]);
    expect(legs[0]?.spender).toBe(SEPOLIA_DESK.uniswapV3SwapRouter02);
    if (!("functionName" in legs[1]!.body)) throw new Error("expected contract-call");
    expect(legs[1]!.body.functionName).toBe("exactInputSingle");
    const args = JSON.parse(legs[1]!.body.functionArgs) as Array<Record<string, unknown>>;
    expect(args[0]?.tokenIn).toBe(SEPOLIA_DESK.usdc);
    expect(args[0]?.recipient).toBe(DESK);
  });

  it("builds full into_aave_link path: approve → swap → approve → supply", () => {
    const legs = buildWorkflowSimulateLegs({
      strategy: "yield_rotation",
      workflowAction: "rotate",
      deskAddress: DESK,
      workflowInput: {
        direction: "into_aave_link",
        amountIn: "10000000",
        amountOutMinimum: "0",
        amountLink: "1000000000000000000",
        deskAddress: DESK,
      },
    });
    expect(legs.map((l) => l.kind)).toEqual([
      "approve",
      "swap",
      "approve",
      "aave_supply",
    ]);
    expect(legs[3]?.balanceFromLegIds).toEqual(["swap-usdc-link"]);
  });

  it("builds out_of_aave_link path: withdraw → approve → swap", () => {
    const legs = buildWorkflowSimulateLegs({
      strategy: "yield_rotation",
      workflowAction: "rotate",
      deskAddress: DESK,
      workflowInput: {
        direction: "out_of_aave_link",
        amountIn: "1000000000000000000",
        amountOutMinimum: "0",
        amountLink: "1000000000000000000",
        deskAddress: DESK,
      },
    });
    expect(legs.map((l) => l.kind)).toEqual(["aave_withdraw", "approve", "swap"]);
    expect(legs[2]?.balanceFromLegIds).toEqual(["aave-withdraw-link"]);
  });

  it("always sets simulate: true on every leg", () => {
    const legs = [
      ...buildWorkflowSimulateLegs({
        strategy: "risk_defend",
        workflowAction: "defend",
        deskAddress: DESK,
        workflowInput: { mode: "repay", asset: SEPOLIA_DESK.usdc, amount: "1" },
      }),
      ...buildWorkflowSimulateLegs({
        strategy: "oracle_amm",
        workflowAction: "oracle_arb",
        deskAddress: DESK,
        workflowInput: {
          tokenIn: SEPOLIA_DESK.usdc,
          tokenOut: SEPOLIA_DESK.weth,
          amountIn: "1",
          amountOutMinimum: "0",
        },
      }),
    ];
    for (const leg of legs) {
      expect(leg.body.simulate).toBe(true);
      assertSimulateTrueOnly(leg.body);
    }
  });
});

describe("buildPrimaryLegSimulateRequest", () => {
  it("returns first non-approve material write (repay, not approve)", () => {
    const built = buildPrimaryLegSimulateRequest({
      strategy: "risk_defend",
      workflowAction: "defend",
      deskAddress: DESK,
      workflowInput: {
        mode: "repay",
        asset: SEPOLIA_DESK.usdc,
        amount: "10000000",
        deskAddress: DESK,
        network: "11155111",
      },
    });
    expect(built.endpoint).toBe("contract-call");
    expect(built.path).toBe("/api/execute/contract-call");
    expect(built.body.simulate).toBe(true);
    if (!("functionName" in built.body)) throw new Error("expected contract-call");
    expect(built.body.functionName).toBe("repay");
    expect(built.body.contractAddress).toBe(SEPOLIA_DESK.aaveV3Pool);
  });

  it("builds Aave withdraw for risk_defend withdraw mode", () => {
    const built = buildPrimaryLegSimulateRequest({
      strategy: "risk_defend",
      workflowAction: "defend",
      deskAddress: DESK,
      workflowInput: {
        mode: "withdraw",
        asset: SEPOLIA_DESK.link,
        amount: "5000000000000000000",
        deskAddress: DESK,
      },
    });
    if (!("functionName" in built.body)) throw new Error("expected contract-call");
    expect(built.body.functionName).toBe("withdraw");
    expect(built.label).toContain("withdraw");
  });

  it("builds Uniswap exactInputSingle for oracle_amm primary", () => {
    const built = buildPrimaryLegSimulateRequest({
      strategy: "oracle_amm",
      workflowAction: "oracle_arb",
      deskAddress: DESK,
      workflowInput: {
        tokenIn: SEPOLIA_DESK.usdc,
        tokenOut: SEPOLIA_DESK.weth,
        amountIn: "5000000",
        amountOutMinimum: "0",
        fee: "3000",
        deskAddress: DESK,
      },
    });
    expect(built.body.simulate).toBe(true);
    if (!("functionName" in built.body)) throw new Error("expected contract-call");
    expect(built.body.functionName).toBe("exactInputSingle");
    expect(built.kind).toBe("swap");
  });
});

describe("assertSimulateTrueOnly", () => {
  it("throws when simulate is not boolean true", () => {
    expect(() =>
      assertSimulateTrueOnly({
        chainId: 11155111,
        recipientAddress: DESK,
        amount: "1",
        simulate: false as unknown as true,
      }),
    ).toThrow(/simulate must be boolean true/);
  });
});

describe("createKhSimulatePreflight multi-leg", () => {
  const baseInput = {
    strategy: "risk_defend" as const,
    workflowAction: "defend" as const,
    deskAddress: DESK,
    workflowInput: {
      mode: "repay",
      asset: SEPOLIA_DESK.usdc,
      amount: "10000000",
      deskAddress: DESK,
      network: "11155111",
    },
  };

  it("returns skipped when disabled (flag off)", async () => {
    const fetchImpl = vi.fn();
    const client = createKhSimulatePreflight({
      apiBaseUrl: API,
      apiKey: KEY,
      enabled: false,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(client.isEnabled()).toBe(false);
    const result = await client.simulateWorkflow(baseInput);
    expect(result.khSimulate.status).toBe("skipped");
    expect(result.khSimulate.attempted).toBe(false);
    expect(result.shouldBlock).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("dry-runs all legs in parallel and sums gas on pass", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as KhSimulateRequestBody;
      expect(body.simulate).toBe(true);
      expect(_url).toBe(`${API}/api/execute/contract-call`);
      const gas =
        "functionName" in body && body.functionName === "approve" ? "45000" : "65000";
      return passSim(gas);
    });
    const client = createKhSimulatePreflight({
      apiBaseUrl: API,
      apiKey: KEY,
      enabled: true,
      strict: false,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await client.simulateWorkflow(baseInput);
    expect(result.shouldBlock).toBe(false);
    expect(result.khSimulate).toMatchObject({
      attempted: true,
      status: "passed",
      wouldRevert: false,
      gasEstimate: "110000", // 45000 + 65000
      endpoint: "contract-call",
      legCount: 2,
      passedLegs: 2,
      failedLegs: 0,
    });
    expect(result.khSimulate.legs).toHaveLength(2);
    expect(result.requestMeta?.simulate).toBe(true);
    expect(result.requestMeta?.legCount).toBe(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("waives allowance revert on repay when co-path approve is present", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as KhSimulateRequestBody;
      if ("functionName" in body && body.functionName === "approve") {
        return passSim("40000");
      }
      // Current-state DE sim of repay without the approve applied yet
      return jsonResponse(
        {
          success: false,
          status: "simulated",
          wouldRevert: true,
          revertReason: "Error(ERC20: insufficient allowance)",
          error: "Error(ERC20: insufficient allowance)",
        },
        400,
      );
    });
    const client = createKhSimulatePreflight({
      apiBaseUrl: API,
      apiKey: KEY,
      enabled: true,
      strict: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await client.simulateWorkflow(baseInput);
    // Workflow has approve first — do not block on current-state allowance miss
    expect(result.shouldBlock).toBe(false);
    expect(result.khSimulate.status).toBe("passed");
    expect(result.khSimulate.wouldRevert).toBe(false);
    expect(result.khSimulate.legs?.some((l) => l.waived === true)).toBe(true);
    const repay = result.khSimulate.legs?.find((l) => l.kind === "aave_repay");
    expect(repay?.waiveReason).toBe("allowance_covered_by_workflow_approve");
    expect(repay?.wouldRevert).toBe(true); // raw still recorded
  });

  it("waives swap allowance miss on oracle_arb when approve leg exists", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as KhSimulateRequestBody;
      if ("functionName" in body && body.functionName === "approve") {
        return passSim("30000");
      }
      return jsonResponse(
        {
          success: false,
          status: "simulated",
          wouldRevert: true,
          revertReason: "Error(ERC20: insufficient allowance)",
        },
        400,
      );
    });
    const client = createKhSimulatePreflight({
      apiBaseUrl: API,
      apiKey: KEY,
      enabled: true,
      strict: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await client.simulateWorkflow({
      strategy: "oracle_amm",
      workflowAction: "oracle_arb",
      deskAddress: DESK,
      workflowInput: {
        tokenIn: SEPOLIA_DESK.usdc,
        tokenOut: SEPOLIA_DESK.weth,
        amountIn: "1000",
        amountOutMinimum: "0",
      },
    });
    expect(result.shouldBlock).toBe(false);
    expect(result.khSimulate.status).toBe("passed");
    expect(result.khSimulate.legCount).toBe(2);
    expect(result.khSimulate.legs?.find((l) => l.kind === "swap")?.waived).toBe(true);
  });

  it("does not waive non-allowance would-revert; soft continues, strict blocks", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as KhSimulateRequestBody;
      if ("functionName" in body && body.functionName === "approve") {
        return passSim("40000");
      }
      return jsonResponse(
        {
          success: false,
          status: "simulated",
          wouldRevert: true,
          revertReason: "Error(execution reverted)",
        },
        400,
      );
    });
    const soft = createKhSimulatePreflight({
      apiBaseUrl: API,
      apiKey: KEY,
      enabled: true,
      strict: false,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const softResult = await soft.simulateWorkflow(baseInput);
    expect(softResult.shouldBlock).toBe(false);
    expect(softResult.khSimulate.status).toBe("failed");
    expect(softResult.khSimulate.wouldRevert).toBe(true);
    expect(softResult.khSimulate.revertReason).toContain("execution reverted");

    const strict = createKhSimulatePreflight({
      apiBaseUrl: API,
      apiKey: KEY,
      enabled: true,
      strict: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const strictResult = await strict.simulateWorkflow(baseInput);
    expect(strictResult.shouldBlock).toBe(true);
    expect(strictResult.blockReason).toBe("kh_simulate_would_revert");
    expect(strictResult.khSimulate.status).toBe("failed");
  });

  it("maps HTTP/transport error as error; soft continues, strict blocks", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: "Internal Server Error" }, 500),
    );
    const soft = createKhSimulatePreflight({
      apiBaseUrl: API,
      apiKey: KEY,
      enabled: true,
      strict: false,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const softResult = await soft.simulateWorkflow(baseInput);
    expect(softResult.shouldBlock).toBe(false);
    expect(softResult.khSimulate.status).toBe("error");

    const strict = createKhSimulatePreflight({
      apiBaseUrl: API,
      apiKey: KEY,
      enabled: true,
      strict: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const strictResult = await strict.simulateWorkflow(baseInput);
    expect(strictResult.shouldBlock).toBe(true);
    expect(strictResult.blockReason).toBe("kh_simulate_error");
  });

  it("leg construction failure: soft continues, strict blocks (no fail-open)", async () => {
    const fetchImpl = vi.fn();
    const badInput = {
      strategy: "not_a_real_strategy",
      workflowAction: "not_a_real_action",
      deskAddress: DESK,
      workflowInput: {},
    };

    const soft = createKhSimulatePreflight({
      apiBaseUrl: API,
      apiKey: KEY,
      enabled: true,
      strict: false,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const softResult = await soft.simulateWorkflow(badInput);
    expect(softResult.shouldBlock).toBe(false);
    expect(softResult.khSimulate.attempted).toBe(false);
    expect(softResult.khSimulate.status).toBe("skipped");
    expect(softResult.khSimulate.errorMessage).toMatch(/unsupported strategy\/action/i);
    expect(fetchImpl).not.toHaveBeenCalled();

    const strict = createKhSimulatePreflight({
      apiBaseUrl: API,
      apiKey: KEY,
      enabled: true,
      strict: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const strictResult = await strict.simulateWorkflow(badInput);
    // P1: strict must fail closed — malformed/unsupported workflows cannot execute bare
    expect(strictResult.shouldBlock).toBe(true);
    expect(strictResult.blockReason).toBe("kh_simulate_error");
    expect(strictResult.khSimulate.attempted).toBe(false);
    expect(strictResult.khSimulate.status).toBe("error");
    expect(strictResult.khSimulate.errorMessage).toMatch(/unsupported strategy\/action/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("never POSTs without simulate:true (assert on every request body)", async () => {
    const seen: KhSimulateRequestBody[] = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as KhSimulateRequestBody;
      seen.push(body);
      expect(body.simulate).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(body, "simulate")).toBe(true);
      return passSim("1");
    });
    const client = createKhSimulatePreflight({
      apiBaseUrl: API,
      apiKey: KEY,
      enabled: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await client.simulateWorkflow(baseInput);
    await client.simulateWorkflow({
      strategy: "oracle_amm",
      workflowAction: "oracle_arb",
      deskAddress: DESK,
      workflowInput: {
        tokenIn: SEPOLIA_DESK.usdc,
        tokenOut: SEPOLIA_DESK.weth,
        amountIn: "1000",
        amountOutMinimum: "0",
      },
    });
    // defend: 2 legs, oracle_arb: 2 legs
    expect(seen).toHaveLength(4);
    for (const b of seen) {
      expect(b.simulate).toBe(true);
      expect((b as { simulate?: unknown }).simulate).not.toBe(false);
      expect((b as { simulate?: unknown }).simulate).not.toBe("true");
    }
    for (const call of fetchImpl.mock.calls) {
      const url = String(call[0]);
      expect(url).toMatch(/\/api\/execute\/(contract-call|transfer)$/);
      expect(url).not.toMatch(/\/api\/workflows\//);
    }
  });

  it("records transport abort as error", async () => {
    const fetchImpl = vi.fn(async () => {
      const err = new Error("The operation was aborted");
      err.name = "AbortError";
      throw err;
    });
    const client = createKhSimulatePreflight({
      apiBaseUrl: API,
      apiKey: KEY,
      enabled: true,
      strict: false,
      timeoutMs: 50,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await client.simulateWorkflow(baseInput);
    expect(result.khSimulate.status).toBe("error");
    expect(result.khSimulate.errorMessage).toMatch(/timed out|aborted/i);
    expect(result.shouldBlock).toBe(false);
  });

  it("simulatePrimaryLeg is an alias of simulateWorkflow", async () => {
    const fetchImpl = vi.fn(async () => passSim("1"));
    const client = createKhSimulatePreflight({
      apiBaseUrl: API,
      apiKey: KEY,
      enabled: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const a = await client.simulatePrimaryLeg(baseInput);
    const b = await client.simulateWorkflow(baseInput);
    expect(a.khSimulate.legCount).toBe(b.khSimulate.legCount);
    expect(a.khSimulate.status).toBe("passed");
  });

  it("waives balance revert on supply when prior swap passed", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as KhSimulateRequestBody;
      if ("functionName" in body && body.functionName === "supply") {
        return jsonResponse(
          {
            success: false,
            status: "simulated",
            wouldRevert: true,
            revertReason: "Error(ERC20: transfer amount exceeds balance)",
          },
          400,
        );
      }
      return passSim("50000");
    });
    const client = createKhSimulatePreflight({
      apiBaseUrl: API,
      apiKey: KEY,
      enabled: true,
      strict: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await client.simulateWorkflow({
      strategy: "yield_rotation",
      workflowAction: "rotate",
      deskAddress: DESK,
      workflowInput: {
        direction: "into_aave_link",
        amountIn: "10000000",
        amountOutMinimum: "0",
        amountLink: "1000000000000000000",
      },
    });
    expect(result.shouldBlock).toBe(false);
    expect(result.khSimulate.status).toBe("passed");
    const supply = result.khSimulate.legs?.find((l) => l.kind === "aave_supply");
    expect(supply?.waived).toBe(true);
    expect(supply?.waiveReason).toBe("balance_covered_by_prior_workflow_leg");
    expect(result.khSimulate.legCount).toBe(4);
  });

  it("does not waive balance revert when producer swap would-reverts", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as KhSimulateRequestBody;
      if ("functionName" in body && body.functionName === "exactInputSingle") {
        return jsonResponse(
          {
            success: false,
            status: "simulated",
            wouldRevert: true,
            revertReason: "Error(execution reverted: STF)",
          },
          400,
        );
      }
      if ("functionName" in body && body.functionName === "supply") {
        return jsonResponse(
          {
            success: false,
            status: "simulated",
            wouldRevert: true,
            revertReason: "Error(ERC20: transfer amount exceeds balance)",
          },
          400,
        );
      }
      return passSim("50000");
    });
    const client = createKhSimulatePreflight({
      apiBaseUrl: API,
      apiKey: KEY,
      enabled: true,
      strict: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await client.simulateWorkflow({
      strategy: "yield_rotation",
      workflowAction: "rotate",
      deskAddress: DESK,
      workflowInput: {
        direction: "into_aave_link",
        amountIn: "10000000",
        amountOutMinimum: "0",
        amountLink: "1000000000000000000",
      },
    });
    // Producer failed — must not false-pass via balance waiver on supply alone
    expect(result.khSimulate.status).toBe("failed");
    expect(result.shouldBlock).toBe(true);
    const supply = result.khSimulate.legs?.find((l) => l.kind === "aave_supply");
    expect(supply?.waived).not.toBe(true);
    expect(supply?.status).toBe("failed");
    const swap = result.khSimulate.legs?.find((l) => l.kind === "swap");
    expect(swap?.status).toBe("failed");
    expect(swap?.waived).not.toBe(true);
  });

  it("does not waive balance revert when producer leg transport-errors", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as KhSimulateRequestBody;
      if ("functionName" in body && body.functionName === "exactInputSingle") {
        return jsonResponse({ error: "upstream 502 from simulator" }, 502);
      }
      if ("functionName" in body && body.functionName === "supply") {
        return jsonResponse(
          {
            success: false,
            status: "simulated",
            wouldRevert: true,
            revertReason: "Error(ERC20: transfer amount exceeds balance)",
          },
          400,
        );
      }
      return passSim("50000");
    });
    const client = createKhSimulatePreflight({
      apiBaseUrl: API,
      apiKey: KEY,
      enabled: true,
      strict: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await client.simulateWorkflow({
      strategy: "yield_rotation",
      workflowAction: "rotate",
      deskAddress: DESK,
      workflowInput: {
        direction: "into_aave_link",
        amountIn: "10000000",
        amountOutMinimum: "0",
        amountLink: "1000000000000000000",
      },
    });
    // Aggregate prefers non-waived would-revert over transport error when both present
    expect(["failed", "error"]).toContain(result.khSimulate.status);
    expect(result.khSimulate.status).not.toBe("passed");
    expect(result.shouldBlock).toBe(true);
    const supply = result.khSimulate.legs?.find((l) => l.kind === "aave_supply");
    expect(supply?.waived).not.toBe(true);
    const swap = result.khSimulate.legs?.find((l) => l.kind === "swap");
    expect(swap?.status).toBe("error");
  });

  it("waives supply balance when swap is only allowance-waived (producer still funds)", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as KhSimulateRequestBody;
      if ("functionName" in body && body.functionName === "exactInputSingle") {
        return jsonResponse(
          {
            success: false,
            status: "simulated",
            wouldRevert: true,
            revertReason: "Error(ERC20: insufficient allowance)",
          },
          400,
        );
      }
      if ("functionName" in body && body.functionName === "supply") {
        return jsonResponse(
          {
            success: false,
            status: "simulated",
            wouldRevert: true,
            revertReason: "Error(ERC20: transfer amount exceeds balance)",
          },
          400,
        );
      }
      return passSim("50000");
    });
    const client = createKhSimulatePreflight({
      apiBaseUrl: API,
      apiKey: KEY,
      enabled: true,
      strict: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await client.simulateWorkflow({
      strategy: "yield_rotation",
      workflowAction: "rotate",
      deskAddress: DESK,
      workflowInput: {
        direction: "into_aave_link",
        amountIn: "10000000",
        amountOutMinimum: "0",
        amountLink: "1000000000000000000",
      },
    });
    // Real workflow: approve → swap → supply; co-path approve covers swap,
    // waived swap still produces LINK for supply.
    expect(result.shouldBlock).toBe(false);
    expect(result.khSimulate.status).toBe("passed");
    const swap = result.khSimulate.legs?.find((l) => l.kind === "swap");
    expect(swap?.waived).toBe(true);
    expect(swap?.waiveReason).toBe("allowance_covered_by_workflow_approve");
    const supply = result.khSimulate.legs?.find((l) => l.kind === "aave_supply");
    expect(supply?.waived).toBe(true);
    expect(supply?.waiveReason).toBe("balance_covered_by_prior_workflow_leg");
  });
});
