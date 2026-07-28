// Express middleware: JSON parsing, request IDs, CORS, timing headers, cache, and error handling

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
// Credentialed browser requests (fetch credentials: "include") require
// Access-Control-Allow-Credentials: true and a concrete Allow-Origin
// (not *). Frontend premium/settlement calls use credentials: "include".
export function corsMiddleware(allowedOrigin: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Request-Id, X-ChronicleAI-Signature, X-Premium-Access-Receipt",
    );
    res.setHeader("Access-Control-Max-Age", "86400");
    res.setHeader("Vary", "Origin");

    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }

    next();
  };
}

// ── Timing Header ───────────────────────────────────────
export function timingMiddleware(_req: Request, res: Response, next: NextFunction): void {
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

/**
 * P1-7: Cache-Control for public read-mostly GETs.
 * Matches path prefixes (with optional trailing segments).
 * Skips non-GET and any path that already set Cache-Control.
 */
const PUBLIC_GET_CACHE_RULES: Array<{ prefix: string; maxAge: number; swr: number }> = [
  { prefix: "/activity", maxAge: 20, swr: 60 },
  { prefix: "/alerts", maxAge: 30, swr: 120 },
  { prefix: "/digests", maxAge: 30, swr: 120 },
  { prefix: "/desk/status", maxAge: 15, swr: 60 },
  { prefix: "/desk/intents", maxAge: 15, swr: 60 },
  { prefix: "/desk/tickets", maxAge: 15, swr: 60 },
  { prefix: "/desk/capital-moves", maxAge: 15, swr: 60 },
  { prefix: "/premium/items", maxAge: 30, swr: 120 },
  { prefix: "/premium/watches", maxAge: 30, swr: 120 },
];

export function publicGetCacheMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (req.method !== "GET") {
    next();
    return;
  }

  const path = req.path;
  const rule = PUBLIC_GET_CACHE_RULES.find(
    (r) => path === r.prefix || path.startsWith(`${r.prefix}/`),
  );
  if (!rule) {
    next();
    return;
  }

  // Allow route handlers to override (e.g. payment discovery max-age=300).
  const originalJson = res.json.bind(res);
  res.json = function jsonWithCache(body: unknown) {
    if (!res.getHeader("Cache-Control")) {
      res.setHeader(
        "Cache-Control",
        `public, max-age=${rule.maxAge}, stale-while-revalidate=${rule.swr}`,
      );
    }
    return originalJson(body);
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
