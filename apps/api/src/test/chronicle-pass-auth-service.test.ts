// Tests for Chronicle Pass wallet auth: challenge issuance, signature
// verification, single-use nonces, session resolution, and logout.

import { type ChroniclePassSessionRow, hashSessionToken } from "@chronicleai/db";
import type { ChroniclePassSessionRepository } from "@chronicleai/db";
import { privateKeyToAccount } from "viem/accounts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHRONICLE_PASS_SESSION_COOKIE,
  ChroniclePassAuthService,
  buildChroniclePassSessionClearCookie,
  buildChroniclePassSessionCookie,
} from "../services/chronicle-pass-auth-service.ts";

const CHAIN_ID = 84_532;

function makeRow(overrides: Partial<ChroniclePassSessionRow> = {}): ChroniclePassSessionRow {
  return {
    id: "sess-1",
    wallet_address: "0xabc0000000000000000000000000000000000001",
    nonce: "nonce-1",
    chain_id: CHAIN_ID,
    status: "challenge_issued",
    message: "",
    issued_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    session_token_hash: null,
    session_expires_at: null,
    user_agent: null,
    ip_address: null,
    last_seen_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function buildSessionRepo(): {
  repo: ChroniclePassSessionRepository;
  calls: {
    created: ChroniclePassSessionRow[];
    activated: { id: string; sessionTokenHash: string; sessionExpiresAt: string }[];
    expired: string[];
    revoked: string[];
  };
} {
  const calls = {
    created: [] as ChroniclePassSessionRow[],
    activated: [] as { id: string; sessionTokenHash: string; sessionExpiresAt: string }[],
    expired: [] as string[],
    revoked: [] as string[],
  };
  const repo = {
    createChallenge: vi.fn(async (input: ChroniclePassSessionRow) => {
      const row = makeRow(input as unknown as Partial<ChroniclePassSessionRow>);
      calls.created.push(row);
      return { ok: true as const, value: row };
    }),
    findByNonce: vi.fn(),
    findBySessionTokenHash: vi.fn(),
    activate: vi.fn(
      async (id: string, update: { sessionTokenHash: string; sessionExpiresAt: string }) => {
        calls.activated.push({ id, ...update });
        return { ok: true as const, value: makeRow({ id, status: "active", ...update }) };
      },
    ),
    markExpired: vi.fn(async (id: string) => {
      calls.expired.push(id);
      return { ok: true as const, value: makeRow({ id, status: "expired" }) };
    }),
    revoke: vi.fn(async (id: string) => {
      calls.revoked.push(id);
      return { ok: true as const, value: makeRow({ id, status: "revoked" }) };
    }),
    touch: vi.fn(async () => ({ ok: true as const, value: makeRow() })),
    expireSweep: vi.fn(async () => ({ ok: true as const, value: 0 })),
  } as unknown as ChroniclePassSessionRepository;
  return { repo, calls };
}

function buildService(repo: ChroniclePassSessionRepository): ChroniclePassAuthService {
  return new ChroniclePassAuthService({
    sessionRepo: repo,
    config: { chainId: CHAIN_ID, serviceName: "TestPass" },
  });
}

describe("ChroniclePassAuthService", () => {
  let ctx: ReturnType<typeof buildSessionRepo>;
  let account: ReturnType<typeof privateKeyToAccount>;
  let otherAccount: ReturnType<typeof privateKeyToAccount>;
  let service: ChroniclePassAuthService;

  beforeEach(() => {
    ctx = buildSessionRepo();
    account = privateKeyToAccount(`0x${"11".repeat(32)}`);
    otherAccount = privateKeyToAccount(`0x${"22".repeat(32)}`);
    service = buildService(ctx.repo);
  });

  describe("createChallenge", () => {
    it("issues a challenge message embedding wallet, nonce, issue time, expiry, and chain", async () => {
      const challenge = await service.createChallenge({ wallet: account.address });

      expect(challenge.nonce).toBeTruthy();
      expect(challenge.ttlSeconds).toBe(300);
      expect(challenge.chainId).toBe(CHAIN_ID);
      expect(challenge.message).toContain(account.address.toLowerCase());
      expect(challenge.message).toContain(challenge.nonce);
      expect(challenge.message).toContain(challenge.issuedAt);
      expect(challenge.message).toContain(challenge.expiresAt);
      expect(challenge.message).toContain(String(CHAIN_ID));
      expect(ctx.calls.created.length).toBe(1);
      expect(ctx.calls.created[0]?.wallet_address).toBe(account.address.toLowerCase());
    });

    it("rejects a non-EVM wallet", async () => {
      await expect(service.createChallenge({ wallet: "not-a-wallet" })).rejects.toMatchObject({
        statusCode: 400,
      });
    });
  });

  describe("verifyChallenge", () => {
    it("activates a session for a valid signature and returns a bearer token", async () => {
      const challenge = await service.createChallenge({ wallet: account.address });
      ctx.repo.findByNonce = vi.fn().mockResolvedValue({
        ok: true as const,
        value: makeRow({
          wallet_address: account.address.toLowerCase(),
          nonce: challenge.nonce,
          message: challenge.message,
          expires_at: challenge.expiresAt,
        }),
      });

      const signature = await account.signMessage({ message: challenge.message });
      const session = await service.verifyChallenge({
        wallet: account.address,
        nonce: challenge.nonce,
        message: challenge.message,
        signature,
      });

      expect(session.wallet).toBe(account.address.toLowerCase());
      expect(session.token).toBeTruthy();
      expect(ctx.calls.activated.length).toBe(1);
      expect(ctx.calls.activated[0]?.sessionTokenHash).toBe(hashSessionToken(session.token));
    });

    it("rejects a signature from the wrong wallet", async () => {
      const challenge = await service.createChallenge({ wallet: account.address });
      ctx.repo.findByNonce = vi.fn().mockResolvedValue({
        ok: true as const,
        value: makeRow({
          wallet_address: account.address.toLowerCase(),
          nonce: challenge.nonce,
          message: challenge.message,
          expires_at: challenge.expiresAt,
        }),
      });

      const signature = await otherAccount.signMessage({ message: challenge.message });
      await expect(
        service.verifyChallenge({
          wallet: account.address,
          nonce: challenge.nonce,
          message: challenge.message,
          signature,
        }),
      ).rejects.toMatchObject({ statusCode: 401 });
    });

    it("rejects a malformed signature", async () => {
      const challenge = await service.createChallenge({ wallet: account.address });
      ctx.repo.findByNonce = vi.fn().mockResolvedValue({
        ok: true as const,
        value: makeRow({
          wallet_address: account.address.toLowerCase(),
          nonce: challenge.nonce,
          message: challenge.message,
          expires_at: challenge.expiresAt,
        }),
      });

      await expect(
        service.verifyChallenge({
          wallet: account.address,
          nonce: challenge.nonce,
          message: challenge.message,
          signature: "0xdeadbeef",
        }),
      ).rejects.toMatchObject({ statusCode: 401 });
    });

    it("rejects an expired challenge", async () => {
      const challenge = await service.createChallenge({ wallet: account.address });
      ctx.repo.findByNonce = vi.fn().mockResolvedValue({
        ok: true as const,
        value: makeRow({
          wallet_address: account.address.toLowerCase(),
          nonce: challenge.nonce,
          message: challenge.message,
          expires_at: new Date(Date.now() - 60_000).toISOString(),
        }),
      });

      const signature = await account.signMessage({ message: challenge.message });
      await expect(
        service.verifyChallenge({
          wallet: account.address,
          nonce: challenge.nonce,
          message: challenge.message,
          signature,
        }),
      ).rejects.toMatchObject({ statusCode: 401 });
      expect(ctx.calls.expired).toContain("sess-1");
    });

    it("rejects a replayed nonce (already consumed)", async () => {
      const challenge = await service.createChallenge({ wallet: account.address });
      ctx.repo.findByNonce = vi.fn().mockResolvedValue({
        ok: true as const,
        value: makeRow({
          wallet_address: account.address.toLowerCase(),
          nonce: challenge.nonce,
          message: challenge.message,
          expires_at: challenge.expiresAt,
          status: "active",
        }),
      });

      const signature = await account.signMessage({ message: challenge.message });
      await expect(
        service.verifyChallenge({
          wallet: account.address,
          nonce: challenge.nonce,
          message: challenge.message,
          signature,
        }),
      ).rejects.toMatchObject({ statusCode: 401 });
      expect(ctx.calls.activated.length).toBe(0);
    });

    it("rejects when the signed message does not match the issued one", async () => {
      const challenge = await service.createChallenge({ wallet: account.address });
      ctx.repo.findByNonce = vi.fn().mockResolvedValue({
        ok: true as const,
        value: makeRow({
          wallet_address: account.address.toLowerCase(),
          nonce: challenge.nonce,
          message: challenge.message,
          expires_at: challenge.expiresAt,
        }),
      });

      const tampered = `${challenge.message}\nTampered: true`;
      const signature = await account.signMessage({ message: tampered });
      await expect(
        service.verifyChallenge({
          wallet: account.address,
          nonce: challenge.nonce,
          message: tampered,
          signature,
        }),
      ).rejects.toMatchObject({ statusCode: 401 });
    });
  });

  describe("session cookie attributes", () => {
    it("uses SameSite=Lax (no Secure) for same-site local development", () => {
      const cookie = buildChroniclePassSessionCookie({
        token: "tok",
        maxAgeSeconds: 3600,
        secure: false,
        sameSite: "lax",
      });
      expect(cookie).toContain(`${CHRONICLE_PASS_SESSION_COOKIE}=tok`);
      expect(cookie).toContain("Path=/");
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("SameSite=Lax");
      expect(cookie).not.toContain("Secure");
      expect(cookie).not.toContain("SameSite=None");
    });

    it("uses SameSite=None; Secure for cross-site production (web on Vercel, API on Heroku)", () => {
      const cookie = buildChroniclePassSessionCookie({
        token: "tok",
        maxAgeSeconds: 3600,
        secure: true,
        sameSite: "none",
      });
      expect(cookie).toContain("SameSite=None");
      expect(cookie).toContain("Secure");
      expect(cookie).toContain("HttpOnly");
      expect(cookie).not.toContain("SameSite=Lax");
    });

    it("forces Secure whenever SameSite=None (browser requirement)", () => {
      const cookie = buildChroniclePassSessionCookie({
        token: "tok",
        maxAgeSeconds: 3600,
        secure: false,
        sameSite: "none",
      });
      expect(cookie).toContain("SameSite=None");
      expect(cookie).toContain("Secure");
    });

    it("clears the cookie with matching attributes", () => {
      const clear = buildChroniclePassSessionClearCookie(true, "none");
      expect(clear).toContain(`${CHRONICLE_PASS_SESSION_COOKIE}=`);
      expect(clear).toContain("Max-Age=0");
      expect(clear).toContain("SameSite=None");
      expect(clear).toContain("Secure");
    });
  });

  describe("resolveSession / logout", () => {
    it("resolves an active session from the cookie header", async () => {
      const token = "abcdef123456";
      const activeRow = makeRow({
        status: "active",
        wallet_address: account.address.toLowerCase(),
        session_token_hash: hashSessionToken(token),
        session_expires_at: new Date(Date.now() + 60_000).toISOString(),
      });
      ctx.repo.findBySessionTokenHash = vi
        .fn()
        .mockResolvedValue({ ok: true as const, value: activeRow });

      const session = await service.resolveSession(
        `${CHRONICLE_PASS_SESSION_COOKIE}=${token}; other=1`,
      );
      expect(session?.wallet).toBe(account.address.toLowerCase());
    });

    it("returns null for an unknown or expired token", async () => {
      ctx.repo.findBySessionTokenHash = vi
        .fn()
        .mockResolvedValue({ ok: true as const, value: null });
      expect(await service.resolveSession(`${CHRONICLE_PASS_SESSION_COOKIE}=zzz`)).toBeNull();

      const expired = makeRow({
        status: "active",
        session_token_hash: hashSessionToken("tok"),
        session_expires_at: new Date(Date.now() - 60_000).toISOString(),
      });
      ctx.repo.findBySessionTokenHash = vi
        .fn()
        .mockResolvedValue({ ok: true as const, value: expired });
      expect(await service.resolveSession(`${CHRONICLE_PASS_SESSION_COOKIE}=tok`)).toBeNull();
      expect(ctx.calls.expired).toContain(expired.id);
    });

    it("revokes the session on logout", async () => {
      const token = "logout-token";
      const activeRow = makeRow({
        status: "active",
        wallet_address: account.address.toLowerCase(),
        session_token_hash: hashSessionToken(token),
        session_expires_at: new Date(Date.now() + 60_000).toISOString(),
      });
      ctx.repo.findBySessionTokenHash = vi
        .fn()
        .mockResolvedValue({ ok: true as const, value: activeRow });

      await service.logout(`${CHRONICLE_PASS_SESSION_COOKIE}=${token}`);
      expect(ctx.calls.revoked).toContain(activeRow.id);
    });
  });
});
