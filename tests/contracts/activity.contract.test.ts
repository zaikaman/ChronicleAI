// Contract tests: GET /activity
// Public endpoint — no authentication required

import { describe, expect, it } from "vitest";
import { assertAgentActivityShape } from "./schema-assertions.ts";

const API_URL = process.env["TEST_API_URL"] ?? "http://localhost:4000";

describe("Contract: GET /activity", () => {
  it("should return 200 with activity data shape", async () => {
    const response = await fetch(`${API_URL}/activity`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    expect(response.status).toBe(200);

    const body = (await response.json()) as Record<string, unknown>;
    assertAgentActivityShape(body);

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
    const response = await fetch(`${API_URL}/activity`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    expect(response.status).toBe(200);

    const body = (await response.json()) as Record<string, unknown>;

    expect(Array.isArray(body.alerts)).toBe(true);
    expect(Array.isArray(body.digests)).toBe(true);
    expect(Array.isArray(body.payments)).toBe(true);
    expect(Array.isArray(body.executionLogs)).toBe(true);
    expect(body.treasury).toBeDefined();
  });

  it("should return 200 with alerts containing required fields", async () => {
    const response = await fetch(`${API_URL}/activity`, {
      method: "GET",
      headers: {
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
    const response = await fetch(`${API_URL}/activity`, {
      method: "GET",
      headers: {
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
    const response = await fetch(`${API_URL}/activity`, {
      method: "GET",
      headers: {
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
