import { describe, expect, it } from "vitest";
import {
  absBigInt,
  argAsBigInt,
  argAsString,
  scaleTokenAmount,
  unwrapArg,
} from "../monitoring/arg-utils.ts";

describe("arg-utils", () => {
  it("unwraps KeeperHub serialized args", () => {
    expect(unwrapArg({ value: "42", type: "uint256" })).toBe("42");
    expect(unwrapArg("flat")).toBe("flat");
  });

  it("parses bigint from string/number wrappers", () => {
    expect(argAsBigInt({ value: "1000", type: "uint256" })).toBe(1000n);
    expect(argAsBigInt("-5")).toBe(-5n);
    expect(argAsBigInt("nope")).toBeUndefined();
  });

  it("parses string args", () => {
    expect(argAsString({ value: "0xabc", type: "address" })).toBe("0xabc");
  });

  it("scales token amounts with decimals", () => {
    expect(scaleTokenAmount(2_500_000n * 1_000_000n, 6)).toBe(2_500_000);
    expect(absBigInt(-10n)).toBe(10n);
  });
});
