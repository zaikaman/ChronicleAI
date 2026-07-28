import { describe, expect, it } from "vitest";
import {
  addressToBytes32,
  atomicToUsdc,
  calculateBurnCoverage,
  encodeApprove,
  encodeDepositForBurn,
  encodeReceiveMessage,
  usdcToAtomic,
} from "../cctp/cctp-contracts.ts";
import { CCTP_ANY_DESTINATION_CALLER } from "../cctp/constants.ts";

const TREASURY = "0xAbCdEf0123456789AbCdEf0123456789AbCdEf01";
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

describe("cctp-contracts helpers", () => {
  it("addressToBytes32 left-pads address", () => {
    const b32 = addressToBytes32(TREASURY);
    expect(b32).toMatch(/^0x0{24}[a-f0-9]{40}$/i);
    expect(b32.endsWith(TREASURY.slice(2).toLowerCase())).toBe(true);
  });

  it("usdcToAtomic / atomicToUsdc round-trip for whole units", () => {
    expect(usdcToAtomic(10)).toBe(10_000_000n);
    expect(atomicToUsdc(10_000_000n)).toBe(10);
  });

  it("encodeApprove produces calldata", () => {
    const data = encodeApprove(TREASURY, 1_000_000n);
    expect(data.startsWith("0x")).toBe(true);
    expect(data.length).toBeGreaterThan(10);
  });

  it("encodeDepositForBurn encodes V2 args", () => {
    const data = encodeDepositForBurn({
      amountAtomic: 1_000_000n,
      destinationDomain: 0,
      mintRecipient: TREASURY,
      burnToken: USDC,
      destinationCaller: CCTP_ANY_DESTINATION_CALLER,
      maxFeeAtomic: 50_000n,
      minFinalityThreshold: 1000,
    });
    expect(data.startsWith("0x")).toBe(true);
    // depositForBurn selector
    expect(data.slice(0, 10).length).toBe(10);
  });

  it("encodeDepositForBurnWithHook when hookData set", () => {
    const data = encodeDepositForBurn({
      amountAtomic: 1_000_000n,
      destinationDomain: 0,
      mintRecipient: TREASURY,
      burnToken: USDC,
      maxFeeAtomic: 0n,
      minFinalityThreshold: 1000,
      hookData: "0x01",
    });
    const noHook = encodeDepositForBurn({
      amountAtomic: 1_000_000n,
      destinationDomain: 0,
      mintRecipient: TREASURY,
      burnToken: USDC,
      maxFeeAtomic: 0n,
      minFinalityThreshold: 1000,
    });
    expect(data.slice(0, 10)).not.toBe(noHook.slice(0, 10));
  });

  it("encodeReceiveMessage requires hex", () => {
    const data = encodeReceiveMessage("0xabcd", "0xef01");
    expect(data.startsWith("0x")).toBe(true);
    expect(() => encodeReceiveMessage("", "0x01")).toThrow();
  });

  it("calculateBurnCoverage fee on top", () => {
    expect(
      calculateBurnCoverage({
        amountAtomic: 1_000_000n,
        maxFeeAtomic: 50_000n,
        feeOnTop: true,
      }),
    ).toBe(1_050_000n);
  });

  it("calculateBurnCoverage fee included", () => {
    expect(
      calculateBurnCoverage({
        amountAtomic: 1_000_000n,
        maxFeeAtomic: 50_000n,
        feeOnTop: false,
      }),
    ).toBe(1_000_000n);
  });
});
