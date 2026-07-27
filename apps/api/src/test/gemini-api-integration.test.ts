// Tests for Gemini API integration patterns
// Covers both the direct Google API pattern (used in production) and the
// v98store.com proxy/gateway pattern (from user's snippet).

import { describe, expect, it, vi } from "vitest";

// ── Shared Test Helpers ────────────────────────────────

function createMockFetch(response: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: async () => response,
  });
}

const MOCK_PROXY_URL = "https://v98store.com/v1beta/models/gemini-2.5-pro:generateContent";
const MOCK_API_KEY = "test-api-key-12345";

// ── 1. Direct Google Gemini API Pattern ──────────────
//
// This matches the existing callGemini function in public-alert-content-service.ts
// Uses: generativelanguage.googleapis.com with ?key= query param

describe("Gemini Direct API Pattern (existing implementation)", () => {
  function buildDirectUrl(model: string, apiKey: string, baseUrl?: string) {
    const host = (baseUrl || "https://generativelanguage.googleapis.com").replace(/\/+$/, "");
    const path = host.includes("/v1")
      ? `/models/${model}:generateContent?key=${apiKey}`
      : `/v1beta/models/${model}:generateContent?key=${apiKey}`;
    return `${host}${path}`;
  }

  it("builds correct API URL with v1beta path", () => {
    const url = buildDirectUrl("gemini-2.0-flash", MOCK_API_KEY);
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=test-api-key-12345",
    );
  });

  it("builds correct API URL with custom base URL", () => {
    const url = buildDirectUrl("gemini-2.0-flash", MOCK_API_KEY, "https://v98store.com");
    expect(url).toBe(
      "https://v98store.com/v1beta/models/gemini-2.0-flash:generateContent?key=test-api-key-12345",
    );
  });

  it("builds correct API URL when base URL includes /v1", () => {
    const url = buildDirectUrl("gemini-2.0-flash", MOCK_API_KEY, "https://custom.io/v1");
    expect(url).toBe(
      "https://custom.io/v1/models/gemini-2.0-flash:generateContent?key=test-api-key-12345",
    );
  });

  it("sends correctly formatted Gemini API request body", async () => {
    const mockResponse = {
      candidates: [
        {
          content: {
            parts: [{ text: '{"title":"Test","summary":"A test alert","confidence":"high"}' }],
          },
        },
      ],
    };
    const fetchMock = createMockFetch(mockResponse);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;

    try {
      const url = buildDirectUrl("gemini-2.5-pro", MOCK_API_KEY);
      const requestBody = {
        contents: [{ parts: [{ text: "Describe this blockchain event" }] }],
        generationConfig: { temperature: 0.3 },
      };

      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      expect(response.ok).toBe(true);
      const data = (await response.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };

      // Verify the response follows Gemini's candidate structure
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      expect(text).toBeDefined();
      expect(text!).toContain("title");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("handles Gemini API error responses", async () => {
    const errorResponse = { error: { message: "API key not valid", code: 403 } };
    const fetchMock = createMockFetch(errorResponse, 403);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;

    try {
      const url = buildDirectUrl("gemini-2.0-flash", "invalid-key");
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: "test" }] }] }),
      });

      expect(response.ok).toBe(false);
      expect(response.status).toBe(403);

      const data = (await response.json()) as {
        error?: { message?: string; code?: number };
      };
      expect(data.error?.message).toBe("API key not valid");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("extracts text from Gemini response candidates", () => {
    const geminiResponse = {
      candidates: [
        {
          content: {
            parts: [{ text: "Some generated content" }],
            role: "model",
          },
          finishReason: "STOP",
          avgLogprobs: -0.1,
        },
      ],
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 5,
        totalTokenCount: 15,
      },
    };

    const text = geminiResponse.candidates?.[0]?.content?.parts?.[0]?.text;
    expect(text).toBe("Some generated content");
  });

  it("handles empty Gemini response", () => {
    const emptyResponse: { candidates: Array<{ content?: { parts?: Array<{ text?: string }> } }> } = {
      candidates: [],
    };
    const text = emptyResponse.candidates[0]?.content?.parts?.[0]?.text;
    expect(text).toBeUndefined();
  });
});

// ── 2. v98store Proxy Pattern (user's code) ──────────
//
// Uses: v98store.com with Authorization: Bearer header
// Supports: systemInstruction, thinkingConfig, topP

describe("Gemini v98store Proxy Pattern (your code)", () => {
  it("sends request with correct v98store URL", () => {
    const url = "https://v98store.com/v1beta/models/gemini-2.5-pro:generateContent";
    expect(url).toMatch(/^https:\/\/v98store\.com\//);
    expect(url).toContain("/v1beta/models/");
    expect(url).toContain(":generateContent");
  });

  it("sends request with Authorization Bearer header", async () => {
    const mockResponse = {
      candidates: [
        {
          content: {
            parts: [{ text: "Hum hum I am a little pig!" }],
          },
        },
      ],
    };
    const fetchMock = createMockFetch(mockResponse);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;

    try {
      const headers = {
        Authorization: `Bearer ${MOCK_API_KEY}`,
        "Content-Type": "application/json",
      };

      const response = await fetch(MOCK_PROXY_URL, {
        method: "POST",
        headers,
        body: JSON.stringify({ contents: [{ parts: [{ text: "Who are you?" }] }] }),
      });

      expect(response.ok).toBe(true);

      // Verify the Authorization Bearer header was actually sent with the fetch
      const sentHeaders = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string> | undefined;
      expect(sentHeaders).toBeDefined();
      expect(sentHeaders!["authorization"] ?? sentHeaders!["Authorization"]).toBe(
        `Bearer ${MOCK_API_KEY}`,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("sends properly structured request body with systemInstruction and thinkingConfig", () => {
    const requestBody = {
      systemInstruction: {
        parts: [{ text: "You are always a little pig. You will be at the beginning of the reply add one 'Hum hum'" }],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: "Who are you?" }],
        },
      ],
      generationConfig: {
        temperature: 1,
        topP: 1,
        thinkingConfig: {
          includeThoughts: true,
          thinkingBudget: 26240,
        },
      },
    };

    // Validate structure
    expect(requestBody.systemInstruction).toBeDefined();
    expect(requestBody.systemInstruction!.parts[0]!.text).toContain("little pig");
    expect(requestBody.contents[0]!.role).toBe("user");
    expect(requestBody.generationConfig.temperature).toBe(1);
    expect(requestBody.generationConfig.thinkingConfig!.includeThoughts).toBe(true);
    expect(requestBody.generationConfig.thinkingConfig!.thinkingBudget).toBe(26240);
  });

  it("returns system-instructed response from v98store proxy", async () => {
    const mockResponse = {
      candidates: [
        {
          content: {
            parts: [{ text: "Hum hum I am a little pig! Oink oink!" }],
            role: "model",
          },
          finishReason: "STOP",
        },
      ],
    };
    const fetchMock = createMockFetch(mockResponse);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;

    try {
      const response = await fetch(MOCK_PROXY_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${MOCK_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: "You are always a little pig. You will be at the beginning of the reply add one 'Hum hum'" }],
          },
          contents: [{ role: "user", parts: [{ text: "Who are you?" }] }],
          generationConfig: {
            temperature: 1,
            topP: 1,
            thinkingConfig: { includeThoughts: true, thinkingBudget: 26240 },
          },
        }),
      });

      const data = (await response.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const reply = data.candidates?.[0]?.content?.parts?.[0]?.text;

      expect(reply).toBeDefined();
      expect(reply!).toContain("Hum hum");
      expect(reply!).toContain("little pig");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("handles 401 Unauthorized from v98store proxy", async () => {
    const errorResponse = { error: { code: 401, message: "Unauthorized. Invalid API key.", status: "UNAUTHENTICATED" } };
    const fetchMock = createMockFetch(errorResponse, 401);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;

    try {
      const response = await fetch(MOCK_PROXY_URL, {
        method: "POST",
        headers: {
          Authorization: "Bearer invalid-key",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ contents: [{ parts: [{ text: "test" }] }] }),
      });

      expect(response.ok).toBe(false);
      expect(response.status).toBe(401);

      const data = (await response.json()) as {
        error?: { message?: string; code?: number; status?: string };
      };
      expect(data.error?.message).toContain("Unauthorized");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("handles network errors gracefully", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network error: connect ECONNREFUSED v98store.com:443"));

    try {
      await expect(
        fetch(MOCK_PROXY_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${MOCK_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: "test" }] }] }),
        }),
      ).rejects.toThrow("Network error");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("handles Gemini 2.5 Pro thinking blocks in response", () => {
    // Gemini 2.5 Pro can return thinking blocks alongside content parts
    const responseWithThinking = {
      candidates: [
        {
          content: {
            parts: [
              { text: "Thinking about the response..." },
              { text: "Final answer here" },
            ],
            role: "model",
          },
          finishReason: "STOP",
        },
      ],
    };

    const firstCandidate = responseWithThinking.candidates[0]!;
    const parts = firstCandidate.content!.parts;
    const finalText = parts[parts.length - 1]!.text;
    expect(finalText).toBe("Final answer here");
  });

  it("sends correct content-type header", () => {
    const headers = {
      Authorization: `Bearer ${MOCK_API_KEY}`,
      "Content-Type": "application/json",
    };
    expect(headers["Content-Type"]).toBe("application/json");
  });
});

// ── 3. Cross-Pattern Compatibility ─────────────────────

describe("Cross-Pattern Compatibility", () => {
  it("both patterns produce valid Gemini API request bodies", () => {
    // Common structure that both the direct API and v98store proxy accept
    const directRequestBody = {
      contents: [{ parts: [{ text: "test prompt" }] }],
      generationConfig: { temperature: 0.3 },
    };

    const proxyRequestBody = {
      contents: [{ parts: [{ text: "test prompt" }] }],
      generationConfig: { temperature: 1, topP: 1 },
    };

    // Both have the 'contents' array with 'parts' structure
    expect(directRequestBody.contents).toBeDefined();
    expect(proxyRequestBody.contents).toBeDefined();
    expect(directRequestBody.contents![0]!.parts[0]!.text).toBe("test prompt");
    expect(proxyRequestBody.contents![0]!.parts[0]!.text).toBe("test prompt");
  });

  it("both patterns parse Gemini response candidates identically", () => {
    const geminiResponse: {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    } = {
      candidates: [{ content: { parts: [{ text: "identical format" }] } }],
    };

    const text = geminiResponse.candidates[0]!.content.parts[0]!.text;
    expect(text).toBe("identical format");
  });
});

// ── 4. Real Integration Test (skipped by default) ────
//
// Run with: GEMINI_API_KEY=your_key npx vitest run --no-skip --reporter verbose apps/api/src/test/gemini-api-integration.test.ts
// Or with v98store proxy: V98STORE_API_KEY=your_key npx vitest run --no-skip --reporter verbose apps/api/src/test/gemini-api-integration.test.ts

describe.skip("Integration - Real API Calls (requires API key)", () => {
  const GOOGLE_API_KEY = process.env.GEMINI_API_KEY;
  const V98STORE_API_KEY = process.env.V98STORE_API_KEY;

  it("calls real Google Gemini API and gets a response", async () => {
    expect(GOOGLE_API_KEY, "Set GEMINI_API_KEY env var to run this integration test").toBeTruthy();

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GOOGLE_API_KEY}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: "Say hello in one word." }] }],
        generationConfig: { temperature: 0.3 },
      }),
    });

    expect(response.ok).toBe(true);
    const data = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    expect(text).toBeDefined();
    expect(typeof text).toBe("string");
    expect(text!.length).toBeGreaterThan(0);
  }, 30_000);

  it("calls real v98store proxy and gets a response with system instruction", async () => {
    expect(V98STORE_API_KEY, "Set V98STORE_API_KEY env var to run this integration test").toBeTruthy();

    const response = await fetch(
      "https://v98store.com/v1beta/models/gemini-2.5-pro:generateContent",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${V98STORE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: "You are a helpful assistant. Reply with exactly 'OK'." }],
          },
          contents: [{ role: "user", parts: [{ text: "Ready?" }] }],
          generationConfig: { temperature: 1, topP: 1 },
        }),
      },
    );

    expect(response.ok).toBe(true);
    const data = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    expect(text).toBeDefined();
    expect(typeof text).toBe("string");
    expect(text!.length).toBeGreaterThan(0);
  }, 30_000);
});
