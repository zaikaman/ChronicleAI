import { describe, expect, it } from "vitest";
import type {
  AffiliateFundingTransferInsert,
  AffiliateFundingTransferRepository,
  AffiliateFundingTransferRow,
} from "@chronicleai/db";
import type { OnChainWriteReceipt } from "../services/on-chain-write-receipt.ts";
import type { ParaTreasuryClient } from "../services/para-treasury-client.ts";
import { createAffiliateFundingService } from "../services/affiliate-funding-service.ts";

const EARNING_ID = "earning-001";
const DESTINATION = "0x677b30e08ef0ef2667b04220b27112a20cadba77";
const TOKEN = "0x036cbd53842c5426634e7929541ec2318f3dcf7e";

function createHarness(options?: { failFirst?: boolean }) {
  const rows = new Map<string, AffiliateFundingTransferRow>();
  const calls: Array<{ to: string; amount: string; idempotencyKey?: string }> = [];
  let sequence = 0;
  let failedOnce = false;

  const repository: AffiliateFundingTransferRepository = {
    async createForEarning(input: AffiliateFundingTransferInsert) {
      const existing = [...rows.values()].find(
        (row) => row.affiliate_earning_id === input.affiliate_earning_id,
      );
      if (existing) return { ok: true, value: existing };
      const now = new Date().toISOString();
      const row: AffiliateFundingTransferRow = {
        id: `funding-${++sequence}`,
        affiliate_earning_id: input.affiliate_earning_id,
        amount: input.amount,
        currency: input.currency ?? "USDC",
        destination_wallet: input.destination_wallet,
        chain_id: input.chain_id,
        token_address: input.token_address,
        status: input.status ?? "pending",
        attempt_count: 0,
        tx_hash: null,
        explorer_url: null,
        error_message: null,
        created_at: now,
        updated_at: now,
        completed_at: null,
      };
      rows.set(row.id, row);
      return { ok: true, value: row };
    },
    async findByEarningId(earningId) {
      return {
        ok: true,
        value: [...rows.values()].find((row) => row.affiliate_earning_id === earningId) ?? null,
      };
    },
    async listRetryable() {
      return {
        ok: true,
        value: [...rows.values()].filter((row) => row.status === "pending" || row.status === "failed"),
      };
    },
    async claim(id) {
      const row = rows.get(id);
      if (!row || (row.status !== "pending" && row.status !== "failed")) {
        return { ok: true, value: null };
      }
      row.status = "processing";
      row.attempt_count += 1;
      row.error_message = null;
      return { ok: true, value: row };
    },
    async markCompleted(id, meta) {
      const row = rows.get(id)!;
      row.status = "completed";
      row.tx_hash = meta.txHash;
      row.explorer_url = meta.explorerUrl ?? null;
      row.completed_at = new Date().toISOString();
      return { ok: true, value: row };
    },
    async markFailed(id, message) {
      const row = rows.get(id)!;
      row.status = "failed";
      row.error_message = message;
      return { ok: true, value: row };
    },
  };

  const treasuryClient = {
    async sendTransfer(to: string, amount: string, idempotencyKey?: string): Promise<OnChainWriteReceipt> {
      calls.push({ to, amount, idempotencyKey });
      if (options?.failFirst && !failedOnce) {
        failedOnce = true;
        throw new Error("temporary treasury RPC failure");
      }
      return {
        txHash: `0x${"a".repeat(64)}`,
        explorerUrl: "https://sepolia.basescan.org/tx/0x" + "a".repeat(64),
      };
    },
  } as unknown as ParaTreasuryClient;

  return {
    rows,
    calls,
    repository,
    treasuryClient,
    service: createAffiliateFundingService({
      repository,
      treasuryClient,
      destinationWallet: DESTINATION,
      chainId: 84532,
      tokenAddress: TOKEN,
    }),
  };
}

describe("affiliate funding service", () => {
  it("funds exactly the credited reward and is idempotent per earning", async () => {
    const harness = createHarness();

    const first = await harness.service.fundEarning({
      earningId: EARNING_ID,
      amount: 1,
      currency: "USDC",
    });
    const second = await harness.service.fundEarning({
      earningId: EARNING_ID,
      amount: 1,
      currency: "USDC",
    });

    expect(first.status).toBe("completed");
    expect(second.status).toBe("completed");
    expect(harness.calls).toHaveLength(1);
    expect(harness.calls[0]).toMatchObject({
      to: DESTINATION,
      amount: "1",
      idempotencyKey: `affiliate-funding-${EARNING_ID}`,
    });
  });

  it("retries a failed treasury transfer without creating another earning", async () => {
    const harness = createHarness({ failFirst: true });

    const first = await harness.service.fundEarning({
      earningId: EARNING_ID,
      amount: 1,
      currency: "USDC",
    });
    const retry = await harness.service.retryPending();

    expect(first.status).toBe("failed");
    expect(retry).toEqual({ attempted: 1, completed: 1, failed: 0 });
    expect(harness.rows.size).toBe(1);
    expect(harness.calls).toHaveLength(2);
    expect(harness.calls[0]?.idempotencyKey).toBe(harness.calls[1]?.idempotencyKey);
  });

  it("skips safely when the treasury funding rail is not configured", async () => {
    const harness = createHarness();
    const service = createAffiliateFundingService({
      repository: harness.repository,
      treasuryClient: null,
      destinationWallet: DESTINATION,
      chainId: 84532,
      tokenAddress: TOKEN,
    });

    const result = await service.fundEarning({
      earningId: EARNING_ID,
      amount: 1,
      currency: "USDC",
    });

    expect(result.status).toBe("skipped");
    expect(harness.calls).toHaveLength(0);
  });
});
