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
  DailyDigestRepository,
  ExecutionLogRepository,
  LLMGenerationAttemptRepository,
  MonitoredEventRepository,
  PublicAlertRepository,
} from "@chronicleai/db";
import { EventIngestionHandler } from "../keeperhub/event-ingestion-handler.ts";
import { keeperhubSignatureMiddleware } from "../middleware/keeperhub-signature.ts";
import { createAlertRoutes } from "./alert-routes.ts";
import { createKeeperhubEventRoutes } from "./keeperhub-event-routes.ts";

export interface US1Dependencies {
  eventRepo: MonitoredEventRepository;
  alertRepo: PublicAlertRepository;
  execLogRepo: ExecutionLogRepository;
  llmAttemptRepo: LLMGenerationAttemptRepository;
}

export function setupUS1Routes(app: Express, env: ServerEnv, deps: US1Dependencies): void {
  // Event ingestion handler
  const handler = new EventIngestionHandler({
    eventRepo: deps.eventRepo,
    alertRepo: deps.alertRepo,
    execLogRepo: deps.execLogRepo,
    llmAttemptRepo: deps.llmAttemptRepo,
    providerConfigs: {
      gemini: { apiKey: env.geminiApiKey, model: env.geminiModel, baseUrl: env.geminiBaseUrl },
      openai: { apiKey: env.openaiApiKey, model: env.openaiModel, baseUrl: env.openaiBaseUrl },
      groq: { apiKey: env.groqApiKey, model: env.groqModel, baseUrl: env.groqBaseUrl },
    },
  });

  // KeeperHub events (with signature middleware)
  const keeperhubRouter = Router();
  keeperhubRouter.use("/keeperhub", keeperhubSignatureMiddleware(env.keeperhubWebhookSecret));
  keeperhubRouter.use(createKeeperhubEventRoutes(handler));
  apiRouter.use(keeperhubRouter);

  // Public alerts (no auth required)
  apiRouter.use(createAlertRoutes(deps.alertRepo));
}

// ── US2: Daily Digest Routes ───────────────────────────

import { DigestRunHandler } from "../keeperhub/digest-run-handler.ts";
import { createChronicleRegistryService } from "../services/chronicle-registry-service.ts";
import { createDigestEventSelectionService } from "../services/digest-event-selection-service.ts";
import { createDigestGenerationService } from "../services/digest-generation-service.ts";
import { createDigestPublicationService } from "../services/digest-publication-service.ts";
import { createDigestWindowService } from "../services/digest-window-service.ts";
import { createSmtpEmailService } from "../services/smtp-email-service.ts";
import { createWeb3Client } from "../services/web3-client-service.ts";
import { createDigestRoutes } from "./digest-routes.ts";
import { createKeeperhubDigestRoutes } from "./keeperhub-digest-routes.ts";

export interface US2Dependencies {
  eventRepo: MonitoredEventRepository;
  digestRepo: DailyDigestRepository;
  execLogRepo: ExecutionLogRepository;
}

export function setupUS2Routes(app: Express, env: ServerEnv, deps: US2Dependencies): void {
  // Initialize services
  const web3Client = createWeb3Client(env);
  const registryService = createChronicleRegistryService(web3Client);
  const smtpService = createSmtpEmailService({
    host: env.smtpHost,
    port: env.smtpPort,
    user: env.smtpUser,
    pass: env.smtpPass,
    fromAddress: env.smtpFromAddress,
    subscriberList: env.smtpSubscriberList,
  });

  const windowService = createDigestWindowService(deps.digestRepo);
  const eventSelectionService = createDigestEventSelectionService(deps.eventRepo);
  const generationService = createDigestGenerationService();
  const publicationService = createDigestPublicationService(
    deps.digestRepo,
    registryService,
    env.frontendOrigin,
    smtpService,
  );

  const handler = new DigestRunHandler({
    digestRepo: deps.digestRepo,
    eventRepo: deps.eventRepo,
    execLogRepo: deps.execLogRepo,
    windowService,
    eventSelectionService,
    generationService,
    publicationService,
  });

  // KeeperHub digest run (with signature middleware)
  const keeperhubRouter = Router();
  keeperhubRouter.use("/keeperhub", keeperhubSignatureMiddleware(env.keeperhubWebhookSecret));
  keeperhubRouter.use(createKeeperhubDigestRoutes(handler));
  apiRouter.use(keeperhubRouter);

  // Latest digest (no auth required)
  apiRouter.use(createDigestRoutes(deps.digestRepo));
}

// ── US3: Premium Access & Sponsored Watch Routes ────────

import type {
  PaymentRecordRepository,
  PremiumIntelligenceRepository,
  SponsoredWatchRepository,
} from "@chronicleai/db";
import type { PaymentRoute } from "@chronicleai/schemas";
import { MppPaymentAdapter } from "../payments/mpp-payment-adapter.ts";
import type { PaymentAdapter } from "../payments/payment-adapter.ts";
import { X402PaymentAdapter } from "../payments/x402-payment-adapter.ts";
import { createPaymentRoutes } from "./payment-routes.ts";
import { createPremiumRoutes } from "./premium-routes.ts";

export interface US3Dependencies {
  premiumRepo: PremiumIntelligenceRepository;
  paymentRecordRepo: PaymentRecordRepository;
  execLogRepo: ExecutionLogRepository;
  watchRepo: SponsoredWatchRepository;
}
export function setupUS3Routes(app: Express, env: ServerEnv, deps: US3Dependencies): void {
  const web3Client = createWeb3Client(env);

  // Initialize payment adapters
  const adapters = new Map<PaymentRoute, PaymentAdapter>();
  adapters.set(
    "x402",
    new X402PaymentAdapter({
      facilitatorUrl: env.x402FacilitatorUrl ?? undefined,
      treasuryWalletAddress: env.treasuryWalletAddress ?? undefined,
    }),
  );
  adapters.set("mpp", new MppPaymentAdapter({ mppSecret: env.mppSecret ?? undefined }));

  // Premium routes
  apiRouter.use(
    createPremiumRoutes({
      premiumRepo: deps.premiumRepo,
      paymentRecordRepo: deps.paymentRecordRepo,
      execLogRepo: deps.execLogRepo,
      watchRepo: deps.watchRepo,
    }),
  );

  // Payment routes
  apiRouter.use(
    createPaymentRoutes({
      premiumRepo: deps.premiumRepo,
      paymentRecordRepo: deps.paymentRecordRepo,
      execLogRepo: deps.execLogRepo,
      watchRepo: deps.watchRepo,
      adapters,
      web3Client,
    }),
  );
}

// ── US4: Operator Sustainability & Revenue Payouts Routes ─

import type {
  OperatorAuditRepository,
  PayoutRecordRepository,
  TreasurySnapshotRepository,
} from "@chronicleai/db";
import { RevenueRoutingHandler } from "../keeperhub/revenue-routing-handler.ts";
import { TreasuryCheckHandler } from "../keeperhub/treasury-check-handler.ts";
import { createOperatorAuditService } from "../services/operator-audit-service.ts";
import { createOperatorNotificationService } from "../services/operator-notification-service.ts";
import { createRevenueRoutingService } from "../services/revenue-routing-service.ts";
import { createTreasuryStatusService } from "../services/treasury-status-service.ts";
import { createKeeperhubRevenueRoutes } from "./keeperhub-revenue-routes.ts";
import { createKeeperhubTreasuryRoutes } from "./keeperhub-treasury-routes.ts";
import { createOperatorRoutes } from "./operator-routes.ts";

export interface US4Dependencies {
  treasuryRepo: TreasurySnapshotRepository;
  payoutRepo: PayoutRecordRepository;
  paymentRecordRepo: PaymentRecordRepository;
  execLogRepo: ExecutionLogRepository;
  auditRepo: OperatorAuditRepository;
}

export function setupUS4Routes(app: Express, env: ServerEnv, deps: US4Dependencies): void {
  // Initialize services
  const web3Client = createWeb3Client(env);
  const registryService = createChronicleRegistryService(web3Client);
  const treasuryService = createTreasuryStatusService();
  const notificationService = createOperatorNotificationService(deps.execLogRepo);

  const routingService = createRevenueRoutingService({
    treasuryRepo: deps.treasuryRepo,
    paymentRepo: deps.paymentRecordRepo,
    payoutRepo: deps.payoutRepo,
    execLogRepo: deps.execLogRepo,
    treasuryService,
    registryService,
    web3Client,
  });

  const treasuryHandler = new TreasuryCheckHandler({
    treasuryRepo: deps.treasuryRepo,
    execLogRepo: deps.execLogRepo,
    treasuryService,
    notificationService,
  });

  const revenueHandler = new RevenueRoutingHandler({
    routingService,
    execLogRepo: deps.execLogRepo,
  });

  const auditService = createOperatorAuditService(deps.auditRepo);

  // KeeperHub treasury check (with signature middleware)
  const keeperhubRouter = Router();
  keeperhubRouter.use("/keeperhub", keeperhubSignatureMiddleware(env.keeperhubWebhookSecret));
  keeperhubRouter.use(createKeeperhubTreasuryRoutes(treasuryHandler));
  keeperhubRouter.use(createKeeperhubRevenueRoutes(revenueHandler));
  apiRouter.use(keeperhubRouter);

  // Operator audit route (public)
  apiRouter.use(createOperatorRoutes(auditService));
}
