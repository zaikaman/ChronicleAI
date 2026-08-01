// Unit tests for HMAC-signed premium access receipts

import { describe, expect, it } from "vitest";
import {
  PremiumAccessReceiptService,
  buildPremiumAccessReceiptCookie,
  extractAccessReceiptFromRequest,
  resolvePremiumAccessSecret,
} from "../services/premium-access-receipt-service.ts";

describe("PremiumAccessReceiptService", () => {
  const service = new PremiumAccessReceiptService({
    secret: "test-premium-access-secret-key",
    ttlSeconds: 3600,
  });

  it("issues a verifiable receipt bound to payment and item", () => {
    const issued = service.issue({
      paymentRecordId: "payment-001",
      premiumItemId: "item-001",
      payerReference: "0xabc",
      nowSeconds: 1_700_000_000,
    });

    expect(issued.token.split(".")).toHaveLength(2);
    expect(issued.claims.pr).toBe("payment-001");
    expect(issued.claims.pi).toBe("item-001");
    expect(issued.claims.pay).toBe("0xabc");
    expect(issued.claims.exp).toBe(1_700_000_000 + 3600);

    const verified = service.verify(issued.token, { nowSeconds: 1_700_000_000 });
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.claims.pr).toBe("payment-001");
      expect(verified.claims.pi).toBe("item-001");
    }
  });

  it("rejects tampered payloads", () => {
    const issued = service.issue({
      paymentRecordId: "payment-001",
      premiumItemId: "item-001",
      nowSeconds: 1_700_000_000,
    });

    const [payload, sig] = issued.token.split(".");
    const tampered = `${payload?.slice(0, -2)}xx.${sig}`;

    const verified = service.verify(tampered, { nowSeconds: 1_700_000_000 });
    expect(verified.ok).toBe(false);
  });

  it("rejects forged signatures from another secret", () => {
    const other = new PremiumAccessReceiptService({
      secret: "different-secret-key-xx",
      ttlSeconds: 3600,
    });
    const forged = other.issue({
      paymentRecordId: "payment-001",
      premiumItemId: "item-001",
      nowSeconds: 1_700_000_000,
    });

    const verified = service.verify(forged.token, { nowSeconds: 1_700_000_000 });
    expect(verified.ok).toBe(false);
  });

  it("rejects expired receipts", () => {
    const issued = service.issue({
      paymentRecordId: "payment-001",
      premiumItemId: "item-001",
      nowSeconds: 1_700_000_000,
    });

    const verified = service.verify(issued.token, { nowSeconds: 1_700_000_000 + 3601 });
    expect(verified.ok).toBe(false);
    if (!verified.ok) {
      expect(verified.reason).toContain("expired");
    }
  });

  it("rejects empty or malformed tokens", () => {
    expect(service.verify("").ok).toBe(false);
    expect(service.verify("not-a-token").ok).toBe(false);
    expect(service.verify("only.one.too.many").ok).toBe(false);
  });
});

describe("extractAccessReceiptFromRequest", () => {
  it("prefers Authorization Bearer", () => {
    const token = extractAccessReceiptFromRequest({
      authorizationHeader: "Bearer abc.def",
      receiptHeader: "header-token",
    });
    expect(token).toBe("abc.def");
  });

  it("falls back to X-Premium-Access-Receipt header", () => {
    const token = extractAccessReceiptFromRequest({
      receiptHeader: "header-token",
    });
    expect(token).toBe("header-token");
  });

  it("ignores receipts supplied through query parameters", () => {
    const token = extractAccessReceiptFromRequest({
      cookieHeader: "chronicle_premium_receipt_item-1=query-token",
      premiumItemId: "item-2",
    });
    expect(token).toBeUndefined();
  });

  it("reads item-scoped cookie", () => {
    const token = extractAccessReceiptFromRequest({
      cookieHeader: "chronicle_premium_receipt_item-1=cookie-token; other=1",
      premiumItemId: "item-1",
    });
    expect(token).toBe("cookie-token");
  });
});

describe("buildPremiumAccessReceiptCookie", () => {
  it("always marks receipt cookies Secure and HttpOnly", () => {
    const cookie = buildPremiumAccessReceiptCookie({
      token: "payload.signature",
      premiumItemId: "item-1",
      maxAgeSeconds: 3600,
    });

    expect(cookie).toContain("Secure");
    expect(cookie).toContain("HttpOnly");
  });
});

describe("resolvePremiumAccessSecret", () => {
  it("prefers dedicated premium access secret", () => {
    expect(
      resolvePremiumAccessSecret({
        premiumAccessSecret: "dedicated-secret-16+",
        keeperhubWebhookSecret: "webhook-secret-16xx",
      }),
    ).toBe("dedicated-secret-16+");
  });

  it("falls back to keeperhub webhook secret", () => {
    expect(
      resolvePremiumAccessSecret({
        keeperhubWebhookSecret: "webhook-secret-16xx",
      }),
    ).toBe("webhook-secret-16xx");
  });
});
