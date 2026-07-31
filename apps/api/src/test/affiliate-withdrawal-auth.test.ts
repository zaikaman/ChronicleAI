import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import {
  buildAffiliateWithdrawalTypedData,
  verifyAffiliateWithdrawalAuthorization,
} from "../services/affiliate-withdrawal-auth.ts";

describe("affiliate withdrawal EIP-712 authorization", () => {
  it("recovers the signing wallet and binds the amount/action", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const nonce = `0x${"11".repeat(32)}` as `0x${string}`;
    const expiry = Math.floor(Date.now() / 1000) + 300;
    const typed = buildAffiliateWithdrawalTypedData({
      wallet: account.address,
      amountUsdc: 12.345678,
      nonce,
      expiry,
      chainId: 84532,
    });
    const signature = await account.signTypedData(typed);
    const result = await verifyAffiliateWithdrawalAuthorization({
      authorization: {
        wallet: account.address,
        amount: "12345678",
        nonce,
        expiry,
        action: "withdraw_usdc",
        signature,
      },
      expectedWallet: account.address,
      expectedAmountUsdc: 12.345678,
      chainId: 84532,
      nowSeconds: Math.floor(Date.now() / 1000),
    });
    expect(result).toEqual({ ok: true, nonce: nonce.toLowerCase() });
  });

  it("rejects a signature for a different amount", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const nonce = `0x${"22".repeat(32)}` as `0x${string}`;
    const expiry = Math.floor(Date.now() / 1000) + 300;
    const typed = buildAffiliateWithdrawalTypedData({
      wallet: account.address,
      amountUsdc: 1,
      nonce,
      expiry,
      chainId: 84532,
    });
    const signature = await account.signTypedData(typed);
    const result = await verifyAffiliateWithdrawalAuthorization({
      authorization: { wallet: account.address, amount: "1000000", nonce, expiry, action: "withdraw_usdc", signature },
      expectedWallet: account.address,
      expectedAmountUsdc: 2,
      chainId: 84532,
    });
    expect(result.ok).toBe(false);
  });
});
