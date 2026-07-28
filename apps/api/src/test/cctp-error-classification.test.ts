import { describe, expect, it } from "vitest";
import {
  classifyCctpError,
  truncateErrorMessage,
} from "../cctp/error-classification.ts";
import { IrisHttpError } from "../cctp/iris-client.ts";

describe("classifyCctpError", () => {
  it("classifies Iris 429", () => {
    const c = classifyCctpError(new IrisHttpError(429, "rate limited", 60_000));
    expect(c.class).toBe("iris_429");
    expect(c.retryable).toBe(true);
    expect(c.preferStuck).toBe(true);
  });

  it("classifies gas errors", () => {
    const c = classifyCctpError(new Error("insufficient funds for gas"));
    expect(c.class).toBe("gas");
    expect(c.retryable).toBe(false);
  });

  it("classifies allowance errors", () => {
    const c = classifyCctpError(
      new Error("ERC20: insufficient allowance"),
    );
    expect(c.class).toBe("allowance");
  });

  it("classifies nonce already used", () => {
    const c = classifyCctpError(new Error("Nonce already used"));
    expect(c.class).toBe("nonce_used");
  });

  it("classifies reverts", () => {
    const c = classifyCctpError(new Error("execution reverted: foo"));
    expect(c.class).toBe("revert");
    expect(c.retryable).toBe(true);
  });

  it("classifies network errors", () => {
    const c = classifyCctpError(new Error("fetch failed"));
    expect(c.class).toBe("network");
    expect(c.preferStuck).toBe(true);
  });
});

describe("truncateErrorMessage", () => {
  it("truncates long messages", () => {
    const long = "x".repeat(3000);
    const t = truncateErrorMessage(long, 100);
    expect(t.length).toBe(100);
    expect(t.endsWith("...")).toBe(true);
  });
});
