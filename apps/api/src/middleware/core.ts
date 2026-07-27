// Express middleware: JSON parsing, request IDs, CORS, timing headers, and error handling

import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../errors.ts";

// ── Request ID ──────────────────────────────────────────
export function requestIdMiddleware(req: Request, _res: Response, next: NextFunction): void {
  req.headers["x-request-id"] = req.headers["x-request-id"] || randomUUID();
  next();
}

export function getRequestId(req: Request): string {
  return (req.headers["x-request-id"] as string) || "unknown";
}

// ── CORS ────────────────────────────────────────────────
export function corsMiddleware(allowedOrigin: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Request-Id, X-ChronicleAI-Signature",
    );
    res.setHeader("Access-Control-Max-Age", "86400");

    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }

    next();
  };
}

// ── Timing Header ───────────────────────────────────────
export function timingMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  // Set header early so it's captured before response is sent
  const originalEnd = res.end.bind(res);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  res.end = function end(...args: any[]) {
    const duration = Date.now() - start;
    res.setHeader("X-Response-Time", `${duration}ms`);
    return originalEnd(...args);
  };

  next();
}

// ── Final Error Handler ─────────────────────────────────
export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ApiError) {
    res.status(err.statusCode).json({
      error: err.publicMessage,
      ...(err.details ? { details: err.details } : {}),
    });
    return;
  }

  // Unexpected errors - don't leak internals
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
}
