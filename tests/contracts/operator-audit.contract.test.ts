// Contract tests: GET /operator/audit
// Tests authenticated, unauthenticated, and response-shape cases

import { describe, expect, it } from "vitest";
import { assertOperatorAuditShape } from "./schema-assertions.ts";

const API_URL = process.env["TEST_API_URL"] ?? "http://localhost:4000";
const OPERATOR_TOKEN =
  process.env["TEST_OPERATOR_TOKEN"] ??
  process.env["OPERATOR_AUTH_SECRET"] ??
  "test-operator-secret-token-for-testing";

describe("Contract: GET /operator/audit", () => {
  it("should return 200 with audit data shape when authenticated", async () => {
    const response = await fetch(`${API_URL}/operator/audit`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${OPERATOR_TOKEN}`,
        "Content-Type": "application/json",
      },
    });

    expect(response.status).toBe(200);

    const body = (await response.json()) as Record<string, unknown>;
    assertOperatorAuditShape(body);

    // Verify required sub-sections have correct types
    expect(Array.isArray(body.alerts)).toBe(true);
    expect(Array.isArray(body.digests)).toBe(true);
    expect(Array.isArray(body.payments)).toBe(true);
    expect(Array.isArray(body.executionLogs)).toBe(true);
    expect(body.treasury).toBeDefined();
    expect(typeof (body.treasury as Record<string, unknown>).availableBalance).toBe("number");
    expect(typeof (body.treasury as Record<string, unknown>).safetyBuffer).toBe("number");
    expect(typeof (body.treasury as Record<string, unknown>).status).toBe("string");
  });

  it("should return 200 with empty arrays when no data exists", async () => {
    const response = await fetch(`${API_URL}/operator/audit`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${OPERATOR_TOKEN}`,
        "Content-Type": "application/json",
      },
    });

    expect(response.status).toBe(200);

    const body = (await response.json()) as Record<string, unknown>;

    // Should always have the expected structure even with empty data
    expect(Array.isArray(body.alerts)).toBe(true);
    expect(Array.isArray(body.digests)).toBe(true);
    expect(Array.isArray(body.payments)).toBe(true);
    expect(Array.isArray(body.executionLogs)).toBe(true);
    expect(body.treasury).toBeDefined();
  });

  it("should return 401 without authorization header", async () => {
    const response = await fetch(`${API_URL}/operator/audit`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    expect(response.status).toBe(401);

    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toHaveProperty("error");
  });

  it("should return 401 with invalid token", async () => {
    const response = await fetch(`${API_URL}/operator/audit`, {
      method: "GET",
      headers: {
        Authorization: "Bearer invalid-token-that-should-be-rejected",
        "Content-Type": "application/json",
      },
    });

    expect(response.status).toBe(401);

    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toHaveProperty("error");
  });

  it("should return 401 with malformed authorization header", async () => {
    const response = await fetch(`${API_URL}/operator/audit`, {
      method: "GET",
      headers: {
        Authorization: "NotBearer token",
        "Content-Type": "application/json",
      },
    });

    expect(response.status).toBe(401);

    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toHaveProperty("error");
  });

  it("should return 200 with alerts containing required fields", async () => {
    const response = await fetch(`${API_URL}/operator/audit`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${OPERATOR_TOKEN}`,
        "Content-Type": "application/json",
      },
    });

    expect(response.status).toBe(200);

    const body = (await response.json()) as { alerts: Array<Record<string, unknown>> };

    for (const alert of body.alerts) {
      expect(alert).toHaveProperty("id");
      expect(alert).toHaveProperty("title");
      expect(alert).toHaveProperty("deliveryStatus");
      expect(alert).toHaveProperty("publishedAt");
    }
  });

  it("should return 200 with digests containing required fields", async () => {
    const response = await fetch(`${API_URL}/operator/audit`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${OPERATOR_TOKEN}`,
        "Content-Type": "application/json",
      },
    });

    expect(response.status).toBe(200);

    const body = (await response.json()) as { digests: Array<Record<string, unknown>> };

    for (const digest of body.digests) {
      expect(digest).toHaveProperty("id");
      expect(digest).toHaveProperty("reportDate");
      expect(digest).toHaveProperty("title");
      expect(digest).toHaveProperty("publicationStatus");
    }
  });

  it("should return 200 with execution logs containing required fields", async () => {
    const response = await fetch(`${API_URL}/operator/audit`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${OPERATOR_TOKEN}`,
        "Content-Type": "application/json",
      },
    });

    expect(response.status).toBe(200);

    const body = (await response.json()) as { executionLogs: Array<Record<string, unknown>> };

    for (const log of body.executionLogs) {
      expect(log).toHaveProperty("id");
      expect(log).toHaveProperty("actionType");
      expect(log).toHaveProperty("status");
      expect(log).toHaveProperty("createdAt");
    }
  });
});
