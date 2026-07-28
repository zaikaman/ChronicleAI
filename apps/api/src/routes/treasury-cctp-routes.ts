// Admin/demo CCTP treasury rebalance routes (auth-protected via caller middleware):
// GET  /treasury/cctp/status
// POST /treasury/cctp/rebalance  (force; optional amountUsdc)
// POST /treasury/cctp/resume
//
// Mount behind keeperhubSignatureMiddleware (X-ChronicleAI-Signature) or equivalent.

import { Router, type Router as RouterType } from "express";
import type { CctpRebalanceTransferRow } from "@chronicleai/db";
import { ApiError, badRequest } from "../errors.ts";
import type { CctpRebalanceService } from "../cctp/rebalance-service.ts";
import { cctpExplorerUrls } from "../cctp/explorers.ts";
import { deployableToDeskUsdc } from "../cctp/desk-starvation.ts";
import type {
  CctpPolicyDecision,
  CctpResumeResult,
  CctpStatusSnapshot,
  CctpTickResult,
  CctpTreasuryBalances,
} from "../cctp/types.ts";

export function toPublicCctpTransfer(row: CctpRebalanceTransferRow) {
  const explorers = cctpExplorerUrls({
    burnTxHash: row.burn_tx_hash,
    mintTxHash: row.mint_tx_hash,
  });
  return {
    id: row.id,
    status: row.status,
    direction: row.direction,
    sourceDomain: row.source_domain,
    destinationDomain: row.destination_domain,
    sourceChainId: row.source_chain_id,
    destinationChainId: row.destination_chain_id,
    amountUsdc: row.amount_usdc,
    amountAtomic: row.amount_atomic,
    maxFeeAtomic: row.max_fee_atomic,
    minFinalityThreshold: row.min_finality_threshold,
    mode: row.mode,
    treasuryAddress: row.treasury_address,
    mintRecipient: row.mint_recipient,
    approveTxHash: row.approve_tx_hash,
    burnTxHash: row.burn_tx_hash,
    mintTxHash: row.mint_tx_hash,
    messageHash: row.message_hash,
    irisStatus: row.iris_status,
    errorMessage: row.error_message,
    attemptCount: row.attempt_count,
    burnedAt: row.burned_at,
    attestedAt: row.attested_at,
    mintedAt: row.minted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    burnExplorerUrl: explorers.burnExplorerUrl,
    mintExplorerUrl: explorers.mintExplorerUrl,
    metadata: row.metadata ?? {},
  };
}

function toPublicBalances(
  balances: CctpTreasuryBalances | undefined,
  usdcOperatingReserve = 0,
) {
  if (!balances) return null;
  const deployable = deployableToDeskUsdc(
    balances.treasurySepoliaUsdc,
    usdcOperatingReserve,
  );
  return {
    treasuryBaseUsdc: balances.treasuryBaseUsdc,
    treasurySepoliaUsdc: balances.treasurySepoliaUsdc,
    treasuryBaseEth: balances.treasuryBaseEth,
    treasurySepoliaEth: balances.treasurySepoliaEth,
    inFlightUsdc: balances.inFlightUsdc,
    /** Sepolia USDC minus operating reserve — what capital manager can send to desk. */
    deployableToDeskUsdc: deployable,
    usdcOperatingReserve,
  };
}

function toPublicPolicy(policy: CctpPolicyDecision | undefined) {
  if (!policy) return null;
  return {
    eligible: policy.eligible,
    amountUsdc: policy.amountUsdc,
    amountAtomic: policy.amountAtomic,
    maxFeeAtomic: policy.maxFeeAtomic,
    reason: policy.reason,
    detail: policy.detail,
    availableAboveBufferUsdc: policy.availableAboveBufferUsdc,
  };
}

export function toPublicCctpStatus(
  snapshot: CctpStatusSnapshot,
  options?: { usdcOperatingReserve?: number },
) {
  const reserve = options?.usdcOperatingReserve ?? 0;
  return {
    enabled: snapshot.enabled,
    inFlightCount: snapshot.inFlightCount,
    inFlightUsdc: snapshot.inFlightUsdc,
    lastSuccessfulBurnAt: snapshot.lastSuccessfulBurnAt,
    balances: toPublicBalances(snapshot.balances, reserve),
    policy: toPublicPolicy(snapshot.policy),
    recent: snapshot.recent.map(toPublicCctpTransfer),
  };
}

export function toPublicCctpTickResult(result: CctpTickResult) {
  const explorers = cctpExplorerUrls({
    burnTxHash: result.burnTxHash,
    mintTxHash: result.mintTxHash,
  });
  return {
    outcome: result.outcome,
    reason: result.reason ?? null,
    transferId: result.transferId ?? null,
    status: result.status ?? null,
    burnTxHash: result.burnTxHash ?? null,
    mintTxHash: result.mintTxHash ?? null,
    amountUsdc: result.amountUsdc ?? null,
    mode: result.mode ?? null,
    errorClass: result.errorClass ?? null,
    errorMessage: result.errorMessage ?? null,
    burnExplorerUrl: explorers.burnExplorerUrl,
    mintExplorerUrl: explorers.mintExplorerUrl,
  };
}

export function toPublicCctpResumeResult(result: CctpResumeResult) {
  return {
    processed: result.processed,
    results: result.results.map((r) => {
      const explorers = cctpExplorerUrls({
        burnTxHash: r.burnTxHash,
        mintTxHash: r.mintTxHash,
      });
      return {
        transferId: r.transferId,
        outcome: r.outcome,
        status: r.status ?? null,
        burnTxHash: r.burnTxHash ?? null,
        mintTxHash: r.mintTxHash ?? null,
        errorClass: r.errorClass ?? null,
        errorMessage: r.errorMessage ?? null,
        burnExplorerUrl: explorers.burnExplorerUrl,
        mintExplorerUrl: explorers.mintExplorerUrl,
      };
    }),
  };
}

function parseOptionalAmountUsdc(body: Record<string, unknown>): number | undefined {
  if (body.amountUsdc === undefined || body.amountUsdc === null || body.amountUsdc === "") {
    return undefined;
  }
  const n =
    typeof body.amountUsdc === "number"
      ? body.amountUsdc
      : typeof body.amountUsdc === "string"
        ? Number(body.amountUsdc)
        : Number.NaN;
  if (!Number.isFinite(n) || n <= 0) {
    throw badRequest("amountUsdc must be a positive number when provided");
  }
  return n;
}

export function createTreasuryCctpRoutes(deps: {
  /** When null, routes return 503 (service not configured). */
  service: CctpRebalanceService | null;
  /** Sepolia USDC operating reserve for deployable-to-desk math. */
  usdcOperatingReserve?: number;
}): RouterType {
  const router: RouterType = Router();
  const { service } = deps;
  const usdcOperatingReserve = deps.usdcOperatingReserve ?? 0;

  function requireService(): CctpRebalanceService {
    if (!service) {
      throw new ApiError(
        503,
        "CCTP rebalance service is not configured. Set TREASURY_WALLET_ADDRESS, " +
          "Base + Sepolia RPCs, and either PARA_API_KEY (preferred: burn from Para treasury) " +
          "or CCTP_OPERATOR_PRIVATE_KEY (legacy).",
      );
    }
    return service;
  }

  /**
   * GET /treasury/cctp/status
   *
   * Dual-rail balances, policy eligibility, in-flight count, recent transfers.
   * Feature flag reflected as `enabled` (CCTP_REBALANCE_ENABLED).
   */
  router.get("/treasury/cctp/status", async (_req, res, next) => {
    try {
      const svc = requireService();
      const snapshot = await svc.getStatus();
      res.json(toPublicCctpStatus(snapshot, { usdcOperatingReserve }));
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /treasury/cctp/rebalance
   *
   * Admin/demo force rebalance. Still policy-capped (buffer, max chunk, gas).
   * Body: { amountUsdc?: number }
   *
   * Works even when CCTP_REBALANCE_ENABLED=false (force path).
   */
  router.post("/treasury/cctp/rebalance", async (req, res, next) => {
    try {
      const svc = requireService();
      const body =
        req.body && typeof req.body === "object" && !Array.isArray(req.body)
          ? (req.body as Record<string, unknown>)
          : {};
      let amountUsdc: number | undefined;
      try {
        amountUsdc = parseOptionalAmountUsdc(body);
      } catch (error) {
        next(error);
        return;
      }

      const result = await svc.forceRebalance(amountUsdc);
      const ok =
        result.outcome !== "error" &&
        result.outcome !== "failed" &&
        result.outcome !== "skipped";
      res.status(200).json({
        ok: ok || result.outcome === "skipped",
        forced: true,
        amountUsdcRequested: amountUsdc ?? null,
        ...toPublicCctpTickResult(result),
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /treasury/cctp/resume
   *
   * Resume rows in awaiting_attestation | minting | stuck.
   */
  router.post("/treasury/cctp/resume", async (_req, res, next) => {
    try {
      const svc = requireService();
      const result = await svc.resumeInFlight();
      res.status(200).json({
        ok: true,
        ...toPublicCctpResumeResult(result),
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
