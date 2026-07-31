import { describe, expect, it } from "vitest";
import { paymentFailureReason } from "../services/payment-status-copy.ts";

describe("paymentFailureReason", () => {
  it("explains an insufficient USDC wallet without exposing provider details", () => {
    const reason = paymentFailureReason(
      {
        status: "failed",
        amount_requested: 1,
        amount_settled: null,
        currency: "USDC",
        payment_route: "x402",
      },
      {
        details: { errorMessage: "insufficient funds for transfer" },
        message: "Payment settlement failed",
      },
    );

    expect(reason).toBe("The payer wallet did not have enough USDC to cover this charge.");
    expect(reason).not.toContain("facilitator");
  });

  it("shows the amount difference for an underpaid attempt", () => {
    expect(
      paymentFailureReason({
        status: "underpaid",
        amount_requested: 1,
        amount_settled: 0.5,
        currency: "USDC",
        payment_route: "mpp",
      }),
    ).toBe("The payer sent 0.5 USDC, but 1 USDC was required.");
  });

  it("explains expired challenges", () => {
    expect(
      paymentFailureReason({
        status: "expired",
        amount_requested: 1,
        amount_settled: null,
        currency: "USDC",
        payment_route: "x402",
      }),
    ).toContain("expired");
  });
});
