import { type Address, type Hex, parseUnits, recoverTypedDataAddress } from "viem";

export const AFFILIATE_WITHDRAWAL_DOMAIN_NAME = "ChronicleAI Affiliate Withdrawal";
export const AFFILIATE_WITHDRAWAL_DOMAIN_VERSION = "1";
export const AFFILIATE_WITHDRAWAL_ACTION = "withdraw_usdc";
export const AFFILIATE_WITHDRAWAL_MAX_LIFETIME_SECONDS = 10 * 60;

export const affiliateWithdrawalTypes = {
  AffiliateWithdrawal: [
    { name: "wallet", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "nonce", type: "bytes32" },
    { name: "expiry", type: "uint256" },
    { name: "action", type: "string" },
  ],
} as const;

export interface AffiliateWithdrawalAuthorization {
  wallet: string;
  amount: string;
  nonce: string;
  expiry: number;
  action: string;
  signature: string;
}

export function buildAffiliateWithdrawalTypedData(params: {
  wallet: string;
  amountUsdc: number;
  nonce: string;
  expiry: number;
  chainId: number;
}) {
  return {
    domain: { name: AFFILIATE_WITHDRAWAL_DOMAIN_NAME, version: AFFILIATE_WITHDRAWAL_DOMAIN_VERSION, chainId: params.chainId },
    types: affiliateWithdrawalTypes,
    primaryType: "AffiliateWithdrawal" as const,
    message: {
      wallet: params.wallet as Address,
      amount: parseUnits(params.amountUsdc.toFixed(6), 6),
      nonce: params.nonce as Hex,
      expiry: BigInt(params.expiry),
      action: AFFILIATE_WITHDRAWAL_ACTION,
    },
  };
}

export async function verifyAffiliateWithdrawalAuthorization(params: {
  authorization: AffiliateWithdrawalAuthorization;
  expectedWallet: string;
  expectedAmountUsdc: number;
  chainId: number;
  nowSeconds?: number;
}): Promise<{ ok: true; nonce: string } | { ok: false; error: string }> {
  const auth = params.authorization;
  const wallet = params.expectedWallet.toLowerCase();
  if (auth.wallet.trim().toLowerCase() !== wallet) return { ok: false, error: "Withdrawal authorization wallet does not match" };
  if (auth.action !== AFFILIATE_WITHDRAWAL_ACTION) return { ok: false, error: "Invalid withdrawal authorization action" };
  if (!/^0x[0-9a-fA-F]{64}$/.test(auth.nonce)) return { ok: false, error: "Invalid withdrawal authorization nonce" };
  if (!Number.isSafeInteger(auth.expiry)) return { ok: false, error: "Invalid withdrawal authorization expiry" };
  const now = params.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (auth.expiry <= now) return { ok: false, error: "Withdrawal authorization expired" };
  if (auth.expiry > now + AFFILIATE_WITHDRAWAL_MAX_LIFETIME_SECONDS) return { ok: false, error: "Withdrawal authorization expiry is too far in the future" };
  if (!/^0x[0-9a-fA-F]{130}$/.test(auth.signature)) return { ok: false, error: "Invalid withdrawal authorization signature" };
  let expectedAmount: bigint;
  try { expectedAmount = parseUnits(params.expectedAmountUsdc.toFixed(6), 6); } catch { return { ok: false, error: "Invalid withdrawal amount" }; }
  if (auth.amount !== expectedAmount.toString()) return { ok: false, error: "Withdrawal authorization amount does not match request" };
  try {
    const recoveredAddress = await recoverTypedDataAddress({ ...buildAffiliateWithdrawalTypedData({ wallet, amountUsdc: params.expectedAmountUsdc, nonce: auth.nonce, expiry: auth.expiry, chainId: params.chainId }), signature: auth.signature as Hex });
    if (recoveredAddress.toLowerCase() !== wallet) return { ok: false, error: "Withdrawal signature does not match wallet" };
  } catch { return { ok: false, error: "Could not verify withdrawal signature" }; }
  return { ok: true, nonce: auth.nonce.toLowerCase() };
}
