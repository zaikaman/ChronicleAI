// Public activity routes:
// GET /activity — aggregated dashboard snapshot
// GET /activity/execution-logs|payments|payouts — page-based list endpoints

import type {
  CctpRebalanceRepository,
  ExecutionLogRepository,
  PaymentRecordRepository,
  PayoutRecordRepository,
} from "@chronicleai/db";
import { Router, type Router as RouterType } from "express";
import { cctpExplorerUrls } from "../cctp/explorers.ts";
import { fromDbPage, parsePaginationQuery } from "../lib/pagination.ts";
import type { AgentActivityService } from "../services/agent-activity-service.ts";
import { paymentFailureReason } from "../services/payment-status-copy.ts";
import { serializePublicActivityLog } from "../services/public-activity-serializer.ts";
import {
  type RoutingPolicyEnv,
  buildRegistryRoutingDetails,
  buildTransferRoutingDetails,
  routingBadgeLabel,
} from "../services/routing-metadata.ts";

export interface ActivityRouteDeps {
  activityService: AgentActivityService;
  execLogRepo: ExecutionLogRepository;
  paymentRecordRepo: PaymentRecordRepository;
  payoutRepo: PayoutRecordRepository;
  /** Optional — when present, exposes GET /activity/cctp-rebalances. */
  cctpRebalanceRepo?: CctpRebalanceRepository | null;
  routingEnv?: RoutingPolicyEnv;
}

export function createActivityRoutes(deps: ActivityRouteDeps): RouterType {
  const router: RouterType = Router();
  const { activityService, execLogRepo, paymentRecordRepo, payoutRepo, cctpRebalanceRepo } = deps;
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
   * GET /activity/stats/count
   * Returns live execution count for the hackathon window (July 27 - August 13).
   */
  router.get("/activity/stats/count", async (_req, res, next) => {
    try {
      const result = execLogRepo.countHackathonExecutions
        ? await execLogRepo.countHackathonExecutions()
        : await execLogRepo
            .listPage({ page: 1, limit: 1 })
            .then((r) => (r.ok ? { ok: true as const, value: r.value.total } : r));
      const count = result.ok ? result.value : 0;
      res.json({
        count,
        startDate: "2026-07-27",
        endDate: "2026-08-13",
        window: "July 27 - August 13, 2026",
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /activity/badge.svg
   * Serves a dynamic SVG badge directly from the API.
   * Updates in real-time when rendered inside GitHub README.md without external dependencies.
   */
  router.get("/activity/badge.svg", async (_req, res, next) => {
    try {
      const result = execLogRepo.countHackathonExecutions
        ? await execLogRepo.countHackathonExecutions()
        : await execLogRepo
            .listPage({ page: 1, limit: 1 })
            .then((r) => (r.ok ? { ok: true as const, value: r.value.total } : r));
      const count = result.ok ? result.value : 0;

      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="28" role="img" aria-label="KeeperHub Hackathon Executions: ${count} Live">
  <linearGradient id="b" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
  <clipPath id="a"><rect width="220" height="28" rx="4" fill="#fff"/></clipPath>
  <g clip-path="url(#a)">
    <rect width="140" height="28" fill="#1C3C3C"/>
    <rect x="140" width="80" height="28" fill="#7C3AED"/>
    <rect width="220" height="28" fill="url(#b)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="11">
    <text x="70" y="18" fill="#010101" fill-opacity=".3">KEEPERHUB EXEC</text>
    <text x="70" y="17">KEEPERHUB EXEC</text>
    <text x="180" y="18" fill="#010101" fill-opacity=".3">${count} LIVE</text>
    <text x="180" y="17">${count} LIVE</text>
  </g>
</svg>`;

      res.setHeader("Content-Type", "image/svg+xml");
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate, max-age=0");
      res.send(svg);
    } catch (error) {
      next(error);
    }
  });

  /**
   * Helper to format execution logs in plain text format (1st to last transaction).
   */
  const renderTransactionsTxt = async (req: any, res: any) => {
    const rawPage = req.query?.page;
    const rawLimit = req.query?.limit;

    const pageParam = rawPage === "all" ? "all" : Math.max(1, Number.parseInt(String(rawPage || "1"), 10) || 1);
    const limitParam = Math.min(1000, Math.max(1, Number.parseInt(String(rawLimit || "100"), 10) || 100));

    let logs: any[] = [];
    let totalCount = 0;
    let currentPage: number | "all" = pageParam;
    let totalPages = 1;

    if (execLogRepo.listAllChronological) {
      const result = await execLogRepo.listAllChronological({
        page: pageParam,
        limit: limitParam,
      });
      if (result.ok) {
        logs = result.value.items;
        totalCount = result.value.total;
        currentPage = result.value.page;
        totalPages = result.value.totalPages;
      }
    } else {
      const result = await execLogRepo.listPage({ page: 1, limit: 1000 });
      if (result.ok) {
        logs = [...result.value.items].sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
        );
        totalCount = result.value.total;
      }
    }

    const nowIso = new Date().toISOString();
    const isAll = currentPage === "all";
    const startNum = isAll ? 1 : ((currentPage as number) - 1) * limitParam + 1;
    const endNum = isAll ? totalCount : Math.min(totalCount, (currentPage as number) * limitParam);

    let out = `================================================================================\n`;
    out += `                    CHRONICLE AI — KEEPERHUB TRANSACTIONS                       \n`;
    out += `================================================================================\n`;
    out += `Total Transactions Executed: ${totalCount}\n`;
    if (isAll) {
      out += `Showing: All ${totalCount} Transactions (#1 to #${totalCount}, Chronological #1 = oldest)\n`;
    } else {
      out += `Showing: Page ${currentPage} of ${totalPages} (Transactions #${startNum} to #${endNum})\n`;
      out += `Pagination Query: ?page=1..${totalPages} (or ?page=all) | limit=100\n`;
    }
    out += `Last Updated (UTC): ${nowIso}\n`;
    out += `Public Audit URL: https://chronicle-ai-web.vercel.app/transactions.txt\n`;
    out += `================================================================================\n\n`;

    if (logs.length === 0) {
      out += `No transactions executed yet.\n\n`;
    } else {
      logs.forEach((log: any, index: number) => {
        const num = startNum + index;
        const createdAt = log.created_at || log.createdAt || "N/A";
        const actionType = log.action_type || log.actionType || "N/A";
        const status = (log.status || "UNKNOWN").toUpperCase();
        const message = log.message || "No message provided";

        const details =
          typeof log.details === "object" && log.details ? (log.details as Record<string, any>) : {};
        const keeperHubRunId =
          log.keeper_hub_run_id || details.keeper_hub_run_id || details.keeperHubRunId || null;
        const txHash =
          log.tx_hash ||
          details.txHash ||
          details.transactionHash ||
          details.registryTxHash ||
          details.payoutTxHash ||
          details.burnTxHash ||
          details.mintTxHash ||
          null;
        const explorerUrl =
          log.explorer_url ||
          details.explorer_url ||
          details.explorerUrl ||
          (txHash ? `https://sepolia.etherscan.io/tx/${txHash}` : null);
        const routing = details.routing || log.routing || null;

        out += `#${num} | [${createdAt}]\n`;
        out += `Action: ${actionType}\n`;
        out += `Status: ${status}\n`;
        if (keeperHubRunId) out += `KeeperHub Run ID: ${keeperHubRunId}\n`;
        if (txHash) out += `Tx Hash: ${txHash}\n`;
        if (explorerUrl) out += `Explorer: ${explorerUrl}\n`;
        if (routing) out += `Routing: ${routing}\n`;
        out += `Message: ${message}\n`;
        out += `--------------------------------------------------------------------------------\n\n`;
      });
    }

    out += `================================================================================\n`;
    out += `End of ChronicleAI Execution Log (Page ${currentPage}/${totalPages} — ${totalCount} Total)\n`;
    out += `================================================================================\n`;

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate, max-age=0");
    res.setHeader("X-Total-Count", totalCount.toString());
    res.setHeader("X-Total-Pages", totalPages.toString());
    res.setHeader("X-Current-Page", currentPage.toString());
    res.setHeader("Access-Control-Expose-Headers", "X-Total-Count, X-Total-Pages, X-Current-Page");
    res.send(out);
  };

  /**
   * GET /transactions.txt & GET /activity/transactions.txt
   * Plain text realtime audit log showing count and chronological list of transactions.
   */
  router.get("/transactions.txt", async (req, res, next) => {
    try {
      await renderTransactionsTxt(req, res);
    } catch (error) {
      next(error);
    }
  });

  router.get("/activity/transactions.txt", async (req, res, next) => {
    try {
      await renderTransactionsTxt(req, res);
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

      const entityIdRaw = typeof req.query.entityId === "string" ? req.query.entityId.trim() : "";
      const entityId =
        entityIdRaw &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entityIdRaw)
          ? entityIdRaw
          : undefined;
      const entityTypeRaw =
        typeof req.query.entityType === "string" ? req.query.entityType.trim() : "";
      const entityType = entityTypeRaw.length > 0 ? entityTypeRaw : undefined;

      const result = await execLogRepo.listPage({
        page: parsed.page,
        limit: parsed.limit,
        countMode: "planned",
        ...(entityId ? { entityId } : {}),
        ...(entityType ? { entityType } : {}),
      });
      if (!result.ok) {
        res.status(500).json({ error: result.error.message });
        return;
      }

      res.json(fromDbPage(result.value, serializePublicActivityLog));
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
        countMode: "planned",
      });
      if (!result.ok) {
        res.status(500).json({ error: result.error.message });
        return;
      }

      const failedPaymentIds = result.value.items
        .filter((p) => p.status === "failed")
        .map((p) => p.id);
      const diagnosticsByPaymentId = new Map<
        string,
        { details?: unknown; message?: string | null }
      >();

      if (failedPaymentIds.length > 0 && execLogRepo.listFailedByEntityIds) {
        const diagnostics = await execLogRepo
          .listFailedByEntityIds("payment_record", failedPaymentIds, 10)
          .catch(() => null);
        if (diagnostics?.ok) {
          for (const diagnostic of diagnostics.value) {
            if (diagnostic.entity_id && !diagnosticsByPaymentId.has(diagnostic.entity_id)) {
              diagnosticsByPaymentId.set(diagnostic.entity_id, diagnostic);
            }
          }
        }
      }

      const paymentsWithReasons = result.value.items.map((payment) => ({
        payment,
        failureReason: paymentFailureReason(
          payment,
          diagnosticsByPaymentId.get(payment.id),
        ),
      }));

      res.json(
        fromDbPage(
          {
            ...result.value,
            items: paymentsWithReasons,
          },
          ({ payment: p, failureReason }) => {
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
            if (failureReason) payment.failureReason = failureReason;
            return payment;
          },
        ),
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
        countMode: "planned",
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

  /**
   * GET /activity/cctp-rebalances
   * Page-based Circle CCTP rebalance transfer trail (newest first).
   */
  router.get("/activity/cctp-rebalances", async (req, res, next) => {
    try {
      if (!cctpRebalanceRepo) {
        res.json(
          fromDbPage(
            {
              items: [],
              page: 1,
              limit: 15,
              total: 0,
              totalPages: 0,
              hasNextPage: false,
              hasPreviousPage: false,
            },
            (row) => row,
          ),
        );
        return;
      }

      const parsed = parsePaginationQuery(req.query, {
        defaultLimit: 15,
        maxLimit: 100,
      });
      if ("error" in parsed) {
        res.status(400).json({ error: parsed.error });
        return;
      }

      const result = await cctpRebalanceRepo.listPage({
        page: parsed.page,
        limit: parsed.limit,
        countMode: "planned",
      });
      if (!result.ok) {
        res.status(500).json({ error: result.error.message });
        return;
      }

      res.json(
        fromDbPage(result.value, (row) => {
          const explorers = cctpExplorerUrls({
            burnTxHash: row.burn_tx_hash,
            mintTxHash: row.mint_tx_hash,
          });
          let durationMs: number | null = null;
          if (row.burned_at && row.minted_at) {
            const a = Date.parse(row.burned_at);
            const b = Date.parse(row.minted_at);
            if (Number.isFinite(a) && Number.isFinite(b) && b >= a) {
              durationMs = b - a;
            }
          }
          return {
            id: row.id,
            status: row.status,
            amountUsdc: row.amount_usdc,
            mode: row.mode,
            burnTxHash: row.burn_tx_hash ?? null,
            mintTxHash: row.mint_tx_hash ?? null,
            burnExplorerUrl: explorers.burnExplorerUrl ?? null,
            mintExplorerUrl: explorers.mintExplorerUrl ?? null,
            errorMessage: row.error_message ?? null,
            burnedAt: row.burned_at ?? null,
            mintedAt: row.minted_at ?? null,
            createdAt: row.created_at,
            durationMs,
          };
        }),
      );
    } catch (error) {
      next(error);
    }
  });

  return router;
}
