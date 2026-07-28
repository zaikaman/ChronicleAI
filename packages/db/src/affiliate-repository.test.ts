import { describe, expect, it } from "vitest";
import {
  normalizeAffiliateWallet,
  normalizeReferralCode,
} from "./affiliate-repository.ts";

describe("normalizeAffiliateWallet", () => {
  it("lowercases valid EVM wallets", () => {
    expect(normalizeAffiliateWallet("0xAbCdEf0123456789AbCdEf0123456789AbCdEf01")).toBe(
      "0xabcdef0123456789abcdef0123456789abcdef01",
    );
  });

  it("rejects non-EVM values", () => {
    expect(normalizeAffiliateWallet("alice")).toBeNull();
    expect(normalizeAffiliateWallet("mpp-client-1")).toBeNull();
    expect(normalizeAffiliateWallet("")).toBeNull();
  });
});

describe("normalizeReferralCode", () => {
  it("lowercases valid codes", () => {
    expect(normalizeReferralCode("Alice_42")).toBe("alice_42");
  });

  it("rejects invalid codes", () => {
    expect(normalizeReferralCode("a")).toBeNull();
    expect(normalizeReferralCode("bad code!")).toBeNull();
    expect(normalizeReferralCode("")).toBeNull();
  });
});
