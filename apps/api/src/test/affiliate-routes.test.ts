import express from "express";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_AFFILIATE_AGENT_HISTORY_MESSAGES,
  MAX_AFFILIATE_AGENT_MESSAGE_CHARS,
} from "../lib/request-limits.ts";
import { type AffiliateRouteDeps, createAffiliateRoutes } from "../routes/affiliate-routes.ts";
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

  it("requires wallet proof before looking up an agent job", async () => {
    const getChatJob = vi.fn();
    const deps = makeDeps({
      agentService: { getChatJob } as unknown as AffiliateRouteDeps["agentService"],
    });
    const response = await request(
      "GET",
      "/affiliates/agent/chat/jobs/job_unknown",
      undefined,
      deps,
    );

    expect(response.status).toBe(401);
    expect(getChatJob).not.toHaveBeenCalled();
  });

  it("passes the signed wallet into agent job lookup", async () => {
    const job = {
      id: "job_0x1111111111111111111111111111111111111111_5a1f8a19-5f9f-4f18-89f2-6cb7f7d22b0c",
      affiliateWallet: affiliateWallet.address.toLowerCase(),
      status: "processing" as const,
      request: { message: "show my stats" },
      result: null,
      error: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const getChatJob = vi.fn(async (jobId: string, wallet: string) =>
      wallet === affiliateWallet.address.toLowerCase() ? { ...job, id: jobId } : null,
    );
    const deps = makeDeps({
      agentService: { getChatJob } as unknown as AffiliateRouteDeps["agentService"],
    });
    const auth = await authFor(affiliateWallet);
    const query = new URLSearchParams({
      walletAddress: affiliateWallet.address,
      issuedAt: auth.issuedAt,
      signature: auth.signature,
    });

    const response = await request(
      "GET",
      `/affiliates/agent/chat/jobs/${encodeURIComponent(job.id)}?${query}`,
      undefined,
      deps,
    );

    expect(response.status).toBe(200);
    expect(getChatJob).toHaveBeenCalledWith(job.id, affiliateWallet.address.toLowerCase());
  });

  it("does not return a job to a different signed wallet", async () => {
    const getChatJob = vi.fn(async () => null);
    const deps = makeDeps({
      agentService: { getChatJob } as unknown as AffiliateRouteDeps["agentService"],
    });
    const auth = await authFor(referredWallet);
    const query = new URLSearchParams({
      walletAddress: referredWallet.address,
      issuedAt: auth.issuedAt,
      signature: auth.signature,
    });

    const response = await request(
      "GET",
      `/affiliates/agent/chat/jobs/job_owned_by_someone_else?${query}`,
      undefined,
      deps,
    );

    expect(response.status).toBe(404);
    expect(getChatJob).toHaveBeenCalledWith(
      "job_owned_by_someone_else",
      referredWallet.address.toLowerCase(),
    );
  });

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

  it("rejects an oversized affiliate-agent message before starting a job", async () => {
    const startChatJob = vi.fn();
    const deps = makeDeps({
      agentService: { startChatJob } as unknown as AffiliateRouteDeps["agentService"],
    });
    const auth = await authFor(affiliateWallet);

    const response = await request(
      "POST",
      "/affiliates/agent/chat",
      {
        ...auth,
        message: "x".repeat(MAX_AFFILIATE_AGENT_MESSAGE_CHARS + 1),
        withdrawalAuthorization: {},
      },
      deps,
    );

    expect(response.status).toBe(413);
    expect(startChatJob).not.toHaveBeenCalled();
  });

  it("rejects an oversized affiliate-agent history before starting a job", async () => {
    const startChatJob = vi.fn();
    const deps = makeDeps({
      agentService: { startChatJob } as unknown as AffiliateRouteDeps["agentService"],
    });
    const auth = await authFor(affiliateWallet);

    const response = await request(
      "POST",
      "/affiliates/agent/chat",
      {
        ...auth,
        message: "show my stats",
        withdrawalAuthorization: {},
        history: Array.from({ length: MAX_AFFILIATE_AGENT_HISTORY_MESSAGES + 1 }, () => ({
          role: "user",
          content: "previous turn",
        })),
      },
      deps,
    );

    expect(response.status).toBe(413);
    expect(startChatJob).not.toHaveBeenCalled();
  });
});
