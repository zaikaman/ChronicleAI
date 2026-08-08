// Chronicle Pass wallet-authenticated session service.
//
// Flow: POST /subscriptions/auth/challenge issues a short-lived signed-message
// challenge (wallet, nonce, issue time, expiry, chain). POST /subscriptions/auth/verify
// verifies the EIP-191 signature and activates a session whose bearer token is
// delivered as an HttpOnly cookie (only its SHA-256 hash is persisted).

import { randomBytes } from "node:crypto";
import {
  CHRONICLE_PASS_CHALLENGE_TTL_SECONDS,
  CHRONICLE_PASS_SESSION_TTL_SECONDS,
  type ChroniclePassSessionRepository,
  hashSessionToken,
  normalizeWalletAddress,
} from "@chronicleai/db";
import type {
  SubscriptionAuthChallengeResponse,
  SubscriptionSessionResponse,
} from "@chronicleai/schemas";
import { verifyMessage } from "viem";
import { badRequest, unauthorized } from "../errors.ts";

/** HttpOnly cookie name carrying the raw bearer session token. */
export const CHRONICLE_PASS_SESSION_COOKIE = "chronicle_pass_session";

const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export interface ChroniclePassAuthConfig {
  /** Chain context embedded in the challenge message (x402 payment rail). */
  chainId: number;
  /** Service name rendered into the sign-in message. */
  serviceName?: string;
  /** Challenge lifetime in seconds (short-lived). */
  challengeTtlSeconds?: number;
  /** Active session lifetime in seconds. */
  sessionTtlSeconds?: number;
}

export interface ChroniclePassSession {
  wallet: string;
  expiresAt: string;
}

export class ChroniclePassAuthService {
  private readonly sessionRepo: ChroniclePassSessionRepository;
  private readonly config: Required<ChroniclePassAuthConfig>;

  constructor(params: {
    sessionRepo: ChroniclePassSessionRepository;
    config: ChroniclePassAuthConfig;
  }) {
    this.sessionRepo = params.sessionRepo;
    this.config = {
      chainId: params.config.chainId,
      serviceName: params.config.serviceName ?? "ChronicleAI Chronicle Pass",
      challengeTtlSeconds:
        params.config.challengeTtlSeconds ?? CHRONICLE_PASS_CHALLENGE_TTL_SECONDS,
      sessionTtlSeconds: params.config.sessionTtlSeconds ?? CHRONICLE_PASS_SESSION_TTL_SECONDS,
    };
  }

  get sessionTtlSeconds(): number {
    return this.config.sessionTtlSeconds;
  }

  /**
   * Issue a signed-message challenge for a wallet. The message embeds the
   * wallet, nonce, issue time, expiry, and chain context. Nonce is single-use.
   */
  async createChallenge(params: {
    wallet: string;
    chainId?: number;
    userAgent?: string | undefined;
    ip?: string | undefined;
  }): Promise<SubscriptionAuthChallengeResponse> {
    const wallet = normalizeWalletAddress(params.wallet);
    if (!wallet || !EVM_ADDRESS_RE.test(wallet)) {
      throw badRequest("wallet must be a valid 0x EVM address");
    }

    const chainId = params.chainId ?? this.config.chainId;
    const now = new Date();
    const issuedAt = now;
    const expiresAt = new Date(now.getTime() + this.config.challengeTtlSeconds * 1000);
    const nonce = randomBytes(16).toString("hex");

    const message = buildSignInMessage({
      serviceName: this.config.serviceName,
      wallet,
      nonce,
      issuedAt,
      expiresAt,
      chainId,
    });

    const created = await this.sessionRepo.createChallenge({
      wallet_address: wallet,
      nonce,
      chain_id: chainId,
      message,
      issued_at: issuedAt.toISOString(),
      expires_at: expiresAt.toISOString(),
      user_agent: params.userAgent ?? null,
      ip_address: params.ip ?? null,
    });
    if (!created.ok) {
      throw badRequest(`Failed to issue challenge: ${created.error.message}`);
    }

    return {
      nonce,
      message,
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      chainId,
      ttlSeconds: this.config.challengeTtlSeconds,
    };
  }

  /**
   * Verify a challenge signature and activate a session. Rejects expired,
   * replayed (nonce already consumed), malformed, and wrong-wallet signatures.
   * Returns the raw bearer token for the HttpOnly cookie.
   */
  async verifyChallenge(params: {
    wallet: string;
    nonce: string;
    message: string;
    signature: string;
    chainId?: number;
  }): Promise<{ token: string; wallet: string; expiresAt: string }> {
    const wallet = normalizeWalletAddress(params.wallet);
    if (!wallet || !EVM_ADDRESS_RE.test(wallet)) {
      throw unauthorized("Invalid wallet address");
    }
    const nonce = params.nonce.trim();
    const signature = params.signature.trim();
    if (!nonce || !signature || !params.message.trim()) {
      throw unauthorized("nonce, message, and signature are required");
    }

    const result = await this.sessionRepo.findByNonce(nonce);
    if (!result.ok) {
      throw unauthorized("Invalid challenge");
    }
    const row = result.value;
    if (!row) {
      throw unauthorized("Unknown challenge nonce");
    }
    if (row.status !== "challenge_issued") {
      throw unauthorized("Challenge has already been used");
    }
    if (row.wallet_address.toLowerCase() !== wallet) {
      throw unauthorized("Challenge was issued for a different wallet");
    }
    if (params.chainId !== undefined && params.chainId !== row.chain_id) {
      throw unauthorized("Challenge chain context mismatch");
    }
    if (Date.now() > Date.parse(row.expires_at)) {
      await this.sessionRepo.markExpired(row.id);
      throw unauthorized("Challenge expired — request a new one");
    }
    // Exact-message binding: the signed message must be the one we issued.
    if (params.message.trim() !== row.message) {
      throw unauthorized("Signed message does not match the issued challenge");
    }

    const valid = await verifyMessage({
      address: wallet as `0x${string}`,
      message: params.message,
      signature: signature as `0x${string}`,
    }).catch(() => false);
    if (!valid) {
      throw unauthorized("Signature verification failed");
    }

    const token = randomBytes(32).toString("hex");
    const tokenHash = hashSessionToken(token);
    const sessionExpiresAt = new Date(
      Date.now() + this.config.sessionTtlSeconds * 1000,
    ).toISOString();

    // Single-use guarantee: activate only succeeds when the nonce is unconsumed.
    const activated = await this.sessionRepo.activate(row.id, {
      sessionTokenHash: tokenHash,
      sessionExpiresAt,
    });
    if (!activated.ok) {
      throw unauthorized("Failed to activate session");
    }
    if (!activated.value) {
      throw unauthorized("Challenge has already been used");
    }

    return { token, wallet, expiresAt: sessionExpiresAt };
  }

  /** Resolve an active session from a cookie header (never trusts the cookie alone). */
  async resolveSession(cookieHeader?: string | undefined): Promise<ChroniclePassSession | null> {
    const token = parseSessionCookie(cookieHeader);
    if (!token) return null;

    const result = await this.sessionRepo.findBySessionTokenHash(hashSessionToken(token));
    if (!result.ok || !result.value) return null;

    const row = result.value;
    const nowMs = Date.now();
    const expiresAt = row.session_expires_at ?? row.expires_at;
    if (nowMs > Date.parse(expiresAt)) {
      await this.sessionRepo.markExpired(row.id);
      return null;
    }
    await this.sessionRepo.touch(row.id).catch(() => {});
    return { wallet: row.wallet_address, expiresAt };
  }

  /** Destroy an active session (logout). No-op when no session exists. */
  async logout(cookieHeader?: string | undefined): Promise<void> {
    const token = parseSessionCookie(cookieHeader);
    if (!token) return;
    const result = await this.sessionRepo.findBySessionTokenHash(hashSessionToken(token));
    if (result.ok && result.value) {
      await this.sessionRepo.revoke(result.value.id);
    }
  }

  /** Best-effort expiry sweep for challenge/session rows. */
  async expireSweep(): Promise<number> {
    const result = await this.sessionRepo.expireSweep();
    if (!result.ok) return 0;
    return result.value;
  }
}

/**
 * Build the Set-Cookie value for the HttpOnly bearer session cookie.
 *
 * The web app (Vercel) and the API (Heroku) are different origins in
 * production, so the cookie must be cross-site-capable there: SameSite=None
 * (which requires Secure). Local development is same-site (localhost), where
 * SameSite=Lax is preferred and keeps the cookie out of third-party contexts.
 */
export function buildChroniclePassSessionCookie(params: {
  token: string;
  maxAgeSeconds: number;
  secure: boolean;
  /** "none" when the web origin and API origin differ (cross-site cookies). */
  sameSite?: "lax" | "none";
}): string {
  const sameSite = params.sameSite ?? "lax";
  const parts = [
    `${CHRONICLE_PASS_SESSION_COOKIE}=${encodeURIComponent(params.token)}`,
    "Path=/",
    "HttpOnly",
    `Max-Age=${Math.max(0, Math.floor(params.maxAgeSeconds))}`,
    // SameSite=None is only valid with Secure — force it whenever cross-site.
    ...(sameSite === "none" || params.secure ? ["Secure"] : []),
    `SameSite=${sameSite === "none" ? "None" : "Lax"}`,
  ];
  return parts.join("; ");
}

/** Clear the session cookie (logout). */
export function buildChroniclePassSessionClearCookie(
  secure: boolean,
  sameSite?: "lax" | "none",
): string {
  return buildChroniclePassSessionCookie({ token: "", maxAgeSeconds: 0, secure, sameSite });
}

export function toSubscriptionSessionResponse(
  session: ChroniclePassSession | null,
): SubscriptionSessionResponse {
  return {
    authenticated: session !== null,
    wallet: session?.wallet ?? null,
    expiresAt: session?.expiresAt ?? null,
  };
}

function buildSignInMessage(params: {
  serviceName: string;
  wallet: string;
  nonce: string;
  issuedAt: Date;
  expiresAt: Date;
  chainId: number;
}): string {
  return [
    `${params.serviceName} — wallet sign-in`,
    "",
    `Wallet: ${params.wallet}`,
    `Nonce: ${params.nonce}`,
    `Issued at: ${params.issuedAt.toISOString()}`,
    `Expires at: ${params.expiresAt.toISOString()}`,
    `Chain ID: ${params.chainId}`,
    "",
    "Signing this message proves you control this wallet so you can manage your Chronicle Pass subscription.",
  ].join("\n");
}

function parseSessionCookie(cookieHeader?: string | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    if (key === CHRONICLE_PASS_SESSION_COOKIE) {
      const value = part.slice(idx + 1).trim();
      return value ? decodeURIComponent(value) : null;
    }
  }
  return null;
}
