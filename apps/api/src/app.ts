import { loadServerEnv } from "@chronicleai/config";
import {
  createDailyDigestRepository,
  createEmailSubscriberRepository,
  createExecutionLogRepository,
  createLLMGenerationAttemptRepository,
  createMonitoredEventRepository,
  createAgentActivityRepository,
  createPaymentRecordRepository,
  createPayoutRecordRepository,
  createPremiumIntelligenceRepository,
  createPublicAlertRepository,
  createServerSupabaseClient,
  createSponsoredWatchRepository,
  createTreasurySnapshotRepository,
} from "@chronicleai/db";
import express, { type Express } from "express";
import {
  corsMiddleware,
  errorHandler,
  requestIdMiddleware,
  timingMiddleware,
} from "./middleware/core.ts";
import {
  registerRoutes,
  setupUS1Routes,
  setupUS2Routes,
  setupUS3Routes,
  setupUS4Routes,
} from "./routes/index.ts";

const app: Express = express();

// Middleware
app.use(express.json());
app.use(requestIdMiddleware);
app.use(timingMiddleware);

// CORS - will be configured with proper origin when env is loaded
const frontendOrigin = process.env["FRONTEND_ORIGIN"] || "http://localhost:5173";
app.use(corsMiddleware(frontendOrigin));

// Register API routes
registerRoutes(app);

// Setup US1 through US4 routes when env is available
try {
  const env = loadServerEnv();
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
  const premiumRepo = createPremiumIntelligenceRepository(supabase);
  const paymentRecordRepo = createPaymentRecordRepository(supabase);
  const watchRepo = createSponsoredWatchRepository(supabase);

  // US4 repositories
  const treasuryRepo = createTreasurySnapshotRepository(supabase);
  const payoutRepo = createPayoutRecordRepository(supabase);
  const activityRepo = createAgentActivityRepository(supabase);

  // US1: Public Alerts
  setupUS1Routes(app, env, {
    eventRepo,
    alertRepo,
    execLogRepo,
    llmAttemptRepo,
  });

  // US2: Daily Digests + email subscribers
  setupUS2Routes(app, env, {
    eventRepo,
    digestRepo,
    execLogRepo,
    subscriberRepo,
  });

  // US3: Premium Access & Sponsored Watch (Loop 4: create → monitor → report)
  setupUS3Routes(app, env, {
    premiumRepo,
    paymentRecordRepo,
    execLogRepo,
    watchRepo,
    eventRepo,
  });

  // US4: Public agent activity, treasury & revenue payouts
  setupUS4Routes(app, env, {
    treasuryRepo,
    payoutRepo,
    paymentRecordRepo,
    execLogRepo,
    activityRepo,
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
  // Log but don't crash - env vars may not be available in all contexts
  console.warn("Routes not fully configured:", error instanceof Error ? error.message : error);
}

// Error handler (must be last)
app.use(errorHandler);

export { app };
