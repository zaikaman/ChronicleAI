import express, { type Express } from "express";
import { corsMiddleware, errorHandler, requestIdMiddleware, timingMiddleware } from "./middleware/core.ts";
import { registerRoutes } from "./routes/index.ts";

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

// Error handler (must be last)
app.use(errorHandler);

export { app };
