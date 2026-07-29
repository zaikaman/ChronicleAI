import { describe, expect, it, vi } from "vitest";
import { SEPOLIA_DESK } from "@chronicleai/config";
import {
  assertSimulateTrueOnly,
  buildPrimaryLegSimulateRequest,
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

describe("buildPrimaryLegSimulateRequest", () => {
  it("builds Aave repay contract-call for risk_defend", () => {
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
    expect(built.body.chainId).toBe(11155111);
    const args = JSON.parse(built.body.functionArgs) as unknown[];
    expect(args[0]).toBe(SEPOLIA_DESK.usdc);
    expect(args[1]).toBe("10000000");
    expect(args[2]).toBe(2);
    expect(args[3]).toBe(DESK);
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

  it("builds Uniswap exactInputSingle for oracle_amm", () => {
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
    expect(built.body.contractAddress).toBe(SEPOLIA_DESK.uniswapV3SwapRouter02);
    const args = JSON.parse(built.body.functionArgs) as Array<Record<string, unknown>>;
    expect(args[0]?.tokenIn).toBe(SEPOLIA_DESK.usdc);
    expect(args[0]?.recipient).toBe(DESK);
  });

  it("builds primary swap for yield_rotation into_aave_link", () => {
    const built = buildPrimaryLegSimulateRequest({
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
    if (!("functionName" in built.body)) throw new Error("expected contract-call");
    expect(built.body.functionName).toBe("exactInputSingle");
    expect(built.label).toContain("rotate in");
  });

  it("builds primary withdraw for yield_rotation out_of_aave_link", () => {
    const built = buildPrimaryLegSimulateRequest({
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
    if (!("functionName" in built.body)) throw new Error("expected contract-call");
    expect(built.body.functionName).toBe("withdraw");
    expect(built.label).toContain("rotate out");
  });

  it("always sets simulate: true (never broadcast shape)", () => {
    const shapes = [
      buildPrimaryLegSimulateRequest({
        strategy: "risk_defend",
        workflowAction: "defend",
        deskAddress: DESK,
        workflowInput: {
          mode: "repay",
          asset: SEPOLIA_DESK.usdc,
          amount: "1",
        },
      }),
      buildPrimaryLegSimulateRequest({
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
    for (const s of shapes) {
      expect(s.body.simulate).toBe(true);
      assertSimulateTrueOnly(s.body);
    }
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

describe("createKhSimulatePreflight", () => {
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
    const result = await client.simulatePrimaryLeg(baseInput);
    expect(result.khSimulate.status).toBe("skipped");
    expect(result.khSimulate.attempted).toBe(false);
    expect(result.shouldBlock).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps successful simulate response (wouldRevert false)", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as KhSimulateRequestBody;
      expect(body.simulate).toBe(true);
      expect(_url).toBe(`${API}/api/execute/contract-call`);
      return jsonResponse({
        success: true,
        status: "simulated",
        from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        to: SEPOLIA_DESK.aaveV3Pool,
        gasEstimate: "65000",
        wouldRevert: false,
      });
    });
    const client = createKhSimulatePreflight({
      apiBaseUrl: API,
      apiKey: KEY,
      enabled: true,
      strict: false,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await client.simulatePrimaryLeg(baseInput);
    expect(result.shouldBlock).toBe(false);
    expect(result.khSimulate).toMatchObject({
      attempted: true,
      status: "passed",
      wouldRevert: false,
      gasEstimate: "65000",
      endpoint: "contract-call",
    });
    expect(result.requestMeta?.simulate).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("maps would-revert (HTTP 400) without blocking in soft mode", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        {
          success: false,
          status: "simulated",
          wouldRevert: true,
          revertReason: "Error(ERC20: insufficient allowance)",
          error: "Error(ERC20: insufficient allowance)",
        },
        400,
      ),
    );
    const client = createKhSimulatePreflight({
      apiBaseUrl: API,
      apiKey: KEY,
      enabled: true,
      strict: false,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await client.simulatePrimaryLeg(baseInput);
    expect(result.shouldBlock).toBe(false);
    expect(result.khSimulate.status).toBe("failed");
    expect(result.khSimulate.wouldRevert).toBe(true);
    expect(result.khSimulate.revertReason).toContain("insufficient allowance");
  });

  it("blocks on would-revert when strict", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        {
          success: false,
          status: "simulated",
          wouldRevert: true,
          revertReason: "Error(execution reverted)",
        },
        400,
      ),
    );
    const client = createKhSimulatePreflight({
      apiBaseUrl: API,
      apiKey: KEY,
      enabled: true,
      strict: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await client.simulatePrimaryLeg(baseInput);
    expect(result.shouldBlock).toBe(true);
    expect(result.blockReason).toBe("kh_simulate_would_revert");
    expect(result.khSimulate.status).toBe("failed");
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
    const softResult = await soft.simulatePrimaryLeg(baseInput);
    expect(softResult.shouldBlock).toBe(false);
    expect(softResult.khSimulate.status).toBe("error");

    const strict = createKhSimulatePreflight({
      apiBaseUrl: API,
      apiKey: KEY,
      enabled: true,
      strict: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const strictResult = await strict.simulatePrimaryLeg(baseInput);
    expect(strictResult.shouldBlock).toBe(true);
    expect(strictResult.blockReason).toBe("kh_simulate_error");
  });

  it("never POSTs without simulate:true (assert on every request body)", async () => {
    const seen: KhSimulateRequestBody[] = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as KhSimulateRequestBody;
      seen.push(body);
      // Guard: if someone strips simulate, test fails hard.
      expect(body.simulate).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(body, "simulate")).toBe(true);
      return jsonResponse({
        success: true,
        status: "simulated",
        wouldRevert: false,
        gasEstimate: "1",
      });
    });
    const client = createKhSimulatePreflight({
      apiBaseUrl: API,
      apiKey: KEY,
      enabled: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await client.simulatePrimaryLeg(baseInput);
    await client.simulatePrimaryLeg({
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
    expect(seen).toHaveLength(2);
    for (const b of seen) {
      expect(b.simulate).toBe(true);
      // No broadcast-only body: simulate key required
      expect((b as { simulate?: unknown }).simulate).not.toBe(false);
      expect((b as { simulate?: unknown }).simulate).not.toBe("true");
    }
    // Only DE simulate endpoints — never workflow execute.
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
    const result = await client.simulatePrimaryLeg(baseInput);
    expect(result.khSimulate.status).toBe("error");
    expect(result.khSimulate.errorMessage).toMatch(/timed out|aborted/i);
    expect(result.shouldBlock).toBe(false);
  });
});
