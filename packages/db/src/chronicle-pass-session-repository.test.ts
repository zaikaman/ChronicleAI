import { beforeEach, describe, expect, it } from "vitest";
import { createChroniclePassSessionRepository } from "./chronicle-pass-session-repository.ts";
import { createInMemorySupabaseClient } from "./in-memory-supabase.ts";
import type { ChroniclePassSessionInsert } from "./types.ts";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function challengeInsert(
  overrides: Partial<ChroniclePassSessionInsert> = {},
): ChroniclePassSessionInsert {
  const issuedAt = new Date();
  return {
    wallet_address: "0xabc0000000000000000000000000000000000001",
    nonce: `nonce-${Math.random().toString(36).slice(2)}`,
    chain_id: 84_532,
    status: "challenge_issued",
    message: "Sign in to ChronicleAI",
    issued_at: issuedAt.toISOString(),
    expires_at: new Date(issuedAt.getTime() + CHALLENGE_TTL_MS).toISOString(),
    user_agent: null,
    ip_address: null,
    ...overrides,
  };
}

describe("createChroniclePassSessionRepository", () => {
  let repo: ReturnType<typeof createChroniclePassSessionRepository>;

  beforeEach(() => {
    repo = createChroniclePassSessionRepository(createInMemorySupabaseClient());
  });

  it("activate consumes the nonce and records the session token hash", async () => {
    const created = await repo.createChallenge(challengeInsert());
    expect(created.ok).toBe(true);
    const id = created.ok ? created.value.id : "";

    const activated = await repo.activate(id, {
      sessionTokenHash: "hash-1",
      sessionExpiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
    });
    expect(activated.ok).toBe(true);
    expect(activated.ok && activated.value.status).toBe("active");
    expect(activated.ok && activated.value.session_token_hash).toBe("hash-1");
  });

  it("rolls expires_at forward to the session window on activation (sweep safety)", async () => {
    const created = await repo.createChallenge(challengeInsert());
    expect(created.ok).toBe(true);
    const id = created.ok ? created.value.id : "";
    const sessionExpiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

    await repo.activate(id, { sessionTokenHash: "hash-2", sessionExpiresAt });

    const byHash = await repo.findBySessionTokenHash("hash-2");
    expect(byHash.ok && byHash.value).not.toBeNull();
    // If this stayed at the challenge TTL, the 5-minute expiry sweep would
    // kill the fresh session at the next sweep.
    expect(byHash.ok && byHash.value?.expires_at).toBe(sessionExpiresAt);
  });

  it("expireSweep keeps a fresh active session alive past the challenge TTL", async () => {
    const created = await repo.createChallenge(challengeInsert());
    expect(created.ok).toBe(true);
    const id = created.ok ? created.value.id : "";
    const sessionExpiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    await repo.activate(id, { sessionTokenHash: "hash-3", sessionExpiresAt });

    // Cutoff is after the 5-minute challenge TTL but well inside the 30-day
    // session window: the active session must survive.
    const afterChallengeTtl = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const swept = await repo.expireSweep(afterChallengeTtl);
    expect(swept.ok).toBe(true);
    expect(swept.ok && swept.value).toBe(0);

    const stillThere = await repo.findBySessionTokenHash("hash-3");
    expect(stillThere.ok && stillThere.value?.status).toBe("active");
  });

  it("expireSweep expires active sessions whose session window has lapsed", async () => {
    const created = await repo.createChallenge(challengeInsert());
    expect(created.ok).toBe(true);
    const id = created.ok ? created.value.id : "";
    await repo.activate(id, {
      sessionTokenHash: "hash-4",
      sessionExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    const swept = await repo.expireSweep(new Date(Date.now() + 2 * 60 * 1000).toISOString());
    expect(swept.ok).toBe(true);
    expect(swept.ok && swept.value).toBe(1);

    const gone = await repo.findBySessionTokenHash("hash-4");
    expect(gone.ok && gone.value).toBeNull();
  });
});
