import { assertProductionReadiness, loadServerEnv } from "@chronicleai/config";
import {
  createAffiliateEarningRepository,
  createAffiliateFundingTransferRepository,
  createAffiliateRepository,
  createAffiliateWithdrawalRepository,
  createDailyDigestRepository,
  createEmailSubscriberRepository,
  createExecutionLogRepository,
  createLLMGenerationAttemptRepository,
  createMonitoredEventRepository,
  createAgentActivityRepository,
  createNewsletterSubscriptionRepository,
  createPaymentRecordRepository,
  createPayoutRecordRepository,
  createPremiumIntelligenceRepository,
  createPublicAlertRepository,
  createReferralAttributionRepository,
  createServerSupabaseClient,
  createSponsoredWatchRepository,
  createTreasurySnapshotRepository,
} from "@chronicleai/db";
import { createAffiliateEarningsService } from "./services/affiliate-earnings-service.ts";
import { createAffiliateFundingService } from "./services/affiliate-funding-service.ts";
import { createParaTreasuryClientFromEnv } from "./services/para-treasury-client.ts";
import { createPremiumProductizerService } from "./services/premium-productizer-service.ts";
import { createProviderConfigs } from "./services/llm-provider-client.ts";
import express, { type Express } from "express";
import compression from "compression";
import {
  corsMiddleware,
  errorHandler,
  publicGetCacheMiddleware,
  requestIdMiddleware,
  timingMiddleware,
} from "./middleware/core.ts";
import { publicAndLlmRateLimitMiddleware } from "./middleware/rate-limit.ts";
import {
  registerRoutes,
  setupUS1Routes,
  setupUS2Routes,
  setupUS3Routes,
  setupUS4Routes,
} from "./routes/index.ts";

const app: Express = express();
const isProduction = (process.env["NODE_ENV"] ?? "development") === "production";
const isTestRuntime =
  process.env["NODE_ENV"] === "test" || process.env["VITEST"] === "true";

// Trust reverse-proxy (Heroku) so req.ip / rate-limit keys use X-Forwarded-For.
app.set("trust proxy", 1);

// Middleware — compression first so JSON/API bodies are gzip/br encoded (P1-7)
app.use(compression({ threshold: 1024 }));
app.use(express.json());
app.use(requestIdMiddleware);
app.use(timingMiddleware);

// CORS must run before any middleware that can terminate a request (including
// rate limiting), otherwise browser clients cannot read error responses.
// CORS — production must set FRONTEND_ORIGIN (no silent localhost fallback).
const frontendOrigin = process.env["FRONTEND_ORIGIN"];
if (!frontendOrigin) {
  if (isProduction) {
    throw new Error(
      "FRONTEND_ORIGIN is required in production (CORS origin cannot default to localhost)",
    );
  }
}
app.use(corsMiddleware(frontendOrigin || "http://localhost:5173"));

// P2-3: per-IP limits on public GETs + tighter caps on LLM-adjacent / write paths
app.use(publicAndLlmRateLimitMiddleware());
app.use(publicGetCacheMiddleware);

// Register API routes
registerRoutes(app);

// Setup US1 through US4 routes when env is available
try {
  const env = loadServerEnv();
  assertProductionReadiness(env);

  const supabase = createServerSupabaseClient({
    supabaseUrl: env.supabaseUrl,
    supabaseServiceRoleKey: env.supabaseServiceRoleKey,
  });

  const eventRepo = createMonitoredEventRepository(supabase);
  const alertRepo = createPublicAlertRepository(supabase);
  const execLogRepo = createExecutionLogRepository(supabase);
  const llmAttemptRepo = createLLMGenerationAttemptRepository(supabase);
  const digestRepo = createDailyDigestRepository(supabase);
  const subscriberRepo = createEmailSubscriberRepository(supabase);
  const newsletterRepo = createNewsletterSubscriptionRepository(supabase);
  const premiumRepo = createPremiumIntelligenceRepository(supabase);
  const paymentRecordRepo = createPaymentRecordRepository(supabase);
  const watchRepo = createSponsoredWatchRepository(supabase);

  // US4 repositories
  const treasuryRepo = createTreasurySnapshotRepository(supabase);
  const payoutRepo = createPayoutRecordRepository(supabase);
  const activityRepo = createAgentActivityRepository(supabase);
  const affiliateRepo = createAffiliateRepository(supabase);
  const attributionRepo = createReferralAttributionRepository(supabase);
  const earningRepo = createAffiliateEarningRepository(supabase);
  const affiliateFundingRepo = createAffiliateFundingTransferRepository(supabase);
  const withdrawalRepo = createAffiliateWithdrawalRepository(supabase);

  const earningsService = createAffiliateEarningsService(
    {
      attributionRepo,
      earningRepo,
      affiliateRepo,
    },
    {
      referralRewardShare: env.referralRewardShare,
      // Cap each settlement credit using the period cap as a per-payment ceiling.
      referralRewardCapPerPayment: env.referralRewardCap,
    },
  );

  const affiliateFundingService = createAffiliateFundingService({
    repository: affiliateFundingRepo,
    treasuryClient: createParaTreasuryClientFromEnv(env, "x402"),
    destinationWallet: env.keeperhubAffiliateFundingWalletAddress,
    chainId: env.x402ChainId,
    tokenAddress: env.x402UsdcAddress,
  });
  if (affiliateFundingService.isConfigured() && !isTestRuntime) {
    console.info(
      "[affiliate-funding] enabled: settled affiliate rewards fund the KeeperHub wallet on the x402 rail",
    );
    const runAffiliateFundingRetry = () => {
      void affiliateFundingService.retryPending().then((result) => {
        if (result.attempted > 0) {
          console.info(
            `[affiliate-funding] retry attempted=${result.attempted} completed=${result.completed} failed=${result.failed}`,
          );
        }
      });
    };
    runAffiliateFundingRetry();
    setInterval(runAffiliateFundingRetry, 60_000).unref?.();
  } else {
    console.warn(
      "[affiliate-funding] disabled: set PARA_API_KEY and DESK_WALLET_ADDRESS (or KEEPERHUB_AFFILIATE_FUNDING_WALLET_ADDRESS) to fund the KeeperHub affiliate float",
    );
  }

  // Auto-mint deep dives / structured / historical feeds from real monitored activity.
  // Deep dives + historical narratives use Gemini → Groq → OpenAI (same stack as alerts).
  const premiumProductizer = createPremiumProductizerService({
    premiumRepo,
    eventRepo,
    execLogRepo,
    llmAttemptRepo,
    providerConfigs: createProviderConfigs(env),
  });

  // One-shot cleanup: hide non-LLM auto productizer leftovers (old boot backfill).
  void premiumRepo.archiveNonLlmAutoProducts().then((result) => {
    if (!result.ok) {
      console.warn(
        "Failed to archive non-LLM auto premium items:",
        result.error.message,
      );
      return;
    }
    if (result.value > 0) {
      console.info(`Archived ${result.value} non-LLM auto premium item(s)`);
    }
  });

  // US1: Public Alerts (treasury-gated registry writes)
  setupUS1Routes(app, env, {
    eventRepo,
    alertRepo,
    execLogRepo,
    llmAttemptRepo,
    treasuryRepo,
    premiumProductizer,
  });

  // US2: Daily Digests + free email + recurring x402 newsletter (treasury-gated registry writes)
  setupUS2Routes(app, env, {
    eventRepo,
    digestRepo,
    execLogRepo,
    llmAttemptRepo,
    subscriberRepo,
    treasuryRepo,
    newsletterRepo,
    premiumRepo,
    paymentRecordRepo,
    affiliateRepo,
    earningsService,
    fundingService: affiliateFundingService,
    premiumProductizer,
  });

  // US3: Premium Access & Sponsored Watch (Loop 4: create → monitor → report)
  setupUS3Routes(app, env, {
    premiumRepo,
    paymentRecordRepo,
    execLogRepo,
    watchRepo,
    eventRepo,
    affiliateRepo,
    attributionRepo,
    earningsService,
    fundingService: affiliateFundingService,
  });

  // US4: Public agent activity, treasury & revenue payouts + affiliate registry
  setupUS4Routes(app, env, {
    treasuryRepo,
    payoutRepo,
    paymentRecordRepo,
    execLogRepo,
    activityRepo,
    affiliateRepo,
    attributionRepo,
    earningRepo,
    withdrawalRepo,
  });

  // Periodically reap open payment challenges past expires_at.
  // Settlement also runs a best-effort reaper; this keeps status rows accurate without traffic.
  const CHALLENGE_EXPIRY_SWEEP_MS = 60_000;
  const runChallengeExpirySweep = () => {
    void paymentRecordRepo.expireOpenChallenges().then((result) => {
      if (!result.ok) {
        console.warn("Payment challenge expiry sweep failed:", result.error.message);
        return;
      }
      if (result.value > 0) {
        console.info(`Expired ${result.value} open payment challenge(s)`);
      }
    });
  };
  runChallengeExpirySweep();
  setInterval(runChallengeExpirySweep, CHALLENGE_EXPIRY_SWEEP_MS).unref?.();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (isProduction) {
    // Fail hard: misconfigured production must not serve partial / soft-disabled rails.
    console.error("Fatal: production bootstrap failed:", message);
    throw error instanceof Error ? error : new Error(message);
  }
  // Dev/test: allow partial boot (e.g. contract tests without full env).
  console.warn("Routes not fully configured:", message);
}

// Error handler (must be last)
app.use(errorHandler);

export { app };
