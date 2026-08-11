// Express middleware: KeeperHub webhook signature verification

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { WebhookAuthMetadata } from "@chronicleai/schemas";
import type { NextFunction, Request, Response } from "express";
import { unauthorized } from "../errors.ts";

// Augment Express Request to include verified webhook metadata and the exact
// request bytes captured before express.json parses them.
declare module "express" {
  interface Request {
    webhookAuth?: WebhookAuthMetadata;
    rawBody?: Buffer;
  }
}

const SIGNATURE_HEADER = "x-chronicleai-signature";
const TIMESTAMP_HEADER = "x-chronicleai-timestamp";
const NONCE_HEADER = "x-chronicleai-nonce";
const REPLAY_WINDOW_SECONDS = 5 * 60;
const MAX_REPLAY_CACHE_ENTRIES = 50_000;

// This cache is intentionally shared by every middleware instance in this
// process. The same secret protects several route mounts, so a nonce accepted
// on one mount must not be accepted again on another mount.
const consumedNonces = new Map<string, number>();
const verifiedRequests = new WeakMap<
  Request,
  { secret: string; signature: string; timestamp: number; nonce: string }
>();

/**
 * Creates middleware that validates a replay-resistant KeeperHub request.
 *
 * The signer must send these headers:
 * - X-ChronicleAI-Timestamp: Unix time in seconds
 * - X-ChronicleAI-Nonce: a unique, non-empty request nonce
 * - X-ChronicleAI-Signature: hex(HMAC-SHA256(secret, signing string))
 *
 * The signing string is:
 *   METHOD\nPATH_WITH_QUERY\nSHA256(raw body)\nTIMESTAMP\nNONCE
 */
export function keeperhubSignatureMiddleware(secret: string) {
  if (!secret || secret.length < 16) {
    console.warn(
      "KeeperHub signature secret is too short or missing - signature validation will fail",
    );
  }

  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!secret || secret.length < 16) {
      next(unauthorized("KeeperHub signature authentication is not configured"));
      return;
    }

    const signature = getSingleHeader(req.headers[SIGNATURE_HEADER]);
    const timestampHeader = getSingleHeader(req.headers[TIMESTAMP_HEADER]);
    const nonce = getSingleHeader(req.headers[NONCE_HEADER]);

    if (!signature || !timestampHeader || !nonce) {
      next(
        unauthorized(
          "Missing KeeperHub signature headers (X-ChronicleAI-Signature, X-ChronicleAI-Timestamp, X-ChronicleAI-Nonce)",
        ),
      );
      return;
    }

    const timestamp = parseTimestamp(timestampHeader);
    if (timestamp === null) {
      next(unauthorized("Invalid KeeperHub signature timestamp"));
      return;
    }

    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - timestamp) > REPLAY_WINDOW_SECONDS) {
      next(unauthorized("Expired KeeperHub signature"));
      return;
    }

    if (!isValidNonce(nonce)) {
      next(unauthorized("Invalid KeeperHub signature nonce"));
      return;
    }

    // setupUS1..US4 currently mount several path-scoped instances of this
    // middleware on the same Express request. Only the first instance should
    // consume the nonce; later instances must recognize that same request as
    // already verified without weakening replay protection across requests.
    const priorVerification = verifiedRequests.get(req);
    if (
      priorVerification?.secret === secret &&
      priorVerification.signature === signature &&
      priorVerification.timestamp === timestamp &&
      priorVerification.nonce === nonce
    ) {
      next();
      return;
    }

    const expectedSignature = computeKeeperhubSignature({
      secret,
      method: req.method,
      path: req.originalUrl,
      body: getRequestBody(req),
      timestamp,
      nonce,
    });

    if (!verifySignature(signature, expectedSignature)) {
      next(unauthorized("Invalid webhook signature"));
      return;
    }

    pruneReplayCache(now);
    if (consumedNonces.has(nonce)) {
      next(unauthorized("Replayed KeeperHub signature"));
      return;
    }
    consumedNonces.set(nonce, timestamp);
    enforceReplayCacheLimit();
    verifiedRequests.set(req, { secret, signature, timestamp, nonce });

    req.webhookAuth = {
      signature,
      verified: true,
      timestamp: new Date(timestamp * 1000).toISOString(),
    };

    next();
  };
}

/**
 * Authenticator for the Marketplace HTTP action.
 *
 * Direct bridge callers should use the replay-resistant HMAC headers above.
 * KeeperHub's HTTP Request node can store a secret header but cannot access
 * Node's HMAC primitives, so Marketplace copies use a dedicated bearer token
 * stored in the private workflow configuration. The token is never accepted
 * by the internal scheduled-webhook routes.
 */
export function keeperhubMarketplaceAuthMiddleware(secret: string) {
  const hmacMiddleware = keeperhubSignatureMiddleware(secret);
  return (req: Request, res: Response, next: NextFunction): void => {
    const authorization = getSingleHeader(req.headers.authorization);
    if (secret && authorization === `Bearer ${secret}`) {
      req.webhookAuth = {
        signature: "marketplace-bearer",
        verified: true,
        timestamp: new Date().toISOString(),
      };
      next();
      return;
    }
    hmacMiddleware(req, res, next);
  };
}

export interface KeeperhubSignatureInput {
  secret: string;
  method: string;
  path: string;
  body: Buffer | string;
  timestamp: number;
  nonce: string;
}

/** Creates the hex HMAC used by X-ChronicleAI-Signature. */
export function computeKeeperhubSignature({
  secret,
  method,
  path,
  body,
  timestamp,
  nonce,
}: KeeperhubSignatureInput): string {
  const bodyDigest = createHash("sha256").update(body).digest("hex");
  const signingString = [
    method.toUpperCase(),
    path,
    bodyDigest,
    String(timestamp),
    nonce,
  ].join("\n");

  return createHmac("sha256", secret).update(signingString).digest("hex");
}

function getSingleHeader(value: string | string[] | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function parseTimestamp(value: string): number | null {
  if (!/^\d{1,12}$/.test(value)) {
    return null;
  }

  const timestamp = Number(value);
  return Number.isSafeInteger(timestamp) && timestamp > 0 ? timestamp : null;
}

function isValidNonce(nonce: string): boolean {
  return /^[A-Za-z0-9._~-]{16,128}$/.test(nonce);
}

function getRequestBody(req: Request): Buffer {
  if (req.rawBody) {
    return req.rawBody;
  }

  if (req.body === undefined || req.body === null) {
    return Buffer.alloc(0);
  }

  if (Buffer.isBuffer(req.body)) {
    return req.body;
  }

  return Buffer.from(JSON.stringify(req.body), "utf8");
}

function pruneReplayCache(now: number): void {
  for (const [nonce, timestamp] of consumedNonces) {
    if (now - timestamp > REPLAY_WINDOW_SECONDS) {
      consumedNonces.delete(nonce);
    }
  }
}

function enforceReplayCacheLimit(): void {
  while (consumedNonces.size > MAX_REPLAY_CACHE_ENTRIES) {
    const oldestNonce = consumedNonces.keys().next().value;
    if (oldestNonce === undefined) {
      return;
    }
    consumedNonces.delete(oldestNonce);
  }
}

function verifySignature(signature: string, expectedSignature: string): boolean {
  try {
    if (!/^[0-9a-f]{64}$/.test(signature)) {
      return false;
    }

    const signatureBuffer = Buffer.from(signature, "hex");
    const expectedBuffer = Buffer.from(expectedSignature, "hex");

    return (
      signatureBuffer.length === expectedBuffer.length &&
      timingSafeEqual(signatureBuffer, expectedBuffer)
    );
  } catch {
    return false;
  }
}
