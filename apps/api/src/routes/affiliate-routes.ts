// Public affiliate registration + referral tracking + dashboard + payout agent
// Identity = connected wallet address (no separate sign-in / registration gate).

import type {
  AffiliateRepository,
  ReferralAttributionRepository,
} from "@chronicleai/db";
import { normalizeAffiliateWallet } from "@chronicleai/db";
import { Router, type Router as RouterType } from "express";
import { fromDbPage, parsePaginationQuery } from "../lib/pagination.ts";
import type { AffiliateAgentService } from "../services/affiliate-agent-service.ts";
import type { AffiliateDashboardService } from "../services/affiliate-dashboard-service.ts";

function toAffiliateResponse(row: {
  id: string;
  wallet_address: string;
  display_name: string | null;
  referral_code: string | null;
  status: string;
  approved_at: string | null;
  created_at: string;
}) {
  return {
    id: row.id,
    walletAddress: row.wallet_address,
    displayName: row.display_name,
    referralCode: row.referral_code,
    status: row.status,
    approvedAt: row.approved_at,
    createdAt: row.created_at,
  };
}

function readWallet(input: unknown): string | null {
  if (typeof input !== "string") return null;
  return normalizeAffiliateWallet(input);
}

/**
 * Ensure the wallet is an approved affiliate (auto-register on first visit).
 */
async function ensureAffiliate(
  affiliateRepo: AffiliateRepository,
  wallet: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const existing = await affiliateRepo.findByWallet(wallet);
  if (!existing.ok) {
    return { ok: false, status: 500, error: existing.error.message };
  }
  if (existing.value?.status === "suspended") {
    return { ok: false, status: 403, error: "Affiliate wallet is suspended" };
  }
  if (!existing.value) {
    const registered = await affiliateRepo.register({ wallet_address: wallet });
    if (!registered.ok) {
      return {
        ok: false,
        status: registered.error.statusCode || 400,
        error: registered.error.message,
      };
    }
  }
  return { ok: true };
}

export interface AffiliateRouteDeps {
  affiliateRepo: AffiliateRepository;
  attributionRepo: ReferralAttributionRepository;
  dashboardService: AffiliateDashboardService;
  agentService: AffiliateAgentService;
}

export function createAffiliateRoutes(deps: AffiliateRouteDeps): RouterType {
  const router: RouterType = Router();
  const { affiliateRepo, attributionRepo, dashboardService, agentService } = deps;

  /**
   * POST /affiliates
   * Register as a referral partner (open affiliate program → status approved).
   * Body: { walletAddress, displayName?, referralCode? }
   */
  router.post("/affiliates", async (req, res, next) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const walletAddress =
        typeof body.walletAddress === "string"
          ? body.walletAddress
          : typeof body.wallet_address === "string"
            ? body.wallet_address
            : "";

      if (!walletAddress.trim()) {
        res.status(400).json({ error: "walletAddress is required" });
        return;
      }

      const displayName =
        typeof body.displayName === "string"
          ? body.displayName
          : typeof body.display_name === "string"
            ? body.display_name
            : undefined;
      const referralCode =
        typeof body.referralCode === "string"
          ? body.referralCode
          : typeof body.referral_code === "string"
            ? body.referral_code
            : undefined;

      const result = await affiliateRepo.register({
        wallet_address: walletAddress,
        display_name: displayName ?? null,
        referral_code: referralCode ?? null,
      });

      if (!result.ok) {
        const status = result.error.statusCode || 400;
        res.status(status).json({ error: result.error.message, code: result.error.code });
        return;
      }

      res.status(result.value.created ? 201 : 200).json({
        ...toAffiliateResponse(result.value.affiliate),
        created: result.value.created,
        referralLinkPath: result.value.affiliate.referral_code
          ? `/?ref=${encodeURIComponent(result.value.affiliate.referral_code)}`
          : `/?ref=${encodeURIComponent(result.value.affiliate.wallet_address)}`,
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /affiliates
   * List approved affiliates (public directory, page-based).
   * Query: page (default 1), limit (default 20, max 100).
   * Response: { items, pagination } (also mirrors `affiliates` for older clients).
   */
  router.get("/affiliates", async (req, res, next) => {
    try {
      const parsed = parsePaginationQuery(req.query, {
        defaultLimit: 20,
        maxLimit: 100,
      });
      if ("error" in parsed) {
        res.status(400).json({ error: parsed.error });
        return;
      }

      const result = await affiliateRepo.listApprovedPage({
        page: parsed.page,
        limit: parsed.limit,
      });

      if (!result.ok) {
        res.status(500).json({ error: result.error.message });
        return;
      }

      const envelope = fromDbPage(result.value, toAffiliateResponse);
      res.status(200).json({
        ...envelope,
        affiliates: envelope.items,
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /affiliates/resolve?ref=codeOrWallet
   */
  router.get("/affiliates/resolve", async (req, res, next) => {
    try {
      const ref =
        typeof req.query.ref === "string"
          ? req.query.ref
          : typeof req.query.wallet === "string"
            ? req.query.wallet
            : typeof req.query.code === "string"
              ? req.query.code
              : "";

      if (!ref.trim()) {
        res.status(400).json({ error: "ref (referral code or wallet) is required" });
        return;
      }

      const result = await affiliateRepo.findApprovedByWalletOrCode(ref);
      if (!result.ok) {
        res.status(400).json({ error: result.error.message });
        return;
      }
      if (!result.value) {
        res.status(404).json({ error: "No approved affiliate found for that referral" });
        return;
      }

      res.status(200).json(toAffiliateResponse(result.value));
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /affiliates/attribute
   * First-touch attribution when a visitor connects a wallet with an active ?ref=.
   * Body: { referredWallet, ref | affiliateWallet | referralCode }
   * Public — no auth required (wallet connect is the signal).
   */
  router.post("/affiliates/attribute", async (req, res, next) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const referredWallet =
        typeof body.referredWallet === "string"
          ? body.referredWallet
          : typeof body.referred_wallet === "string"
            ? body.referred_wallet
            : typeof body.walletAddress === "string"
              ? body.walletAddress
              : "";

      const refRaw =
        typeof body.ref === "string"
          ? body.ref
          : typeof body.referralCode === "string"
            ? body.referralCode
            : typeof body.referral_code === "string"
              ? body.referral_code
              : typeof body.affiliateWallet === "string"
                ? body.affiliateWallet
                : typeof body.affiliate_wallet === "string"
                  ? body.affiliate_wallet
                  : "";

      if (!referredWallet.trim()) {
        res.status(400).json({ error: "referredWallet is required" });
        return;
      }
      if (!refRaw.trim()) {
        res.status(400).json({ error: "ref (referral code or affiliate wallet) is required" });
        return;
      }

      const affiliate = await affiliateRepo.findApprovedByWalletOrCode(refRaw);
      if (!affiliate.ok) {
        res.status(400).json({ error: affiliate.error.message });
        return;
      }
      if (!affiliate.value) {
        res.status(404).json({ error: "No approved affiliate for that referral" });
        return;
      }

      const result = await attributionRepo.attributeFirstTouch({
        referred_wallet: referredWallet,
        affiliate_wallet: affiliate.value.wallet_address,
        referral_code: affiliate.value.referral_code,
        source: "web_connect",
      });

      if (!result.ok) {
        const status = result.error.statusCode || 400;
        res.status(status).json({ error: result.error.message });
        return;
      }

      res.status(result.value.created ? 201 : 200).json({
        created: result.value.created,
        attribution: {
          id: result.value.attribution.id,
          referredWallet: result.value.attribution.referred_wallet,
          affiliateWallet: result.value.attribution.affiliate_wallet,
          referralCode: result.value.attribution.referral_code,
          source: result.value.attribution.source,
          attributedAt: result.value.attribution.attributed_at,
        },
        affiliate: toAffiliateResponse(affiliate.value),
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /affiliates/me?wallet=0x...
   * Dashboard for the connected wallet. Auto-registers as affiliate on first visit.
   * No signature / login step — RainbowKit connect is the identity.
   */
  router.get("/affiliates/me", async (req, res, next) => {
    try {
      const wallet = readWallet(
        typeof req.query.wallet === "string"
          ? req.query.wallet
          : typeof req.query.walletAddress === "string"
            ? req.query.walletAddress
            : "",
      );
      if (!wallet) {
        res.status(400).json({ error: "wallet query param is required (0x address)" });
        return;
      }

      const ensured = await ensureAffiliate(affiliateRepo, wallet);
      if (!ensured.ok) {
        res.status(ensured.status).json({ error: ensured.error });
        return;
      }

      const stats = await dashboardService.getStats(wallet);
      if (!stats) {
        res.status(404).json({ error: "Affiliate profile not available" });
        return;
      }

      res.status(200).json(stats);
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /affiliates/me
   * Same as GET, accepts { walletAddress } in body (auto-register).
   */
  router.post("/affiliates/me", async (req, res, next) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const wallet = readWallet(
        typeof body.walletAddress === "string"
          ? body.walletAddress
          : typeof body.wallet_address === "string"
            ? body.wallet_address
            : typeof body.wallet === "string"
              ? body.wallet
              : "",
      );
      if (!wallet) {
        res.status(400).json({ error: "walletAddress is required" });
        return;
      }

      const ensured = await ensureAffiliate(affiliateRepo, wallet);
      if (!ensured.ok) {
        res.status(ensured.status).json({ error: ensured.error });
        return;
      }

      const stats = await dashboardService.getStats(wallet);
      if (!stats) {
        res.status(404).json({ error: "Affiliate profile not available" });
        return;
      }

      res.status(200).json(stats);
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /affiliates/agent/chat
   * Start asynchronous affiliate agent chat job.
   * Body: { walletAddress, message, history? } — no signature required.
   * Returns: HTTP 202 { jobId, status } immediately to avoid router timeouts.
   */
  router.post("/affiliates/agent/chat", async (req, res, next) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const wallet = readWallet(
        typeof body.walletAddress === "string"
          ? body.walletAddress
          : typeof body.wallet_address === "string"
            ? body.wallet_address
            : "",
      );
      if (!wallet) {
        res.status(400).json({ error: "walletAddress is required" });
        return;
      }

      const message = typeof body.message === "string" ? body.message.trim() : "";
      if (!message) {
        res.status(400).json({ error: "message is required" });
        return;
      }

      const ensured = await ensureAffiliate(affiliateRepo, wallet);
      if (!ensured.ok) {
        res.status(ensured.status).json({ error: ensured.error });
        return;
      }

      const history = Array.isArray(body.history)
        ? (body.history as Array<{ role?: string; content?: string }>)
            .filter((m) => typeof m.content === "string" && typeof m.role === "string")
            .slice(-12)
            .map((m) => ({
              role: m.role as "user" | "assistant" | "system" | "tool",
              content: String(m.content),
            }))
        : [];

      const job = agentService.startChatJob({
        affiliateWallet: wallet,
        message,
        history,
      });

      res.status(202).json({
        jobId: job.id,
        status: job.status,
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /affiliates/agent/chat/jobs/:jobId
   * Check status and result of a background payout agent chat job.
   */
  router.get("/affiliates/agent/chat/jobs/:jobId", async (req, res, next) => {
    try {
      const { jobId } = req.params;
      if (!jobId) {
        res.status(400).json({ error: "jobId is required" });
        return;
      }

      const job = await agentService.getChatJob(jobId);
      if (!job) {
        res.status(404).json({ error: "Job not found" });
        return;
      }

      if (job.status === "completed" && job.result) {
        res.status(200).json({
          jobId: job.id,
          status: job.status,
          reply: job.result.reply,
          mode: job.result.mode,
          provider: job.result.provider ?? null,
          toolCalls: job.result.toolCalls.map((t) => ({
            name: t.name,
            arguments: t.arguments,
            result:
              t.name === "get_affiliate_stats" && t.result && typeof t.result === "object"
                ? {
                    referredCount: (t.result as { referredCount?: number }).referredCount,
                    totalEarnedUsdc: (t.result as { totalEarnedUsdc?: number }).totalEarnedUsdc,
                    availableUsdc: (t.result as { availableUsdc?: number }).availableUsdc,
                  }
                : t.result,
          })),
          stats: job.result.stats ?? null,
        });
        return;
      }

      if (job.status === "failed") {
        res.status(200).json({
          jobId: job.id,
          status: job.status,
          error: job.error ?? "Job failed",
        });
        return;
      }

      res.status(200).json({
        jobId: job.id,
        status: job.status,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
