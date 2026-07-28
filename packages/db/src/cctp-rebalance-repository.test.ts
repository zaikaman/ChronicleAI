import { describe, expect, it } from "vitest";
import { isCctpTransitionAllowed } from "@chronicleai/schemas";
import {
  createCctpRebalanceRepository,
  normalizeCctpAddress,
  normalizeTxHash,
} from "./cctp-rebalance-repository.ts";
import { createInMemorySupabaseClient } from "./in-memory-supabase.ts";

const TREASURY = "0xAbCdEf0123456789AbCdEf0123456789AbCdEf01";
const BURN_TX =
  "0x1111111111111111111111111111111111111111111111111111111111111111";
const MINT_TX =
  "0x2222222222222222222222222222222222222222222222222222222222222222";
const APPROVE_TX =
  "0x3333333333333333333333333333333333333333333333333333333333333333";

function makeRepo() {
  const client = createInMemorySupabaseClient();
  const repo = createCctpRebalanceRepository(
    client as unknown as Parameters<typeof createCctpRebalanceRepository>[0],
  );
  return { client, repo };
}

function baseInsert(overrides: Record<string, unknown> = {}) {
  return {
    amount_usdc: 10,
    amount_atomic: "10000000",
    mode: "direct" as const,
    treasury_address: TREASURY,
    ...overrides,
  };
}

describe("normalizeCctpAddress / normalizeTxHash", () => {
  it("lowercases valid addresses", () => {
    expect(normalizeCctpAddress(TREASURY)).toBe(TREASURY.toLowerCase());
  });

  it("rejects invalid addresses", () => {
    expect(normalizeCctpAddress("not-an-address")).toBeNull();
    expect(normalizeCctpAddress("")).toBeNull();
    expect(normalizeCctpAddress(null)).toBeNull();
  });

  it("lowercases valid tx hashes", () => {
    expect(normalizeTxHash(BURN_TX.toUpperCase())).toBe(BURN_TX);
  });

  it("rejects invalid tx hashes", () => {
    expect(normalizeTxHash("0xdead")).toBeNull();
    expect(normalizeTxHash(null)).toBeNull();
  });
});

describe("isCctpTransitionAllowed", () => {
  it("allows the happy path", () => {
    expect(isCctpTransitionAllowed("pending", "approving")).toBe(true);
    expect(isCctpTransitionAllowed("approving", "burning")).toBe(true);
    expect(isCctpTransitionAllowed("burning", "awaiting_attestation")).toBe(true);
    expect(isCctpTransitionAllowed("awaiting_attestation", "minting")).toBe(true);
    expect(isCctpTransitionAllowed("minting", "minted")).toBe(true);
  });

  it("allows forwarding short-circuit to minted", () => {
    expect(isCctpTransitionAllowed("awaiting_attestation", "minted")).toBe(true);
  });

  it("allows stuck resume paths", () => {
    expect(isCctpTransitionAllowed("stuck", "awaiting_attestation")).toBe(true);
    expect(isCctpTransitionAllowed("stuck", "minting")).toBe(true);
    expect(isCctpTransitionAllowed("stuck", "minted")).toBe(true);
  });

  it("rejects terminal and illegal transitions", () => {
    expect(isCctpTransitionAllowed("minted", "pending")).toBe(false);
    expect(isCctpTransitionAllowed("failed", "approving")).toBe(false);
    expect(isCctpTransitionAllowed("pending", "minted")).toBe(false);
    expect(isCctpTransitionAllowed("approving", "minting")).toBe(false);
  });
});

describe("cctp-rebalance-repository", () => {
  it("creates a pending transfer with normalized treasury + defaults", async () => {
    const { repo } = makeRepo();
    const created = await repo.create(baseInsert());
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(created.value.status).toBe("pending");
    expect(created.value.direction).toBe("base_to_sepolia");
    expect(created.value.treasury_address).toBe(TREASURY.toLowerCase());
    expect(created.value.mint_recipient).toBe(TREASURY.toLowerCase());
    expect(created.value.source_domain).toBe(6);
    expect(created.value.destination_domain).toBe(0);
    expect(created.value.source_chain_id).toBe(84532);
    expect(created.value.destination_chain_id).toBe(11155111);
    expect(created.value.amount_usdc).toBe(10);
    expect(created.value.amount_atomic).toBe("10000000");
    expect(created.value.mode).toBe("direct");
    expect(created.value.attempt_count).toBe(0);
    expect(created.value.metadata).toEqual({});
  });

  it("rejects invalid create inputs", async () => {
    const { repo } = makeRepo();

    const badTreasury = await repo.create(baseInsert({ treasury_address: "nope" }));
    expect(badTreasury.ok).toBe(false);
    if (badTreasury.ok) return;
    expect(badTreasury.error.code).toBe("VALIDATION");

    const badAmount = await repo.create(baseInsert({ amount_usdc: 0 }));
    expect(badAmount.ok).toBe(false);

    const badAtomic = await repo.create(baseInsert({ amount_atomic: "1.5" }));
    expect(badAtomic.ok).toBe(false);
  });

  it("moves a row through direct-mode statuses idempotently (CAS)", async () => {
    const { repo } = makeRepo();
    const created = await repo.create(baseInsert());
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const id = created.value.id;

    const approving = await repo.transition(id, "pending", "approving", {
      approve_tx_hash: APPROVE_TX,
    });
    expect(approving.ok).toBe(true);
    if (!approving.ok) return;
    expect(approving.value.status).toBe("approving");
    expect(approving.value.approve_tx_hash).toBe(APPROVE_TX);

    // Stale CAS: still pending → conflict
    const stale = await repo.transition(id, "pending", "approving");
    expect(stale.ok).toBe(false);
    if (stale.ok) return;
    expect(stale.error.code).toBe("CONFLICT");

    const burning = await repo.transition(id, "approving", "burning");
    expect(burning.ok).toBe(true);
    if (!burning.ok) return;

    const awaiting = await repo.transition(id, "burning", "awaiting_attestation", {
      burn_tx_hash: BURN_TX,
    });
    expect(awaiting.ok).toBe(true);
    if (!awaiting.ok) return;
    expect(awaiting.value.status).toBe("awaiting_attestation");
    expect(awaiting.value.burn_tx_hash).toBe(BURN_TX);
    expect(awaiting.value.burned_at).toBeTruthy();

    const minting = await repo.transition(id, "awaiting_attestation", "minting", {
      message_bytes: "0xmsg",
      attestation: "0xatt",
      iris_status: "complete",
    });
    expect(minting.ok).toBe(true);
    if (!minting.ok) return;
    expect(minting.value.status).toBe("minting");
    expect(minting.value.attested_at).toBeTruthy();
    expect(minting.value.message_bytes).toBe("0xmsg");

    const minted = await repo.transition(id, "minting", "minted", {
      mint_tx_hash: MINT_TX,
    });
    expect(minted.ok).toBe(true);
    if (!minted.ok) return;
    expect(minted.value.status).toBe("minted");
    expect(minted.value.mint_tx_hash).toBe(MINT_TX);
    expect(minted.value.minted_at).toBeTruthy();

    // Terminal: no further transitions
    const afterMinted = await repo.transition(id, "minted", "failed");
    expect(afterMinted.ok).toBe(false);
    if (afterMinted.ok) return;
    expect(afterMinted.error.code).toBe("VALIDATION");
  });

  it("supports forwarding mode short-circuit to minted", async () => {
    const { repo } = makeRepo();
    const created = await repo.create(baseInsert({ mode: "forwarding" }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const id = created.value.id;

    await repo.transition(id, "pending", "approving");
    await repo.transition(id, "approving", "burning");
    await repo.transition(id, "burning", "awaiting_attestation", {
      burn_tx_hash: BURN_TX,
    });
    const minted = await repo.transition(id, "awaiting_attestation", "minted", {
      mint_tx_hash: MINT_TX,
      iris_status: "complete",
    });
    expect(minted.ok).toBe(true);
    if (!minted.ok) return;
    expect(minted.value.status).toBe("minted");
    expect(minted.value.mode).toBe("forwarding");
  });

  it("rejects illegal transitions without mutating the row", async () => {
    const { repo } = makeRepo();
    const created = await repo.create(baseInsert());
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const illegal = await repo.transition(created.value.id, "pending", "minted");
    expect(illegal.ok).toBe(false);
    if (illegal.ok) return;
    expect(illegal.error.code).toBe("VALIDATION");

    const reloaded = await repo.findById(created.value.id);
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok || !reloaded.value) return;
    expect(reloaded.value.status).toBe("pending");
  });

  it("finds by burn tx hash and lists in-flight / resumable", async () => {
    const { repo } = makeRepo();

    const a = await repo.create(baseInsert({ amount_usdc: 5, amount_atomic: "5000000" }));
    const b = await repo.create(baseInsert({ amount_usdc: 15, amount_atomic: "15000000" }));
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;

    await repo.transition(a.value.id, "pending", "approving");
    await repo.transition(a.value.id, "approving", "burning");
    await repo.transition(a.value.id, "burning", "awaiting_attestation", {
      burn_tx_hash: BURN_TX,
    });

    // Complete B so it is not in-flight
    await repo.transition(b.value.id, "pending", "approving");
    await repo.transition(b.value.id, "approving", "burning");
    await repo.transition(b.value.id, "burning", "awaiting_attestation", {
      burn_tx_hash:
        "0x4444444444444444444444444444444444444444444444444444444444444444",
    });
    await repo.transition(b.value.id, "awaiting_attestation", "minted", {
      mint_tx_hash: MINT_TX,
    });

    const byBurn = await repo.findByBurnTxHash(BURN_TX);
    expect(byBurn.ok).toBe(true);
    if (!byBurn.ok) return;
    expect(byBurn.value?.id).toBe(a.value.id);

    const inFlight = await repo.listInFlight();
    expect(inFlight.ok).toBe(true);
    if (!inFlight.ok) return;
    expect(inFlight.value.map((r) => r.id)).toEqual([a.value.id]);

    const count = await repo.countInFlight();
    expect(count.ok).toBe(true);
    if (!count.ok) return;
    expect(count.value).toBe(1);

    const resumable = await repo.listResumable();
    expect(resumable.ok).toBe(true);
    if (!resumable.ok) return;
    expect(resumable.value.map((r) => r.id)).toEqual([a.value.id]);
  });

  it("marks stuck and resumes back to awaiting_attestation then minted", async () => {
    const { repo } = makeRepo();
    const created = await repo.create(baseInsert());
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const id = created.value.id;

    await repo.transition(id, "pending", "approving");
    await repo.transition(id, "approving", "burning");
    await repo.transition(id, "burning", "awaiting_attestation", {
      burn_tx_hash: BURN_TX,
    });

    const stuck = await repo.transition(id, "awaiting_attestation", "stuck", {
      error_message: "Iris poll timeout",
    });
    expect(stuck.ok).toBe(true);
    if (!stuck.ok) return;
    expect(stuck.value.status).toBe("stuck");
    expect(stuck.value.error_message).toBe("Iris poll timeout");

    // Still counts as in-flight
    const count = await repo.countInFlight();
    expect(count.ok).toBe(true);
    if (!count.ok) return;
    expect(count.value).toBe(1);

    const resumed = await repo.transition(id, "stuck", "awaiting_attestation", {
      error_message: null,
    });
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    expect(resumed.value.status).toBe("awaiting_attestation");

    const minted = await repo.transition(id, "awaiting_attestation", "minted", {
      mint_tx_hash: MINT_TX,
      iris_status: "complete",
    });
    expect(minted.ok).toBe(true);
    if (!minted.ok) return;
    expect(minted.value.status).toBe("minted");
  });

  it("fails a row from approving and keeps it out of in-flight", async () => {
    const { repo } = makeRepo();
    const created = await repo.create(baseInsert());
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const id = created.value.id;

    await repo.transition(id, "pending", "approving");
    const failed = await repo.transition(id, "approving", "failed", {
      error_message: "approve reverted",
    });
    expect(failed.ok).toBe(true);
    if (!failed.ok) return;
    expect(failed.value.status).toBe("failed");

    const count = await repo.countInFlight();
    expect(count.ok).toBe(true);
    if (!count.ok) return;
    expect(count.value).toBe(0);
  });

  it("lists by treasury and reports last successful burn time", async () => {
    const { repo } = makeRepo();
    const otherTreasury = "0x00000000000000000000000000000000000000aa";

    const a = await repo.create(baseInsert());
    const b = await repo.create(
      baseInsert({ treasury_address: otherTreasury, mint_recipient: otherTreasury }),
    );
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;

    await repo.transition(a.value.id, "pending", "approving");
    await repo.transition(a.value.id, "approving", "burning");
    await repo.transition(a.value.id, "burning", "awaiting_attestation", {
      burn_tx_hash: BURN_TX,
      burned_at: "2026-07-28T10:00:00.000Z",
    });
    await repo.transition(a.value.id, "awaiting_attestation", "minted", {
      mint_tx_hash: MINT_TX,
    });

    const byTreasury = await repo.listByTreasury(TREASURY);
    expect(byTreasury.ok).toBe(true);
    if (!byTreasury.ok) return;
    expect(byTreasury.value).toHaveLength(1);
    expect(byTreasury.value[0]?.id).toBe(a.value.id);

    const lastBurn = await repo.findLastSuccessfulBurnAt(TREASURY);
    expect(lastBurn.ok).toBe(true);
    if (!lastBurn.ok) return;
    expect(lastBurn.value).toBe("2026-07-28T10:00:00.000Z");

    const noneForOther = await repo.findLastSuccessfulBurnAt(otherTreasury);
    expect(noneForOther.ok).toBe(true);
    if (!noneForOther.ok) return;
    expect(noneForOther.value).toBeNull();
  });

  it("accepts multi-status fromStatus for resume CAS", async () => {
    const { repo } = makeRepo();
    const created = await repo.create(baseInsert());
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const id = created.value.id;

    await repo.transition(id, "pending", "approving");
    await repo.transition(id, "approving", "burning");
    await repo.transition(id, "burning", "awaiting_attestation", {
      burn_tx_hash: BURN_TX,
    });
    await repo.transition(id, "awaiting_attestation", "stuck");

    const fromResumable = await repo.transition(
      id,
      ["awaiting_attestation", "minting", "stuck"],
      "minted",
      { mint_tx_hash: MINT_TX },
    );
    expect(fromResumable.ok).toBe(true);
    if (!fromResumable.ok) return;
    expect(fromResumable.value.status).toBe("minted");
  });
});
