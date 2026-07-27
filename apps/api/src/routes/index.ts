// Central route registration

import { type Express, Router, type Router as RouterType } from "express";
import { healthRoutes } from "./health-routes.ts";

const apiRouter: RouterType = Router();

// Register routes
apiRouter.use(healthRoutes);

// Story routes will be added in subsequent phases:
// - keeperhub-event-routes (US1)
// - keeperhub-digest-routes (US2)
// - premium-routes, payment-routes (US3)
// - keeperhub-treasury-routes, operator-routes (US4)
// - alert-routes (US1)
// - digest-routes (US2)

export function registerRoutes(app: Express): void {
  app.use(apiRouter);
}

export { apiRouter };
