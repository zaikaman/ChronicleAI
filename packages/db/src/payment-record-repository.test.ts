// Unit tests for payer_reference / referral_address normalization

import { describe, expect, it } from "vitest";
import {
  normalizePayerReference,
  normalizeReferralAddress,
} from "./payment-record-repository.ts";

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

  it("preserves non-EVM payer identifiers that are not synthetic", () => {
    expect(normalizePayerReference("machine-agent-42")).toBe("machine-agent-42");
  });
});

describe("normalizeReferralAddress", () => {
  it("lowercases valid EVM affiliate wallets", () => {
    expect(normalizeReferralAddress("0xAbCdEf0123456789AbCdEf0123456789AbCdEf01")).toBe(
      "0xabcdef0123456789abcdef0123456789abcdef01",
    );
  });

  it("rejects non-EVM identifiers (cannot receive on-chain referral transfers)", () => {
    expect(normalizeReferralAddress("mpp-client-abc")).toBeNull();
    expect(normalizeReferralAddress("machine-agent-42")).toBeNull();
    expect(normalizeReferralAddress("not-an-address")).toBeNull();
  });

  it("returns null for empty values", () => {
    expect(normalizeReferralAddress(null)).toBeNull();
    expect(normalizeReferralAddress(undefined)).toBeNull();
    expect(normalizeReferralAddress("")).toBeNull();
  });
});
