// Central route registration

import { type Express, Router, type Router as RouterType } from "express";
import { healthRoutes } from "./health-routes.ts";

const apiRouter: RouterType = Router();

// Register all routes
apiRouter.use(healthRoutes);

// Story routes will be registered by the setup function
export function registerRoutes(app: Express): void {
  app.use(apiRouter);
}

export { apiRouter };

// Lazy setup function to avoid circular dependencies
import type { ServerEnv } from "@chronicleai/config";
import type {
  MonitoredEventRepository,
  PublicAlertRepository,
  ExecutionLogRepository,
  LLMGenerationAttemptRepository,
} from "@chronicleai/db";
import { keeperhubSignatureMiddleware } from "../middleware/keeperhub-signature.ts";
import { EventIngestionHandler } from "../keeperhub/event-ingestion-handler.ts";
import { createKeeperhubEventRoutes } from "./keeperhub-event-routes.ts";
import { createAlertRoutes } from "./alert-routes.ts";

export interface US1Dependencies {
  eventRepo: MonitoredEventRepository;
  alertRepo: PublicAlertRepository;
  execLogRepo: ExecutionLogRepository;
  llmAttemptRepo: LLMGenerationAttemptRepository;
}

export function setupUS1Routes(
  app: Express,
  env: ServerEnv,
  deps: US1Dependencies,
): void {
  // Event ingestion handler
  const handler = new EventIngestionHandler({
    eventRepo: deps.eventRepo,
    alertRepo: deps.alertRepo,
    execLogRepo: deps.execLogRepo,
    llmAttemptRepo: deps.llmAttemptRepo,
    providerConfigs: {
      gemini: { apiKey: env.geminiApiKey, model: env.geminiModel },
      openai: { apiKey: env.openaiApiKey, model: env.openaiModel },
      groq: { apiKey: env.groqApiKey, model: env.groqModel },
    },
  });

  // KeeperHub events (with signature middleware)
  const keeperhubRouter = Router();
  keeperhubRouter.use(keeperhubSignatureMiddleware(env.keeperhubWebhookSecret));
  keeperhubRouter.use(createKeeperhubEventRoutes(handler));
  apiRouter.use(keeperhubRouter);

  // Public alerts (no auth required)
  apiRouter.use(createAlertRoutes(deps.alertRepo));
}
