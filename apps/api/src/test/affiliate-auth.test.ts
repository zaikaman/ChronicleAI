import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import {
  buildAffiliateAuthMessage,
  verifyAffiliateAuth,
} from "../services/affiliate-auth.ts";

function randomAccount() {
  return privateKeyToAccount(generatePrivateKey());
}

describe("affiliate auth", () => {
  it("verifies a wallet personal_sign of the canonical message", async () => {
    const wallet = randomAccount();
    const issuedAt = new Date().toISOString();
    const message = buildAffiliateAuthMessage(wallet.address, issuedAt);
    const signature = await wallet.signMessage({ message });

    const result = await verifyAffiliateAuth({
      walletAddress: wallet.address,
      issuedAt,
      signature,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.walletAddress).toBe(wallet.address.toLowerCase());
    }
  });

  it("rejects wrong wallet address", async () => {
    const wallet = randomAccount();
    const other = randomAccount();
    const issuedAt = new Date().toISOString();
    const message = buildAffiliateAuthMessage(wallet.address, issuedAt);
    const signature = await wallet.signMessage({ message });

    const result = await verifyAffiliateAuth({
      walletAddress: other.address,
      issuedAt,
      signature,
    });

    expect(result.ok).toBe(false);
  });

  it("rejects expired signatures", async () => {
    const wallet = randomAccount();
    const issuedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const message = buildAffiliateAuthMessage(wallet.address, issuedAt);
    const signature = await wallet.signMessage({ message });

    const result = await verifyAffiliateAuth({
      walletAddress: wallet.address,
      issuedAt,
      signature,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.toLowerCase()).toContain("expired");
    }
  });
});
