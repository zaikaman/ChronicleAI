import express from "express";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAffiliateRoutes, type AffiliateRouteDeps } from "../routes/affiliate-routes.ts";
import { buildAffiliateAuthMessage } from "../services/affiliate-auth.ts";

const affiliateWallet = privateKeyToAccount(generatePrivateKey());
const referredWallet = privateKeyToAccount(generatePrivateKey());

const affiliateRow = {
  id: "affiliate-id",
  wallet_address: affiliateWallet.address.toLowerCase(),
  display_name: null,
  referral_code: "partner",
  status: "approved",
  approved_at: new Date().toISOString(),
  created_at: new Date().toISOString(),
};

function makeDeps(overrides: Partial<AffiliateRouteDeps> = {}): AffiliateRouteDeps {
  return {
    affiliateRepo: {
      findByWallet: vi.fn(async () => ({ ok: true, value: affiliateRow })),
      findApprovedByWalletOrCode: vi.fn(async () => ({ ok: true, value: affiliateRow })),
    },
    attributionRepo: {
      attributeFirstTouch: vi.fn(async (input) => ({
        ok: true,
        value: {
          created: true,
          attribution: {
            id: "attribution-id",
            referred_wallet: input.referred_wallet,
            affiliate_wallet: input.affiliate_wallet,
            referral_code: input.referral_code ?? null,
            source: "web_connect" as const,
            attributed_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        },
      })),
    },
    dashboardService: {
      getStats: vi.fn(async (wallet: string) => ({
        affiliate: {
          walletAddress: wallet,
          displayName: null,
          referralCode: "partner",
          status: "approved",
          referralLinkPath: "/?ref=partner",
        },
        referredCount: 0,
        totalEarnedUsdc: 0,
        totalWithdrawnUsdc: 0,
        reservedUsdc: 0,
        availableUsdc: 0,
        currency: "USDC",
        recentReferrals: [],
        recentEarnings: [],
        recentWithdrawals: [],
      })),
    },
    agentService: {} as AffiliateRouteDeps["agentService"],
    ...overrides,
  } as AffiliateRouteDeps;
}

async function authFor(account: typeof affiliateWallet) {
  const issuedAt = new Date().toISOString();
  return {
    walletAddress: account.address,
    issuedAt,
    signature: await account.signMessage({
      message: buildAffiliateAuthMessage(account.address, issuedAt),
    }),
  };
}

async function request(
  method: "GET" | "POST",
  path: string,
  body: unknown,
  deps: AffiliateRouteDeps,
) {
  const app = express();
  app.use(express.json());
  app.use(createAffiliateRoutes(deps));
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const nextServer = app.listen(0, () => resolve(nextServer));
  });

  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind");
    return await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: method === "POST" ? JSON.stringify(body) : undefined,
    });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

describe("affiliate wallet ownership routes", () => {
  afterEach(() => vi.restoreAllMocks());

  it("rejects an unsigned dashboard request", async () => {
    const deps = makeDeps();
    const response = await request(
      "GET",
      `/affiliates/me?wallet=${encodeURIComponent(affiliateWallet.address)}`,
      undefined,
      deps,
    );

    expect(response.status).toBe(401);
    expect(deps.dashboardService.getStats).not.toHaveBeenCalled();
  });

  it("rejects a dashboard wallet that does not match the signed wallet", async () => {
    const auth = await authFor(affiliateWallet);
    const params = new URLSearchParams({
      wallet: referredWallet.address,
      issuedAt: auth.issuedAt,
      signature: auth.signature,
    });
    const deps = makeDeps();
    const response = await request("GET", `/affiliates/me?${params}`, undefined, deps);

    expect(response.status).toBe(401);
    expect(deps.dashboardService.getStats).not.toHaveBeenCalled();
  });

  it("binds attribution to the wallet recovered from the signature", async () => {
    const auth = await authFor(referredWallet);
    const deps = makeDeps();
    const response = await request(
      "POST",
      "/affiliates/attribute",
      {
        referredWallet: affiliateWallet.address,
        ref: "partner",
        auth,
      },
      deps,
    );

    expect(response.status).toBe(403);
    expect(deps.attributionRepo.attributeFirstTouch).not.toHaveBeenCalled();
  });

  it("allows attribution when the signed wallet matches referredWallet", async () => {
    const auth = await authFor(referredWallet);
    const deps = makeDeps();
    const response = await request(
      "POST",
      "/affiliates/attribute",
      { referredWallet: referredWallet.address, ref: "partner", auth },
      deps,
    );

    expect(response.status).toBe(201);
    expect(deps.attributionRepo.attributeFirstTouch).toHaveBeenCalledWith(
      expect.objectContaining({ referred_wallet: referredWallet.address.toLowerCase() }),
    );
  });
});
