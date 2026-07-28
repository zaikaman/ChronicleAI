import { describe, expect, it } from "vitest";
import { isParaChainExecutorConfigured } from "../cctp/para-chain-executor.ts";

describe("isParaChainExecutorConfigured", () => {
  it("requires Para API key, treasury identifier, and dual RPCs", () => {
    expect(
      isParaChainExecutorConfigured({
        paraApiKey: "pk_test",
        x402RpcUrl: "https://base.example",
        rpcUrl: "https://sepolia.example",
        paraTreasuryUserIdentifier: "chronicleai-treasury",
      }),
    ).toBe(true);
  });

  it("rejects missing Para key", () => {
    expect(
      isParaChainExecutorConfigured({
        paraApiKey: undefined as unknown as string,
        x402RpcUrl: "https://base.example",
        rpcUrl: "https://sepolia.example",
        paraTreasuryUserIdentifier: "chronicleai-treasury",
      }),
    ).toBe(false);
  });

  it("rejects missing Base RPC", () => {
    expect(
      isParaChainExecutorConfigured({
        paraApiKey: "pk_test",
        x402RpcUrl: undefined as unknown as string,
        rpcUrl: "https://sepolia.example",
        paraTreasuryUserIdentifier: "chronicleai-treasury",
      }),
    ).toBe(false);
  });
});
