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
  NewsletterSubscriptionRepository,
  PaymentRecordRepository,
  PremiumIntelligenceRepository,
  PublicAlertRepository,
  TreasurySnapshotRepository,
} from "@chronicleai/db";
import { BlockIngestionHandler } from "../keeperhub/block-ingestion-handler.ts";
import { EventIngestionHandler } from "../keeperhub/event-ingestion-handler.ts";
import { createEventNormalizer } from "../monitoring/event-normalizer.ts";
import { createOnChainBlockService } from "../monitoring/on-chain-block-service.ts";
import { createPriceOracle } from "../monitoring/price-oracle-service.ts";
import { X402PaymentAdapter } from "../payments/x402-payment-adapter.ts";
import { createNewsletterSubscriptionService } from "../services/newsletter-subscription-service.ts";
import { PaymentSettlementService } from "../services/payment-settlement-service.ts";
import { createTreasuryRegistryGate } from "../services/treasury-registry-gate.ts";
import { createTreasuryStatusService } from "../services/treasury-status-service.ts";
import { keeperhubSignatureMiddleware } from "../middleware/keeperhub-signature.ts";
import { createAlertRoutes } from "./alert-routes.ts";
import { createKeeperhubBlockRoutes } from "./keeperhub-block-routes.ts";
import { createKeeperhubEventRoutes } from "./keeperhub-event-routes.ts";

export interface US1Dependencies {
  eventRepo: MonitoredEventRepository;
  alertRepo: PublicAlertRepository;
  execLogRepo: ExecutionLogRepository;
  llmAttemptRepo: LLMGenerationAttemptRepository;
  /** Latest treasury snapshots for FR-026 treasury-gated registry writes. */
  treasuryRepo: TreasurySnapshotRepository;
}

export function setupUS1Routes(app: Express, env: ServerEnv, deps: US1Dependencies): void {
  // KeeperHub-backed registry writes for publishAlert (null if not configured)
  const web3Client = createWeb3Client(env);
  const registryService = createChronicleRegistryService(web3Client);
  const treasuryGate = createTreasuryRegistryGate(
    deps.treasuryRepo,
    createTreasuryStatusService(),
  );

  // Community channels: Discord + Telegram post-registry alert fan-out (IDEA Loop 1 step 5)
  const notificationService = createNotificationService(deps.execLogRepo, {
    community: {
      discordWebhookUrl: env.discordWebhookUrl,
      telegramBotToken: env.telegramBotToken,
      telegramChatId: env.telegramChatId,
    },
  });
  const channels = notificationService.getConfiguredChannels();
  if (!channels.discord && !channels.telegram) {
    console.warn(
      "DISCORD_WEBHOOK_URL / TELEGRAM_BOT_TOKEN+TELEGRAM_CHAT_ID not set — alert community broadcasts will log only",
    );
  }

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
    notificationService,
    treasuryGate,
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
import {
  createNotificationService,
} from "../services/notification-service.ts";
import { createSmtpEmailService } from "../services/smtp-email-service.ts";
import { createParaTreasuryClientFromEnv } from "../services/para-treasury-client.ts";
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
  /** Latest treasury snapshots for FR-026 treasury-gated registry writes. */
  treasuryRepo: TreasurySnapshotRepository;
  /** Required for recurring x402 newsletter agreements + premium digest fan-out. */
  newsletterRepo: NewsletterSubscriptionRepository;
  premiumRepo: PremiumIntelligenceRepository;
  paymentRecordRepo: PaymentRecordRepository;
}

export function setupUS2Routes(app: Express, env: ServerEnv, deps: US2Dependencies): void {
  // Initialize services
  const web3Client = createWeb3Client(env);
  const registryService = createChronicleRegistryService(web3Client);
  const treasuryGate = createTreasuryRegistryGate(
    deps.treasuryRepo,
    createTreasuryStatusService(),
  );

  // Recurring x402 monthly newsletter (agreement + renewals + paid digests)
  const treasury = resolveTreasuryWallet(env);
  const treasuryAddressHolder = { address: treasury.address };
  if (web3Client?.isParaTreasuryBacked()) {
    void web3Client
      .getTreasuryAddress()
      .then((address) => {
        if (address) {
          treasuryAddressHolder.address = address;
        }
      })
      .catch(() => {
        // Non-fatal: x402 challenges still use the static/fallback treasury address.
      });
  }

  const x402Adapter = new X402PaymentAdapter({
    facilitatorUrl: env.x402FacilitatorUrl ?? undefined,
    treasuryWalletAddress: () => treasuryAddressHolder.address,
    rpcUrl: env.rpcUrl ?? undefined,
    settlementPrivateKey: treasury.privateKey ?? undefined,
    chainId: env.x402ChainId,
    usdcAddress: env.x402UsdcAddress,
  });

  const settlementService = new PaymentSettlementService({
    paymentRecordRepo: deps.paymentRecordRepo,
    execLogRepo: deps.execLogRepo,
    adapters: new Map([["x402", x402Adapter]]),
  });

  const newsletterService = createNewsletterSubscriptionService({
    newsletterRepo: deps.newsletterRepo,
    premiumRepo: deps.premiumRepo,
    paymentRecordRepo: deps.paymentRecordRepo,
    subscriberRepo: deps.subscriberRepo,
    execLogRepo: deps.execLogRepo,
    x402Adapter,
    settlementService,
    config: {
      monthlyPriceUsdc: env.newsletterMonthlyPriceUsdc,
      billingPeriodDays: env.newsletterBillingPeriodDays,
      gracePeriodDays: env.newsletterGracePeriodDays,
    },
  });

  // Ensure catalog product exists so payment_records FK always has a target.
  void newsletterService.ensureNewsletterProduct().catch((error) => {
    console.warn(
      "Failed to ensure monthly newsletter product:",
      error instanceof Error ? error.message : error,
    );
  });

  const smtpService = createSmtpEmailService({
    host: env.smtpHost,
    port: env.smtpPort,
    user: env.smtpUser,
    pass: env.smtpPass,
    fromAddress: env.smtpFromAddress,
    resolveRecipients: async (channel) => {
      // Digests go to paid active x402 newsletter subscribers (IDEA Loop 2 step 6).
      // Alerts continue to free email_subscribers opt-ins.
      if (channel === "digest") {
        return newsletterService.listPremiumDigestEmails();
      }
      const result = await deps.subscriberRepo.listActiveEmails(channel);
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      return result.value;
    },
  });
  const notificationService = createNotificationService(deps.execLogRepo, {
    community: {
      discordWebhookUrl: env.discordWebhookUrl,
      telegramBotToken: env.telegramBotToken,
      telegramChatId: env.telegramChatId,
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
    notificationService,
    treasuryGate,
    deps.execLogRepo,
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

  // Free email opt-in + recurring x402 newsletter subscribe / renew / settle
  apiRouter.use(createSubscriberRoutes(deps.subscriberRepo, newsletterService));

  // Billing cycle: active → past_due → expired without renewal
  const NEWSLETTER_BILLING_SWEEP_MS = 5 * 60_000;
  const runNewsletterBillingSweep = () => {
    void newsletterService.processBillingCycle().then((result) => {
      if (result.pastDue || result.expired || result.cancelledAtPeriodEnd) {
        console.info(
          `Newsletter billing sweep: pastDue=${result.pastDue} expired=${result.expired} cancelledAtPeriodEnd=${result.cancelledAtPeriodEnd}`,
        );
      }
      if (result.errors.length > 0) {
        console.warn("Newsletter billing sweep errors:", result.errors.join(" | "));
      }
    });
  };
  runNewsletterBillingSweep();
  setInterval(runNewsletterBillingSweep, NEWSLETTER_BILLING_SWEEP_MS).unref?.();
}

// ── US3: Premium Access & Sponsored Watch Routes ────────

import type { SponsoredWatchRepository } from "@chronicleai/db";
import type { PaymentRoute } from "@chronicleai/schemas";
import { MppPaymentAdapter } from "../payments/mpp-payment-adapter.ts";
import type { PaymentAdapter } from "../payments/payment-adapter.ts";
import {
  PremiumAccessReceiptService,
  resolvePremiumAccessSecret,
} from "../services/premium-access-receipt-service.ts";
import { createSponsoredWatchService } from "../services/sponsored-watch-service.ts";
import { createKeeperhubSponsoredWatchRoutes } from "./keeperhub-sponsored-watch-routes.ts";
import { createPaymentRoutes } from "./payment-routes.ts";
import { createPremiumRoutes } from "./premium-routes.ts";

export interface US3Dependencies {
  premiumRepo: PremiumIntelligenceRepository;
  paymentRecordRepo: PaymentRecordRepository;
  execLogRepo: ExecutionLogRepository;
  watchRepo: SponsoredWatchRepository;
  /** Required for Loop 4 campaign-window event correlation. */
  eventRepo: MonitoredEventRepository;
}

/** Interval for automated sponsored-watch activate / monitor / complete (Loop 4). */
const SPONSORED_WATCH_CYCLE_MS = 60_000;

export function setupUS3Routes(app: Express, env: ServerEnv, deps: US3Dependencies): void {
  const web3Client = createWeb3Client(env);
  const treasury = resolveTreasuryWallet(env);

  // Production: resolve Para MPC treasury address (async warm-up; x402 uses sync fallback then refresh)
  const treasuryAddressHolder = { address: treasury.address };
  if (web3Client?.isParaTreasuryBacked()) {
    void web3Client
      .getTreasuryAddress()
      .then((address) => {
        if (address) {
          treasuryAddressHolder.address = address;
          console.info(`[para] Production treasury MPC wallet ready: ${address}`);
        }
      })
      .catch((error) => {
        console.error(
          "[para] Failed to ensure Para MPC treasury wallet:",
          error instanceof Error ? error.message : error,
        );
      });
  }

  // Initialize payment adapters
  const adapters = new Map<PaymentRoute, PaymentAdapter>();
  adapters.set(
    "x402",
    new X402PaymentAdapter({
      facilitatorUrl: env.x402FacilitatorUrl ?? undefined,
      // Prefer Para MPC address (production) once warm-up completes
      treasuryWalletAddress: () => treasuryAddressHolder.address,
      // Real settlement rail: facilitator (preferred) or direct EIP-3009 submission.
      // Gas key is only for submitting transferWithAuthorization — not the Para MPC spend key.
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

  // Shared Loop 4 service: create on payment, monitor window, auto-publish report
  const watchService = createSponsoredWatchService({
    watchRepo: deps.watchRepo,
    execLogRepo: deps.execLogRepo,
    web3Client,
    eventRepo: deps.eventRepo,
    frontendOrigin: env.frontendOrigin,
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
      watchService,
      secureCookies: env.nodeEnv === "production",
      frontendOrigin: env.frontendOrigin,
    }),
  );

  // KeeperHub-triggered campaign cycle (scheduled workflow) + signed webhook
  const keeperhubRouter = Router();
  keeperhubRouter.use("/keeperhub", keeperhubSignatureMiddleware(env.keeperhubWebhookSecret));
  keeperhubRouter.use(createKeeperhubSponsoredWatchRoutes(watchService));
  apiRouter.use(keeperhubRouter);

  // In-process Loop 4 driver: activate / monitor / complete ended campaigns
  const runSponsoredWatchCycle = () => {
    void watchService.processCampaignCycle().then((result) => {
      if (result.activated || result.monitored || result.completed || result.failed) {
        console.info(
          `Sponsored watch cycle: activated=${result.activated} monitored=${result.monitored} completed=${result.completed} failed=${result.failed}`,
        );
      }
      if (result.errors.length > 0) {
        console.warn("Sponsored watch cycle errors:", result.errors.join(" | "));
      }
    });
  };
  runSponsoredWatchCycle();
  setInterval(runSponsoredWatchCycle, SPONSORED_WATCH_CYCLE_MS).unref?.();
}

// ── US4: Public Agent Activity, Treasury & Revenue Payouts ─

import type {
  AgentActivityRepository,
  PayoutRecordRepository,
} from "@chronicleai/db";
import { RevenueRoutingHandler } from "../keeperhub/revenue-routing-handler.ts";
import { TreasuryCheckHandler } from "../keeperhub/treasury-check-handler.ts";
import { createAgentActivityService } from "../services/agent-activity-service.ts";
import { createRevenueRoutingService } from "../services/revenue-routing-service.ts";
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
  const notificationService = createNotificationService(deps.execLogRepo, {
    community: {
      discordWebhookUrl: env.discordWebhookUrl,
      telegramBotToken: env.telegramBotToken,
      telegramChatId: env.telegramChatId,
    },
  });
  const treasury = resolveTreasuryWallet(env);
  const paraTreasury = createParaTreasuryClientFromEnv(env);

  if (paraTreasury) {
    void paraTreasury
      .ensureWallet()
      .then((wallet) => {
        console.info(
          `[para] Revenue routing treasury MPC wallet: ${wallet.address} (id=${wallet.walletId})`,
        );
      })
      .catch((error) => {
        console.error(
          "[para] Failed to ensure Para MPC treasury for revenue routing:",
          error instanceof Error ? error.message : error,
        );
      });
  } else if (!treasury.privateKey && treasury.provider !== "keeperhub") {
    console.warn(
      "No production treasury spend path: set PARA_API_KEY for Para MPC, or KeeperHub write config, or TREASURY_WALLET_PRIVATE_KEY for local tests only",
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
    ...(paraTreasury
      ? {
          liveBalanceProvider: async () => {
            const eth = await paraTreasury.getNativeBalanceEth();
            return {
              availableBalance: eth,
              currency: "ETH",
              source: "para-mpc" as const,
            };
          },
        }
      : {}),
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
