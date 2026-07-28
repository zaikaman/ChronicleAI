// Public affiliate registration + lookup (product source of approved referral partners)

import type { AffiliateRepository, AffiliateRow } from "@chronicleai/db";
import { Router, type Router as RouterType } from "express";

function toAffiliateResponse(row: AffiliateRow) {
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

export function createAffiliateRoutes(affiliateRepo: AffiliateRepository): RouterType {
  const router: RouterType = Router();

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
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /affiliates
   * List approved affiliates (for website referral directory / attribution UI).
   */
  router.get("/affiliates", async (req, res, next) => {
    try {
      const limitRaw = typeof req.query.limit === "string" ? Number(req.query.limit) : 100;
      const limit = Number.isFinite(limitRaw) ? limitRaw : 100;
      const result = await affiliateRepo.listApproved(limit);

      if (!result.ok) {
        res.status(500).json({ error: result.error.message });
        return;
      }

      res.status(200).json({
        affiliates: result.value.map(toAffiliateResponse),
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /affiliates/resolve?ref=codeOrWallet
   * Resolve a referral code or wallet to an approved affiliate (for subscribe UX).
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

  return router;
}
