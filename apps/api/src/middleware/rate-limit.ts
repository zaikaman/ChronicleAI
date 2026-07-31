/**
 * P2-3: In-process sliding-window rate limits for public + LLM-adjacent routes.
 * Per-IP (or X-Forwarded-For first hop). Suitable for single-dyno; multi-dyno
 * needs Redis/shared store later.
 */

import type { NextFunction, Request, Response } from "express";
import { rateLimitLog } from "../lib/logger.ts";

export interface RateLimitOptions {
  /** Window length in ms. */
  windowMs: number;
  /** Max requests per window per key. */
  max: number;
  /** Namespace for the key (e.g. "public", "llm"). */
  name?: string;
  /** Skip rate limiting for this request. */
  skip?: (req: Request) => boolean;
}

type Bucket = {
  count: number;
  resetAt: number;
};

const stores = new Map<string, Map<string, Bucket>>();

function clientKey(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0]?.trim() || "unknown";
  }
  if (Array.isArray(forwarded) && forwarded[0]) {
    return forwarded[0].split(",")[0]?.trim() || "unknown";
  }
  return req.ip || req.socket?.remoteAddress || "unknown";
}

function getStore(name: string): Map<string, Bucket> {
  let store = stores.get(name);
  if (!store) {
    store = new Map();
    stores.set(name, store);
  }
  return store;
}

/** Periodically drop expired buckets to bound memory. */
function sweep(store: Map<string, Bucket>, now: number): void {
  if (store.size < 2_000) return;
  for (const [key, bucket] of store) {
    if (bucket.resetAt <= now) store.delete(key);
  }
}

/**
 * Create Express middleware that rate-limits by client IP.
 * Responds 429 with Retry-After when exceeded.
 */
export function rateLimitMiddleware(options: RateLimitOptions) {
  const name = options.name ?? "default";
  const store = getStore(name);
  const windowMs = Math.max(1_000, options.windowMs);
  const max = Math.max(1, options.max);

  return (req: Request, res: Response, next: NextFunction): void => {
    if (options.skip?.(req)) {
      next();
      return;
    }

    const now = Date.now();
    const key = clientKey(req);
    sweep(store, now);

    let bucket = store.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      store.set(key, bucket);
    }

    bucket.count += 1;

    const remaining = Math.max(0, max - bucket.count);
    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(remaining));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > max) {
      const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfterSec));
      rateLimitLog.warn("rate limit exceeded", {
        name,
        key,
        count: bucket.count,
        max,
        path: req.path,
      });
      res.status(429).json({
        error: "Too many requests",
        retryAfterSeconds: retryAfterSec,
      });
      return;
    }

    next();
  };
}

/**
 * Path-based limiter: public GETs get a generous cap; LLM-adjacent POSTs tighter.
 * KeeperHub-signed webhooks are skipped (authenticated via signature middleware later).
 */
export function publicAndLlmRateLimitMiddleware() {
  const publicLimiter = rateLimitMiddleware({
    name: "public",
    windowMs: 60_000,
    max: 180,
  });

  const llmLimiter = rateLimitMiddleware({
    name: "llm",
    windowMs: 60_000,
    max: 20,
  });

  const writeLimiter = rateLimitMiddleware({
    name: "write",
    windowMs: 60_000,
    max: 60,
  });

  const LLM_PATH_PREFIXES = [
    "/affiliates/agent",
    "/keeperhub/desk/agent-tick",
    "/keeperhub/desk/tick",
    "/keeperhub/digests/run",
    "/keeperhub/events",
    "/keeperhub/blocks",
  ];

  const WRITE_PATH_PREFIXES = [
    "/subscribers",
    "/payments",
    "/affiliates",
    "/premium",
  ];

  return (req: Request, res: Response, next: NextFunction): void => {
    // Browser preflight requests are transport negotiation, not API work.
    // They must never consume an LLM quota or be rejected with a rate-limit
    // response before the CORS middleware can complete the preflight.
    if (req.method === "OPTIONS") {
      next();
      return;
    }

    // Health checks never rate-limited
    if (req.path === "/health" || req.path === "/") {
      next();
      return;
    }

    // Signature-gated keeperhub routes still get a generous write limit
    // (protects misconfigured scrapers; real load is authenticated).
    if (LLM_PATH_PREFIXES.some((p) => req.path === p || req.path.startsWith(`${p}/`))) {
      llmLimiter(req, res, next);
      return;
    }

    if (
      req.method !== "GET" &&
      req.method !== "HEAD" &&
      req.method !== "OPTIONS" &&
      WRITE_PATH_PREFIXES.some((p) => req.path === p || req.path.startsWith(`${p}/`))
    ) {
      writeLimiter(req, res, next);
      return;
    }

    publicLimiter(req, res, next);
  };
}

/** Test helper: clear all in-memory buckets. */
export function resetRateLimitStores(): void {
  for (const store of stores.values()) {
    store.clear();
  }
}
