// Express middleware: KeeperHub webhook signature verification

import { timingSafeEqual } from "node:crypto";
import type { WebhookAuthMetadata } from "@chronicleai/schemas";
import type { NextFunction, Request, Response } from "express";
import { unauthorized } from "../errors.ts";

// Augment Express Request to include verified webhook metadata
declare module "express" {
  interface Request {
    webhookAuth?: WebhookAuthMetadata;
  }
}

/**
 * Creates middleware that validates X-ChronicleAI-Signature header
 * using constant-time comparison against the configured secret.
 */
export function keeperhubSignatureMiddleware(secret: string) {
  if (!secret || secret.length < 16) {
    console.warn(
      "KeeperHub signature secret is too short or missing - signature validation will fail",
    );
  }

  return (req: Request, res: Response, next: NextFunction): void => {
    const signature = req.headers["x-chronicleai-signature"];

    if (!signature || typeof signature !== "string") {
      next(unauthorized("Missing X-ChronicleAI-Signature header"));
      return;
    }

    const isValid = verifySignature(signature, secret);

    if (!isValid) {
      next(unauthorized("Invalid webhook signature"));
      return;
    }

    req.webhookAuth = {
      signature,
      verified: true,
      timestamp: new Date().toISOString(),
    };

    next();
  };
}

function verifySignature(signature: string, secret: string): boolean {
  try {
    // Constant-time comparison to prevent timing attacks
    const signatureBuffer = Buffer.from(signature, "utf8");
    const expectedBuffer = Buffer.from(secret, "utf8");

    if (signatureBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return timingSafeEqual(signatureBuffer, expectedBuffer);
  } catch {
    return false;
  }
}
