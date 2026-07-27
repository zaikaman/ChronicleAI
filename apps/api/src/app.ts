import { loadServerEnv } from "@chronicleai/config";
import {
  createDailyDigestRepository,
  createExecutionLogRepository,
  createLLMGenerationAttemptRepository,
  createMonitoredEventRepository,
  createPublicAlertRepository,
  createServerSupabaseClient,
} from "@chronicleai/db";
import express, { type Express } from "express";
import {
  corsMiddleware,
  errorHandler,
  requestIdMiddleware,
  timingMiddleware,
} from "./middleware/core.ts";
import { registerRoutes, setupUS1Routes, setupUS2Routes } from "./routes/index.ts";

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

// Setup US1 and US2 routes when env is available
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

  // US1: Public Alerts
  setupUS1Routes(app, env, {
    eventRepo,
    alertRepo,
    execLogRepo,
    llmAttemptRepo,
  });

  // US2: Daily Digests
  setupUS2Routes(app, env, {
    eventRepo,
    digestRepo,
    execLogRepo,
  });
} catch (error) {
  // Log but don't crash - env vars may not be available in all contexts
  console.warn("Routes not fully configured:", error instanceof Error ? error.message : error);
}

// Error handler (must be last)
app.use(errorHandler);

export { app };
