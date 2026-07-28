// Unit tests for payer_reference normalization used by markSettled / findSettledByPayer

import { describe, expect, it } from "vitest";
import { normalizePayerReference } from "./payment-record-repository.ts";

describe("normalizePayerReference", () => {
  it("lowercases EVM addresses for consistent storage and lookup", () => {
    expect(normalizePayerReference("0xAbCdEf0123456789AbCdEf0123456789AbCdEf01")).toBe(
      "0xabcdef0123456789abcdef0123456789abcdef01",
    );
  });

  it("trims whitespace", () => {
    expect(normalizePayerReference("  0xabcdefabcdefabcdefabcdefabcdefabcdefabcd  ")).toBe(
      "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
    );
  });

  it("returns null for empty or missing values", () => {
    expect(normalizePayerReference(null)).toBeNull();
    expect(normalizePayerReference(undefined)).toBeNull();
    expect(normalizePayerReference("")).toBeNull();
    expect(normalizePayerReference("   ")).toBeNull();
  });

  it("preserves non-EVM payer identifiers (e.g. MPP clients)", () => {
    expect(normalizePayerReference("mpp-client-2026-07-")).toBe("mpp-client-2026-07-");
  });
});
