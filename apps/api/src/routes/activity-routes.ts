// Public activity routes:
// GET /activity — aggregated dashboard snapshot
// GET /activity/execution-logs|payments|payouts — page-based list endpoints

import type {
  ExecutionLogRepository,
  PaymentRecordRepository,
  PayoutRecordRepository,
} from "@chronicleai/db";
import { Router, type Router as RouterType } from "express";
import type { AgentActivityService } from "../services/agent-activity-service.ts";
import {
  buildRegistryRoutingDetails,
  buildTransferRoutingDetails,
  extractRoutingFromDetails,
  flashbotsProtectStatusUrl,
  routingBadgeLabel,
  shouldLinkProtectStatus,
  type RoutingPolicyEnv,
} from "../services/routing-metadata.ts";
import { fromDbPage, parsePaginationQuery } from "../lib/pagination.ts";

export interface ActivityRouteDeps {
  activityService: AgentActivityService;
  execLogRepo: ExecutionLogRepository;
  paymentRecordRepo: PaymentRecordRepository;
  payoutRepo: PayoutRecordRepository;
  routingEnv?: RoutingPolicyEnv;
}

export function createActivityRoutes(deps: ActivityRouteDeps): RouterType {
  const router: RouterType = Router();
  const { activityService, execLogRepo, paymentRecordRepo, payoutRepo } = deps;
  const activeRoutingEnv: RoutingPolicyEnv = deps.routingEnv ?? {
    deskUsePrivateMempool: true,
    deskPrivateMempoolStrict: true,
    registryUsePrivateMempool: false,
    routingProviderLabel: "flashbots_protect",
  };

  /**
   * GET /activity
   *
   * Public endpoint. Returns aggregated agent activity including recent alerts,
   * digests, payments, treasury status, active sponsored watches,
   * payout records, and execution logs (snapshot — use list endpoints for pages).
   */
  router.get("/activity", async (_req, res, next) => {
    try {
      const result = await activityService.getActivity();

      if (!result.success) {
        res.status(500).json({ error: result.error ?? "Failed to fetch activity data" });
        return;
      }

      res.json(result.data);
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /activity/execution-logs
   * Page-based KeeperHub execution audit trail.
   * Optional ?entityId= (UUID) and ?entityType= for ticket deep links (Phase 4).
   */
  router.get("/activity/execution-logs", async (req, res, next) => {
    try {
      const parsed = parsePaginationQuery(req.query, {
        defaultLimit: 25,
        maxLimit: 100,
      });
      if ("error" in parsed) {
        res.status(400).json({ error: parsed.error });
        return;
      }

      const entityIdRaw =
        typeof req.query.entityId === "string" ? req.query.entityId.trim() : "";
      const entityId =
        entityIdRaw &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          entityIdRaw,
        )
          ? entityIdRaw
          : undefined;
      const entityTypeRaw =
        typeof req.query.entityType === "string" ? req.query.entityType.trim() : "";
      const entityType = entityTypeRaw.length > 0 ? entityTypeRaw : undefined;

      const result = await execLogRepo.listPage({
        page: parsed.page,
        limit: parsed.limit,
        ...(entityId ? { entityId } : {}),
        ...(entityType ? { entityType } : {}),
      });
      if (!result.ok) {
        res.status(500).json({ error: result.error.message });
        return;
      }

      res.json(
        fromDbPage(result.value, (l) => {
          const details =
            l.details && typeof l.details === "object" && !Array.isArray(l.details)
              ? (l.details as Record<string, unknown>)
              : null;
          const routingMeta = extractRoutingFromDetails(details);
          const entry: Record<string, unknown> = {
            id: l.id,
            actionType: l.action_type,
            entityType: l.entity_type,
            entityId: l.entity_id,
            status: l.status,
            message: l.message,
            details: l.details,
            createdAt: l.created_at,
          };
          if (routingMeta) {
            entry.routing = routingMeta.routing;
            entry.routingStrict = routingMeta.routingStrict;
            entry.routingProvider = routingMeta.routingProvider;
            entry.routingRequested = routingMeta.routingRequested;
            entry.routingApplied = routingMeta.routingApplied;
            entry.routingLabel = routingBadgeLabel(routingMeta);
          }
          const txHash =
            typeof details?.txHash === "string"
              ? details.txHash
              : typeof details?.transactionHash === "string"
                ? details.transactionHash
                : null;
          if (
            txHash &&
            shouldLinkProtectStatus(routingMeta) &&
            flashbotsProtectStatusUrl(txHash, routingMeta?.chainId)
          ) {
            entry.protectStatusUrl = flashbotsProtectStatusUrl(
              txHash,
              routingMeta?.chainId,
            );
          }
          return entry;
        }),
      );
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /activity/payments
   * Page-based premium payment settlements.
   */
  router.get("/activity/payments", async (req, res, next) => {
    try {
      const parsed = parsePaginationQuery(req.query, {
        defaultLimit: 20,
        maxLimit: 100,
      });
      if ("error" in parsed) {
        res.status(400).json({ error: parsed.error });
        return;
      }

      const result = await paymentRecordRepo.listPage({
        page: parsed.page,
        limit: parsed.limit,
      });
      if (!result.ok) {
        res.status(500).json({ error: result.error.message });
        return;
      }

      res.json(
        fromDbPage(result.value, (p) => {
          const payment: Record<string, unknown> = {
            id: p.id,
            premiumItemId: p.premium_item_id,
            paymentRoute: p.payment_route,
            status: p.status,
          };
          if (p.settlement_reference) payment.settlementReference = p.settlement_reference;
          if (typeof p.amount_requested === "number") {
            payment.amountRequested = p.amount_requested;
          }
          if (typeof p.amount_settled === "number") {
            payment.amountSettled = p.amount_settled;
          }
          if (p.currency) payment.currency = p.currency;
          if (p.referral_address) payment.referralAddress = p.referral_address;
          if (p.requested_at) payment.requestedAt = p.requested_at;
          if (p.settled_at) payment.settledAt = p.settled_at;
          if (p.registry_tx_hash) payment.registryTxHash = p.registry_tx_hash;
          if (p.keeper_hub_run_id) payment.keeperHubRunId = p.keeper_hub_run_id;
          if (p.explorer_url) payment.explorerUrl = p.explorer_url;
          if (p.content_uri) payment.contentUri = p.content_uri;
          return payment;
        }),
      );
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /activity/payouts
   * Page-based revenue routing payout records.
   */
  router.get("/activity/payouts", async (req, res, next) => {
    try {
      const parsed = parsePaginationQuery(req.query, {
        defaultLimit: 15,
        maxLimit: 100,
      });
      if ("error" in parsed) {
        res.status(400).json({ error: parsed.error });
        return;
      }

      const result = await payoutRepo.listPage({
        page: parsed.page,
        limit: parsed.limit,
      });
      if (!result.ok) {
        res.status(500).json({ error: result.error.message });
        return;
      }

      res.json(
        fromDbPage(result.value, (p) => {
          const payout: Record<string, unknown> = {
            id: p.id,
            payoutPeriodHash: p.payout_period_hash,
            recipient: p.recipient,
            amount: p.amount,
            reasonHash: p.reason_hash,
            status: p.status,
            createdAt: p.created_at,
          };
          if (p.payout_tx_hash) payout.payoutTxHash = p.payout_tx_hash;
          if (p.registry_tx_hash) payout.registryTxHash = p.registry_tx_hash;
          if (p.keeper_hub_run_id) {
            payout.keeperHubRunId = p.keeper_hub_run_id;
            const regRouting = buildRegistryRoutingDetails(activeRoutingEnv);
            payout.routing = regRouting.routing;
            payout.routingRequested = regRouting.routingRequested;
            payout.routingApplied = regRouting.routingApplied;
            payout.routingLabel = routingBadgeLabel(regRouting);
          }
          if (p.explorer_url) payout.explorerUrl = p.explorer_url;
          if (p.transfer_keeper_hub_run_id) {
            payout.transferKeeperHubRunId = p.transfer_keeper_hub_run_id;
            if (!payout.routing) {
              const transferRouting = buildTransferRoutingDetails(activeRoutingEnv);
              payout.routing = transferRouting.routing;
              payout.routingRequested = transferRouting.routingRequested;
              payout.routingApplied = transferRouting.routingApplied;
              payout.routingLabel = routingBadgeLabel(transferRouting);
            }
          }
          if (p.transfer_explorer_url) {
            payout.transferExplorerUrl = p.transfer_explorer_url;
          }
          return payout;
        }),
      );
    } catch (error) {
      next(error);
    }
  });

  return router;
}
