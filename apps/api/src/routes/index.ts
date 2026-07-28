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
  EmailSubscriberRepository,
  ExecutionLogRepository,
  LLMGenerationAttemptRepository,
  MonitoredEventRepository,
  PublicAlertRepository,
} from "@chronicleai/db";
import { BlockIngestionHandler } from "../keeperhub/block-ingestion-handler.ts";
import { EventIngestionHandler } from "../keeperhub/event-ingestion-handler.ts";
import { createEventNormalizer } from "../monitoring/event-normalizer.ts";
import { createOnChainBlockService } from "../monitoring/on-chain-block-service.ts";
import { createPriceOracle } from "../monitoring/price-oracle-service.ts";
import { keeperhubSignatureMiddleware } from "../middleware/keeperhub-signature.ts";
import { createAlertRoutes } from "./alert-routes.ts";
import { createKeeperhubBlockRoutes } from "./keeperhub-block-routes.ts";
import { createKeeperhubEventRoutes } from "./keeperhub-event-routes.ts";

export interface US1Dependencies {
  eventRepo: MonitoredEventRepository;
  alertRepo: PublicAlertRepository;
  execLogRepo: ExecutionLogRepository;
  llmAttemptRepo: LLMGenerationAttemptRepository;
}

export function setupUS1Routes(app: Express, env: ServerEnv, deps: US1Dependencies): void {
  // KeeperHub-backed registry writes for publishAlert (null if not configured)
  const web3Client = createWeb3Client(env);
  const registryService = createChronicleRegistryService(web3Client);

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
    registryService,
    frontendOrigin: env.frontendOrigin,
  });

  const priceOracle = createPriceOracle(env.rpcUrl);
  const eventNormalizer = createEventNormalizer(priceOracle);
  const blockService = createOnChainBlockService(env.rpcUrl);
  const blockHandler = new BlockIngestionHandler(blockService, handler, deps.execLogRepo);

  // KeeperHub events + blocks (with signature middleware)
  const keeperhubRouter = Router();
  keeperhubRouter.use("/keeperhub", keeperhubSignatureMiddleware(env.keeperhubWebhookSecret));
  keeperhubRouter.use(createKeeperhubEventRoutes(handler, eventNormalizer));
  keeperhubRouter.use(createKeeperhubBlockRoutes(blockHandler));
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
import { resolveTreasuryWallet } from "../services/treasury-wallet.ts";
import { createWeb3Client } from "../services/web3-client-service.ts";
import { createDigestRoutes } from "./digest-routes.ts";
import { createKeeperhubDigestRoutes } from "./keeperhub-digest-routes.ts";
import { createSubscriberRoutes } from "./subscriber-routes.ts";

export interface US2Dependencies {
  eventRepo: MonitoredEventRepository;
  digestRepo: DailyDigestRepository;
  execLogRepo: ExecutionLogRepository;
  subscriberRepo: EmailSubscriberRepository;
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
    resolveRecipients: async (channel) => {
      const result = await deps.subscriberRepo.listActiveEmails(channel);
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      return result.value;
    },
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

  // Email newsletter subscribe / unsubscribe (public)
  apiRouter.use(createSubscriberRoutes(deps.subscriberRepo));
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
import {
  PremiumAccessReceiptService,
  resolvePremiumAccessSecret,
} from "../services/premium-access-receipt-service.ts";
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
  const treasury = resolveTreasuryWallet(env);

  // Initialize payment adapters
  const adapters = new Map<PaymentRoute, PaymentAdapter>();
  adapters.set(
    "x402",
    new X402PaymentAdapter({
      facilitatorUrl: env.x402FacilitatorUrl ?? undefined,
      // Prefer address derived from TREASURY_WALLET_PRIVATE_KEY so receive === spend key
      treasuryWalletAddress: treasury.address,
      // Real settlement rail: facilitator (preferred) or direct EIP-3009 submission
      rpcUrl: env.rpcUrl ?? undefined,
      settlementPrivateKey: treasury.privateKey ?? undefined,
      // Env-driven EIP-712 domain (defaults: Base Sepolia + Circle USDC)
      chainId: env.x402ChainId,
      usdcAddress: env.x402UsdcAddress,
    }),
  );
  adapters.set("mpp", new MppPaymentAdapter({ mppSecret: env.mppSecret ?? undefined }));

  const receiptService = new PremiumAccessReceiptService({
    secret: resolvePremiumAccessSecret({
      premiumAccessSecret: env.premiumAccessSecret,
      keeperhubWebhookSecret: env.keeperhubWebhookSecret,
    }),
  });

  // Premium routes
  apiRouter.use(
    createPremiumRoutes({
      premiumRepo: deps.premiumRepo,
      paymentRecordRepo: deps.paymentRecordRepo,
      execLogRepo: deps.execLogRepo,
      watchRepo: deps.watchRepo,
      receiptService,
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
      receiptService,
      web3Client,
      secureCookies: env.nodeEnv === "production",
      frontendOrigin: env.frontendOrigin,
    }),
  );
}

// ── US4: Public Agent Activity, Treasury & Revenue Payouts ─

import type {
  AgentActivityRepository,
  PayoutRecordRepository,
  TreasurySnapshotRepository,
} from "@chronicleai/db";
import { RevenueRoutingHandler } from "../keeperhub/revenue-routing-handler.ts";
import { TreasuryCheckHandler } from "../keeperhub/treasury-check-handler.ts";
import { createAgentActivityService } from "../services/agent-activity-service.ts";
import { createNotificationService } from "../services/notification-service.ts";
import { createRevenueRoutingService } from "../services/revenue-routing-service.ts";
import { createTreasuryStatusService } from "../services/treasury-status-service.ts";
import { createActivityRoutes } from "./activity-routes.ts";
import { createKeeperhubRevenueRoutes } from "./keeperhub-revenue-routes.ts";
import { createKeeperhubTreasuryRoutes } from "./keeperhub-treasury-routes.ts";

export interface US4Dependencies {
  treasuryRepo: TreasurySnapshotRepository;
  payoutRepo: PayoutRecordRepository;
  paymentRecordRepo: PaymentRecordRepository;
  execLogRepo: ExecutionLogRepository;
  activityRepo: AgentActivityRepository;
}

export function setupUS4Routes(app: Express, env: ServerEnv, deps: US4Dependencies): void {
  const web3Client = createWeb3Client(env);
  const registryService = createChronicleRegistryService(web3Client);
  const treasuryService = createTreasuryStatusService();
  const notificationService = createNotificationService(deps.execLogRepo);
  const treasury = resolveTreasuryWallet(env);

  if (!treasury.privateKey) {
    console.warn(
      "TREASURY_WALLET_PRIVATE_KEY is not set — revenue routing transfers will fail until the treasury can sign payouts",
    );
  }

  if (!env.creatorRecoveryWallet) {
    console.warn(
      "CREATOR_RECOVERY_WALLET is not set — KeeperHub revenue routing will reject until configured",
    );
  } else if (
    treasury.address &&
    env.creatorRecoveryWallet.toLowerCase() === treasury.address.toLowerCase()
  ) {
    console.warn(
      "CREATOR_RECOVERY_WALLET matches TREASURY address — payouts will send treasury funds back to itself. Use a separate creator destination wallet.",
    );
  }

  const routingService = env.creatorRecoveryWallet
    ? createRevenueRoutingService(
        {
          treasuryRepo: deps.treasuryRepo,
          paymentRepo: deps.paymentRecordRepo,
          payoutRepo: deps.payoutRepo,
          execLogRepo: deps.execLogRepo,
          treasuryService,
          registryService,
          web3Client,
        },
        {
          creatorRecoveryWallet: env.creatorRecoveryWallet,
          referralRewardCap: 1000,
          maxPayoutShare: 0.5,
          routingIntervalMs: 7 * 24 * 60 * 60 * 1000,
          ethPerCurrencyUnit: env.revenueEthPerCurrencyUnit,
        },
      )
    : {
        async routeRevenue(periodHash?: string) {
          return {
            routed: false,
            totalRevenue: 0,
            creatorRecoveryAmount: 0,
            referralRewardsAmount: 0,
            payoutPeriodHash: periodHash ?? `period_${Date.now()}`,
            payoutIds: [] as string[],
            errorMessage:
              "CREATOR_RECOVERY_WALLET is not configured — cannot route revenue",
          };
        },
      };

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

  const activityService = createAgentActivityService(deps.activityRepo);

  // KeeperHub treasury check (with signature middleware)
  const keeperhubRouter = Router();
  keeperhubRouter.use("/keeperhub", keeperhubSignatureMiddleware(env.keeperhubWebhookSecret));
  keeperhubRouter.use(createKeeperhubTreasuryRoutes(treasuryHandler));
  keeperhubRouter.use(createKeeperhubRevenueRoutes(revenueHandler));
  apiRouter.use(keeperhubRouter);

  // Public agent activity (no auth)
  apiRouter.use(createActivityRoutes(activityService));
}
