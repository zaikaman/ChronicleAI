import type {
  PaymentRecordRepository,
  PaymentRecordRow,
  PremiumIntelligenceItemRow,
  PremiumIntelligenceRepository,
} from "@chronicleai/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PremiumReceiptPublicationService } from "../services/premium-receipt-publication-service.ts";
import { createPremiumReceiptPublicationWorker } from "../services/premium-receipt-publication-worker.ts";

const payment: PaymentRecordRow = {
  id: "payment-1",
  premium_item_id: "premium-1",
  payment_route: "x402",
  payer_reference: "0x0000000000000000000000000000000000000001",
  referral_address: null,
  amount_requested: 3.5,
  amount_settled: 3.5,
  currency: "USDC",
  status: "settled",
  challenge_reference: "challenge-1",
  settlement_reference: "0xsettlement",
  requested_at: "2026-08-03T12:00:00.000Z",
  expires_at: "2026-08-03T12:10:00.000Z",
  settled_at: "2026-08-03T12:01:00.000Z",
  registry_tx_hash: null,
  keeper_hub_run_id: null,
  explorer_url: null,
  content_uri: null,
  created_at: "2026-08-03T12:00:00.000Z",
  updated_at: "2026-08-03T12:01:00.000Z",
};

const premiumItem: PremiumIntelligenceItemRow = {
  id: "premium-1",
  slug: "premium-1",
  title: "Premium item",
  content_type: "deep_dive",
  summary_public: "Summary",
  content_private: { body: "Private content" },
  source_event_ids: [],
  price_amount: 3.5,
  price_currency: "USDC",
  payment_routes: ["x402"],
  status: "available",
  created_at: "2026-08-03T12:00:00.000Z",
  updated_at: "2026-08-03T12:00:00.000Z",
};

function createWorkerMocks() {
  const listSettledWithoutRegistryProof = vi.fn(async () => ({ ok: true as const, value: [payment] }));
  const paymentRecordRepo = {
    listSettledWithoutRegistryProof,
  } as unknown as PaymentRecordRepository;
  const premiumRepo = {
    findById: vi.fn(async () => ({ ok: true as const, value: premiumItem })),
  } as unknown as PremiumIntelligenceRepository;
  const publisher = {
    publishForSettlement: vi.fn(async () => ({ attempted: true, success: true })),
  } as unknown as PremiumReceiptPublicationService;
  const worker = createPremiumReceiptPublicationWorker({
    paymentRecordRepo,
    premiumRepo,
    publisher,
    intervalMs: 60_000,
  });
  return { worker, listSettledWithoutRegistryProof, premiumRepo, publisher };
}

describe("premium receipt publication worker", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("recovers settled payments without registry proof", async () => {
    const { worker, publisher } = createWorkerMocks();

    const stats = await worker.runOnce();

    expect(stats).toEqual({ attempted: 1, succeeded: 1, failed: 0 });
    expect(publisher.publishForSettlement).toHaveBeenCalledWith({
      payment,
      premiumItem,
    });
  });

  it("retries a failed publication on the next durable scan", async () => {
    const { worker, publisher } = createWorkerMocks();
    vi.mocked(publisher.publishForSettlement)
      .mockResolvedValueOnce({ attempted: true, success: false, errorMessage: "temporary" })
      .mockResolvedValueOnce({ attempted: true, success: true });

    await expect(worker.runOnce()).resolves.toEqual({ attempted: 1, succeeded: 0, failed: 1 });
    await expect(worker.runOnce()).resolves.toEqual({ attempted: 1, succeeded: 1, failed: 0 });
    expect(publisher.publishForSettlement).toHaveBeenCalledTimes(2);
  });

  it("does not publish sponsored-monitor receipts", async () => {
    const { worker, publisher, premiumRepo } = createWorkerMocks();
    vi.mocked(premiumRepo.findById).mockResolvedValueOnce({
      ok: true,
      value: { ...premiumItem, content_type: "sponsored_monitor" },
    });

    const stats = await worker.runOnce();

    expect(stats).toEqual({ attempted: 0, succeeded: 0, failed: 0 });
    expect(publisher.publishForSettlement).not.toHaveBeenCalled();
  });

  it("deduplicates an enqueued payment while it is in flight", async () => {
    const { worker, publisher } = createWorkerMocks();
    let resolvePublication!: (value: { attempted: boolean; success: boolean }) => void;
    vi.mocked(publisher.publishForSettlement).mockReturnValueOnce(
      new Promise((resolve) => {
        resolvePublication = resolve;
      }),
    );

    worker.enqueue({ payment, premiumItem });
    worker.enqueue({ payment, premiumItem });
    await vi.waitFor(() => expect(publisher.publishForSettlement).toHaveBeenCalledTimes(1));
    resolvePublication({ attempted: true, success: true });
    await vi.waitFor(() => expect(publisher.publishForSettlement).toHaveBeenCalledTimes(1));
  });
});
