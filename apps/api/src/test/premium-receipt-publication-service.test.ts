import type {
  ExecutionLogRepository,
  PaymentRecordRepository,
  PremiumIntelligenceItemRow,
} from "@chronicleai/db";
import { describe, expect, it, vi } from "vitest";
import type { ChronicleRegistryService } from "../services/chronicle-registry-service.ts";
import { createPremiumReceiptPublicationService } from "../services/premium-receipt-publication-service.ts";
import { MOCK_PAYMENT_SETTLED } from "./fixtures/payments.ts";

describe("premium-receipt-publication-service", () => {
  const deepDiveItem = {
    id: MOCK_PAYMENT_SETTLED.premium_item_id,
    slug: "deep-dive-1",
    title: "Deep dive",
    content_type: "deep_dive",
    summary_public: "Public teaser",
    content_private: { analysis: "secret body" },
    source_event_ids: [],
    price_amount: 5,
    price_currency: "USDC",
    payment_routes: ["x402"],
    status: "available",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  } as unknown as PremiumIntelligenceItemRow;

  function createDeps(overrides?: {
    registrySuccess?: boolean;
    contentType?: string;
  }) {
    const paymentRecordRepo = {
      markRegistryProof: vi.fn().mockResolvedValue({
        ok: true as const,
        value: {
          ...MOCK_PAYMENT_SETTLED,
          registry_tx_hash: "0xreceipt",
        },
      }),
    } as unknown as PaymentRecordRepository;

    const execLogRepo = {
      append: vi.fn().mockResolvedValue({ ok: true as const, value: { id: "log-1" } }),
    } as unknown as ExecutionLogRepository;

    const registry: ChronicleRegistryService = {
      publishAlert: vi.fn(),
      publishDigest: vi.fn(),
      recordPayout: vi.fn(),
      publishTradeTicket: vi.fn(),
      recordCapitalMove: vi.fn(),
      publishPremiumReceipt: vi.fn().mockResolvedValue(
        overrides?.registrySuccess === false
          ? { success: false, errorMessage: "kh timeout" }
          : {
              success: true,
              txHash: "0x" + "ab".repeat(32),
              explorerUrl: "https://sepolia.etherscan.io/tx/0xab",
              keeperHubRunId: "exec_premium_1",
            },
      ),
    };

    const service = createPremiumReceiptPublicationService({
      paymentRecordRepo,
      execLogRepo,
      registry,
      frontendOrigin: "https://chronicle.example",
    });

    const item =
      overrides?.contentType === "sponsored_monitor"
        ? ({ ...deepDiveItem, content_type: "sponsored_monitor" } as PremiumIntelligenceItemRow)
        : deepDiveItem;

    return { service, paymentRecordRepo, execLogRepo, registry, item };
  }

  it("publishes premium receipt and persists registry proof on success", async () => {
    const { service, paymentRecordRepo, registry, item } = createDeps();

    const result = await service.publishForSettlement({
      payment: MOCK_PAYMENT_SETTLED,
      premiumItem: item,
    });

    expect(result.attempted).toBe(true);
    expect(result.success).toBe(true);
    expect(result.registryTxHash).toMatch(/^0x/);
    expect(result.contentUri).toContain("/premium?item=");
    expect(registry.publishPremiumReceipt).toHaveBeenCalled();
    expect(paymentRecordRepo.markRegistryProof).toHaveBeenCalledWith(
      MOCK_PAYMENT_SETTLED.id,
      expect.objectContaining({
        registry_tx_hash: expect.stringMatching(/^0x/),
        content_uri: expect.stringContaining("premium"),
      }),
    );
  });

  it("soft-fails when registry write fails (settlement path remains independent)", async () => {
    const { service, paymentRecordRepo, item } = createDeps({ registrySuccess: false });

    const result = await service.publishForSettlement({
      payment: MOCK_PAYMENT_SETTLED,
      premiumItem: item,
    });

    expect(result.attempted).toBe(true);
    expect(result.success).toBe(false);
    expect(result.errorMessage).toMatch(/kh timeout/);
    expect(paymentRecordRepo.markRegistryProof).not.toHaveBeenCalled();
  });

  it("skips sponsored_monitor items (createSponsoredWatch is the proof trail)", async () => {
    const { service, registry, item } = createDeps({ contentType: "sponsored_monitor" });

    const result = await service.publishForSettlement({
      payment: MOCK_PAYMENT_SETTLED,
      premiumItem: item,
    });

    expect(result.attempted).toBe(false);
    expect(result.errorMessage).toBe("skipped_sponsored_monitor");
    expect(registry.publishPremiumReceipt).not.toHaveBeenCalled();
  });
});
