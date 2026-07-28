// CDP (Coinbase Developer Platform) Secret API Key → Bearer JWT
// Used to authenticate server-to-server calls to api.cdp.coinbase.com
// (including POST /platform/v2/x402/settle).
//
// Docs: https://docs.cdp.coinbase.com/api-reference/v2/authentication
// JWT is bound to method + host + path and expires in ~2 minutes.

import { createPrivateKey, randomBytes, type KeyObject } from "node:crypto";
import { importJWK, SignJWT, type JWK, type KeyLike } from "jose";

export interface CdpJwtParams {
  apiKeyId: string;
  apiKeySecret: string;
  /** HTTP method, e.g. POST */
  requestMethod: string;
  /** Host only, e.g. api.cdp.coinbase.com */
  requestHost: string;
  /** Path starting with /, e.g. /platform/v2/x402/settle */
  requestPath: string;
  /** Token lifetime in seconds (CDP default ~120). */
  expiresInSeconds?: number;
}

export interface CdpCredentials {
  apiKeyId: string;
  apiKeySecret: string;
}

function base64UrlFromBuffer(buf: Buffer): string {
  return buf.toString("base64url");
}

/**
 * Import a CDP secret API key for JWT signing.
 * Supports:
 * - Ed25519 (recommended): base64-encoded 64-byte seed+pubkey
 * - ES256: PEM PKCS8 / SPKI EC private key, or base64 DER PKCS8
 */
export async function importCdpSigningKey(
  apiKeySecret: string,
): Promise<{ key: KeyLike | KeyObject; alg: "EdDSA" | "ES256" }> {
  const trimmed = apiKeySecret.trim();

  // PEM EC / PKCS8 private key (legacy CDP EC keys)
  if (trimmed.includes("BEGIN") && trimmed.includes("PRIVATE KEY")) {
    const key = createPrivateKey(trimmed);
    return { key, alg: "ES256" };
  }

  // Try base64 Ed25519 (64 bytes = 32 seed + 32 public)
  try {
    const decoded = Buffer.from(trimmed, "base64");
    if (decoded.length === 64) {
      const seed = decoded.subarray(0, 32);
      const publicKey = decoded.subarray(32, 64);
      const jwk: JWK = {
        kty: "OKP",
        crv: "Ed25519",
        d: base64UrlFromBuffer(seed),
        x: base64UrlFromBuffer(publicKey),
      };
      const key = await importJWK(jwk, "EdDSA");
      // jose may type the result as Uint8Array for opaque keys; Ed25519 JWK yields a KeyLike.
      if (!key || key instanceof Uint8Array) {
        throw new Error("Failed to import CDP Ed25519 key material as a signing key");
      }
      return { key, alg: "EdDSA" };
    }

    // Base64 DER PKCS8 (EC) — some portal downloads use this
    if (decoded.length > 32) {
      try {
        const key = createPrivateKey({ key: decoded, format: "der", type: "pkcs8" });
        return { key, alg: "ES256" };
      } catch {
        // fall through
      }
    }
  } catch {
    // fall through to clearer error
  }

  throw new Error(
    "Unsupported CDP_API_KEY_SECRET format. Expected Ed25519 base64 (64-byte seed+pubkey) or EC PEM/PKCS8 from the CDP portal.",
  );
}

/**
 * Generate a short-lived CDP Bearer JWT for a specific API request.
 * The `uri` claim must match `${METHOD} ${host}${path}` exactly.
 */
export async function generateCdpBearerToken(params: CdpJwtParams): Promise<string> {
  const apiKeyId = params.apiKeyId.trim();
  const apiKeySecret = params.apiKeySecret.trim();
  if (!apiKeyId || !apiKeySecret) {
    throw new Error("CDP API key id and secret are required to generate a Bearer token");
  }

  const method = params.requestMethod.trim().toUpperCase();
  const host = params.requestHost.trim().replace(/\/$/, "");
  const path = params.requestPath.startsWith("/")
    ? params.requestPath
    : `/${params.requestPath}`;
  const uri = `${method} ${host}${path}`;
  const expiresIn = params.expiresInSeconds ?? 120;
  const now = Math.floor(Date.now() / 1000);

  const { key, alg } = await importCdpSigningKey(apiKeySecret);

  return new SignJWT({
    sub: apiKeyId,
    iss: "cdp",
    aud: ["cdp_service"],
    uri,
  })
    .setProtectedHeader({
      alg,
      typ: "JWT",
      kid: apiKeyId,
      nonce: randomBytes(16).toString("hex"),
    })
    .setNotBefore(now)
    .setExpirationTime(now + expiresIn)
    .sign(key);
}

/**
 * Build Authorization + Accept headers for a CDP (or other) facilitator request.
 * Returns only Content-Type/Accept when credentials are absent (public facilitators).
 */
export async function buildFacilitatorAuthHeaders(
  settleUrl: string,
  credentials: CdpCredentials | undefined,
  method = "POST",
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  if (!credentials?.apiKeyId?.trim() || !credentials?.apiKeySecret?.trim()) {
    return headers;
  }

  const url = new URL(settleUrl);
  const token = await generateCdpBearerToken({
    apiKeyId: credentials.apiKeyId,
    apiKeySecret: credentials.apiKeySecret,
    requestMethod: method,
    requestHost: url.host,
    requestPath: `${url.pathname}${url.search}`,
  });

  headers.Authorization = `Bearer ${token}`;
  return headers;
}

/** True when the facilitator URL targets Coinbase CDP (auth required). */
export function isCdpFacilitatorUrl(facilitatorUrl: string | undefined): boolean {
  if (!facilitatorUrl) return false;
  try {
    const host = new URL(facilitatorUrl).host.toLowerCase();
    return host === "api.cdp.coinbase.com" || host.endsWith(".cdp.coinbase.com");
  } catch {
    return facilitatorUrl.includes("api.cdp.coinbase.com");
  }
}
