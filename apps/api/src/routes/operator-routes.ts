// Operator routes: GET /operator/audit
// Returns operator audit data aggregated from multiple tables

import { Router, type Router as RouterType } from "express";
import type { OperatorAuditService } from "../services/operator-audit-service.ts";

export function createOperatorRoutes(
  auditService: OperatorAuditService,
): RouterType {
  const router: RouterType = Router();

  /**
   * GET /operator/audit
   *
   * Returns aggregated operator dashboard data including recent alerts,
   * digests, payments, treasury status, active sponsored watches,
   * payout records, and execution logs.
   *
   * Responses:
   *   200 - { alerts, digests, payments, treasury, executionLogs }
   */
  router.get(
    "/operator/audit",
    async (_req, res, next) => {
      try {
        const result = await auditService.getAudit();

        if (!result.success) {
          res.status(500).json({ error: result.error ?? "Failed to fetch audit data" });
          return;
        }

        res.json(result.data);
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
