const AUTH_MAX_AGE_MS = 15 * 60 * 1000;

export interface AffiliateAuthPayload {
  walletAddress: string;
  issuedAt: string;
  signature: string;
}

function buildAffiliateAuthMessage(walletAddress: string, issuedAt: string): string {
  return [
    "ChronicleAI Affiliate Session",
    `Wallet: ${walletAddress.trim().toLowerCase()}`,
    `Issued-At: ${issuedAt}`,
    "Purpose: Access affiliate dashboard and payout agent",
  ].join("\n");
}

let cached: AffiliateAuthPayload | null = null;

export async function signAffiliateAuth(
  walletAddress: string,
  signMessage: (message: string) => Promise<string>,
): Promise<AffiliateAuthPayload> {
  const wallet = walletAddress.trim().toLowerCase();
  const now = Date.now();
  if (
    cached &&
    cached.walletAddress === wallet &&
    Date.parse(cached.issuedAt) > now - AUTH_MAX_AGE_MS
  ) {
    return cached;
  }

  const issuedAt = new Date(now).toISOString();
  const signature = await signMessage(buildAffiliateAuthMessage(wallet, issuedAt));
  cached = { walletAddress: wallet, issuedAt, signature };
  return cached;
}

export function clearAffiliateAuthCache(): void {
  cached = null;
}
