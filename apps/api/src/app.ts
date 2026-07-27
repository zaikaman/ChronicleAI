import express, { type Express } from "express";
import { corsMiddleware, errorHandler, requestIdMiddleware, timingMiddleware } from "./middleware/core.ts";
import { registerRoutes, setupUS1Routes } from "./routes/index.ts";
import { loadServerEnv } from "@chronicleai/config";
import {
  createServerSupabaseClient,
  createMonitoredEventRepository,
  createPublicAlertRepository,
  createExecutionLogRepository,
  createLLMGenerationAttemptRepository,
} from "@chronicleai/db";

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

// Setup US1 routes when env is available
try {
  const env = loadServerEnv();
  const supabase = createServerSupabaseClient({
    supabaseUrl: env.supabaseUrl,
    supabaseServiceRoleKey: env.supabaseServiceRoleKey,
  });

  const deps = {
    eventRepo: createMonitoredEventRepository(supabase),
    alertRepo: createPublicAlertRepository(supabase),
    execLogRepo: createExecutionLogRepository(supabase),
    llmAttemptRepo: createLLMGenerationAttemptRepository(supabase),
  };

  setupUS1Routes(app, env, deps);
} catch (error) {
  // Log but don't crash - env vars may not be available in all contexts
  console.warn("US1 routes not fully configured:", error instanceof Error ? error.message : error);
}

// Error handler (must be last)
app.use(errorHandler);

export { app };
