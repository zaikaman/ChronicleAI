// Unit tests for agent payment rail discovery document

import { describe, expect, it } from "vitest";
import { buildAgentPaymentsDiscovery } from "../services/agent-payments-discovery.ts";

describe("buildAgentPaymentsDiscovery", () => {
  it("advertises both x402 and mpp rails", () => {
    const doc = buildAgentPaymentsDiscovery();

    expect(doc.version).toBe("1");
    expect(doc.routes.map((r) => r.id)).toEqual(["x402", "mpp", "auto"]);
    expect(doc.endpoints.createChallenge).toBe("POST /payments/challenges");
    expect(doc.endpoints.settlePayment).toBe("POST /payments/settlements");
    expect(doc.endpoints.wellKnown).toBe("GET /.well-known/agent-payments");
  });

  it("documents the MPP HMAC settlement format without leaking secrets", () => {
    const doc = buildAgentPaymentsDiscovery();
    const json = JSON.stringify(doc);

    expect(doc.mpp.settleRequest.settlementReferenceFormat).toContain("HMAC-SHA256");
    expect(doc.mpp.challengeRequest.body.paymentRoute).toBe("mpp");
    expect(json).not.toMatch(/mpp-test-secret|expectedHmac|sk_/i);
  });

  it("marks human UI as x402-only while agents use MPP via API", () => {
    const doc = buildAgentPaymentsDiscovery();

    expect(doc.humanUi.paymentRoute).toBe("x402");
    expect(doc.humanUi.path).toBe("/premium");
    expect(doc.routes.find((r) => r.id === "mpp")?.audience).toBe("machine");
  });

  it("surfaces desk feed endpoints and Sepolia private-routing product copy", () => {
    const doc = buildAgentPaymentsDiscovery();

    expect(doc.endpoints.deskStream).toBe("GET /premium/desk/stream");
    expect(doc.deskFeed?.productSlug).toBe("chronicle-desk-feed");
    expect(doc.deskFeed?.executionRouting).toMatch(/Flashbots Protect/i);
    expect(doc.deskFeed?.executionRouting).toMatch(/Sepolia/i);
    expect(doc.description).toMatch(/private mempool/i);
    expect(JSON.stringify(doc)).not.toMatch(/MEV-proof/i);
  });
});
