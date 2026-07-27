// Premium Access Receipt Service
// Issues and verifies HMAC-signed receipts after successful payment settlement.
// Receipts prove entitlement without trusting a client-supplied ?payer= identity.

import { createHmac, timingSafeEqual } from "node:crypto";

/** Default receipt lifetime: 30 days. */
export const DEFAULT_PREMIUM_ACCESS_RECEIPT_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface PremiumAccessReceiptClaims {
  /** Schema version. */
  v: 1;
  /** Payment record id that unlocked access. */
  pr: string;
  /** Premium item id this receipt is bound to. */
  pi: string;
  /** Verified payer reference when known. */
  pay?: string;
  /** Issued-at unix seconds. */
  iat: number;
  /** Expiry unix seconds. */
  exp: number;
}

export type ReceiptVerifyResult =
  | { ok: true; claims: PremiumAccessReceiptClaims }
  | { ok: false; reason: string };

function base64UrlEncode(data: string | Buffer): string {
  const buf = typeof data === "string" ? Buffer.from(data, "utf8") : data;
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecodeToString(input: string): string {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (padded.length % 4)) % 4;
  return Buffer.from(padded + "=".repeat(padLen), "base64").toString("utf8");
}

function base64UrlDecodeToBuffer(input: string): Buffer {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (padded.length % 4)) % 4;
  return Buffer.from(padded + "=".repeat(padLen), "base64");
}

/**
 * Server-side HMAC-SHA256 receipts for premium content access.
 *
 * Token format: `<base64url(payloadJson)>.<base64url(hmac)>`
 */
export class PremiumAccessReceiptService {
  private readonly secret: string;
  private readonly ttlSeconds: number;

  constructor(params: { secret: string; ttlSeconds?: number }) {
    if (!params.secret || params.secret.length < 16) {
      throw new Error("Premium access receipt secret must be at least 16 characters");
    }
    this.secret = params.secret;
    this.ttlSeconds = params.ttlSeconds ?? DEFAULT_PREMIUM_ACCESS_RECEIPT_TTL_SECONDS;
  }

  /**
   * Issue a signed receipt after a verified settlement.
   */
  issue(params: {
    paymentRecordId: string;
    premiumItemId: string;
    payerReference?: string | null;
    nowSeconds?: number;
  }): { token: string; expiresAt: string; claims: PremiumAccessReceiptClaims } {
    const now = params.nowSeconds ?? Math.floor(Date.now() / 1000);
    const claims: PremiumAccessReceiptClaims = {
      v: 1,
      pr: params.paymentRecordId,
      pi: params.premiumItemId,
      iat: now,
      exp: now + this.ttlSeconds,
    };
    if (params.payerReference) {
      claims.pay = params.payerReference;
    }

    const payload = base64UrlEncode(JSON.stringify(claims));
    const sig = base64UrlEncode(this.sign(payload));
    return {
      token: `${payload}.${sig}`,
      expiresAt: new Date(claims.exp * 1000).toISOString(),
      claims,
    };
  }

  /**
   * Verify signature, structure, and expiry. Does not check DB settlement status.
   */
  verify(token: string, params?: { nowSeconds?: number }): ReceiptVerifyResult {
    if (!token || typeof token !== "string") {
      return { ok: false, reason: "missing receipt" };
    }

    const parts = token.trim().split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      return { ok: false, reason: "malformed receipt" };
    }

    const [payloadB64, sigB64] = parts;
    const expectedSig = this.sign(payloadB64);
    let providedSig: Buffer;
    try {
      providedSig = base64UrlDecodeToBuffer(sigB64);
    } catch {
      return { ok: false, reason: "invalid receipt signature encoding" };
    }

    if (providedSig.length !== expectedSig.length || !timingSafeEqual(providedSig, expectedSig)) {
      return { ok: false, reason: "invalid receipt signature" };
    }

    let claims: PremiumAccessReceiptClaims;
    try {
      claims = JSON.parse(base64UrlDecodeToString(payloadB64)) as PremiumAccessReceiptClaims;
    } catch {
      return { ok: false, reason: "invalid receipt payload" };
    }

    if (claims.v !== 1 || typeof claims.pr !== "string" || typeof claims.pi !== "string") {
      return { ok: false, reason: "unsupported or incomplete receipt claims" };
    }
    if (typeof claims.iat !== "number" || typeof claims.exp !== "number") {
      return { ok: false, reason: "invalid receipt timestamps" };
    }

    const now = params?.nowSeconds ?? Math.floor(Date.now() / 1000);
    if (claims.exp < now) {
      return { ok: false, reason: "receipt expired" };
    }
    if (claims.iat > now + 60) {
      return { ok: false, reason: "receipt not yet valid" };
    }

    return { ok: true, claims };
  }

  private sign(payloadB64: string): Buffer {
    return createHmac("sha256", this.secret).update(payloadB64, "utf8").digest();
  }
}

/**
 * Resolve the signing secret. Prefers dedicated PREMIUM_ACCESS_SECRET;
 * falls back to KEEPERHUB_WEBHOOK_SECRET (already required server-side).
 */
export function resolvePremiumAccessSecret(env: {
  premiumAccessSecret?: string | undefined;
  keeperhubWebhookSecret: string;
}): string {
  const dedicated = env.premiumAccessSecret?.trim();
  if (dedicated && dedicated.length >= 16) {
    return dedicated;
  }
  return env.keeperhubWebhookSecret;
}

/**
 * Extract an access receipt from request sources (Authorization Bearer,
 * X-Premium-Access-Receipt header, or ?receipt= query).
 */
export function extractAccessReceiptFromRequest(params: {
  authorizationHeader?: string | undefined;
  receiptHeader?: string | string[] | undefined;
  receiptQuery?: string | string[] | undefined;
  cookieHeader?: string | undefined;
  premiumItemId?: string | undefined;
}): string | undefined {
  const auth = params.authorizationHeader?.trim();
  if (auth?.toLowerCase().startsWith("bearer ")) {
    const token = auth.slice(7).trim();
    if (token) return token;
  }

  const header = params.receiptHeader;
  if (typeof header === "string" && header.trim()) {
    return header.trim();
  }
  if (Array.isArray(header) && typeof header[0] === "string" && header[0].trim()) {
    return header[0].trim();
  }

  const query = params.receiptQuery;
  if (typeof query === "string" && query.trim()) {
    return query.trim();
  }
  if (Array.isArray(query) && typeof query[0] === "string" && query[0].trim()) {
    return query[0].trim();
  }

  // Optional HttpOnly cookie: chronicle_premium_receipt=<token>
  // or item-scoped chronicle_premium_receipt_<itemId>=<token>
  if (params.cookieHeader) {
    const cookies = parseCookieHeader(params.cookieHeader);
    if (params.premiumItemId) {
      const scoped = cookies[`chronicle_premium_receipt_${params.premiumItemId}`];
      if (scoped) return scoped;
    }
    const generic = cookies["chronicle_premium_receipt"];
    if (generic) return generic;
  }

  return undefined;
}

function parseCookieHeader(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key && value) {
      out[key] = decodeURIComponent(value);
    }
  }
  return out;
}

/**
 * Build Set-Cookie value for a premium access receipt (HttpOnly).
 * Cross-origin SPAs still need Authorization Bearer; cookies help same-site callers.
 */
export function buildPremiumAccessReceiptCookie(params: {
  token: string;
  premiumItemId: string;
  maxAgeSeconds: number;
  secure: boolean;
}): string {
  const name = `chronicle_premium_receipt_${params.premiumItemId}`;
  const parts = [
    `${name}=${encodeURIComponent(params.token)}`,
    "Path=/",
    "HttpOnly",
    `Max-Age=${Math.max(0, Math.floor(params.maxAgeSeconds))}`,
    params.secure ? "Secure" : "",
    // Lax works for same-site; cross-origin APIs should prefer Authorization.
    "SameSite=Lax",
  ].filter(Boolean);
  return parts.join("; ");
}
