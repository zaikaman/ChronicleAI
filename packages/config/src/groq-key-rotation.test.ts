import { describe, expect, it, beforeEach } from "vitest";
import {
  getGroqApiKeys,
  getNextGroqApiKey,
  resetGroqKeyIndex,
} from "./server-env.ts";

describe("Groq Key Rotation", () => {
  beforeEach(() => {
    resetGroqKeyIndex();
  });

  it("returns empty array and empty string when no Groq keys exist", () => {
    const env = {};
    expect(getGroqApiKeys(env)).toEqual([]);
    expect(getNextGroqApiKey(env)).toBe("");
  });

  it("handles a single GROQ_API_KEY", () => {
    const env = { GROQ_API_KEY: "key_single" };
    expect(getGroqApiKeys(env)).toEqual(["key_single"]);
    expect(getNextGroqApiKey(env)).toBe("key_single");
    expect(getNextGroqApiKey(env)).toBe("key_single");
    expect(getNextGroqApiKey(env)).toBe("key_single");
  });

  it("rotates through GROQ_API_KEY, GROQ_API_KEY_2, GROQ_API_KEY_3 infinitely in round-robin fashion", () => {
    const env = {
      GROQ_API_KEY: "key_1",
      GROQ_API_KEY_2: "key_2",
      GROQ_API_KEY_3: "key_3",
    };

    expect(getGroqApiKeys(env)).toEqual(["key_1", "key_2", "key_3"]);

    // Sequence 1: 1 -> 2 -> 3
    expect(getNextGroqApiKey(env)).toBe("key_1");
    expect(getNextGroqApiKey(env)).toBe("key_2");
    expect(getNextGroqApiKey(env)).toBe("key_3");

    // Sequence 2: 1 -> 2 -> 3
    expect(getNextGroqApiKey(env)).toBe("key_1");
    expect(getNextGroqApiKey(env)).toBe("key_2");
    expect(getNextGroqApiKey(env)).toBe("key_3");

    // Sequence 3: 1 -> 2
    expect(getNextGroqApiKey(env)).toBe("key_1");
    expect(getNextGroqApiKey(env)).toBe("key_2");
  });

  it("handles GROQ_API_KEY_1 alias for GROQ_API_KEY", () => {
    const env = {
      GROQ_API_KEY_1: "key_alias_1",
      GROQ_API_KEY_2: "key_alias_2",
    };

    expect(getGroqApiKeys(env)).toEqual(["key_alias_1", "key_alias_2"]);
    expect(getNextGroqApiKey(env)).toBe("key_alias_1");
    expect(getNextGroqApiKey(env)).toBe("key_alias_2");
    expect(getNextGroqApiKey(env)).toBe("key_alias_1");
  });

  it("handles non-sequential numbered keys correctly (e.g. GROQ_API_KEY, GROQ_API_KEY_2, GROQ_API_KEY_5)", () => {
    const env = {
      GROQ_API_KEY: "key_1",
      GROQ_API_KEY_2: "key_2",
      GROQ_API_KEY_5: "key_5",
    };

    expect(getGroqApiKeys(env)).toEqual(["key_1", "key_2", "key_5"]);
    expect(getNextGroqApiKey(env)).toBe("key_1");
    expect(getNextGroqApiKey(env)).toBe("key_2");
    expect(getNextGroqApiKey(env)).toBe("key_5");
    expect(getNextGroqApiKey(env)).toBe("key_1");
  });

  it("ignores whitespace-only and duplicate keys", () => {
    const env = {
      GROQ_API_KEY: "key_1",
      GROQ_API_KEY_2: "   ",
      GROQ_API_KEY_3: "key_1",
      GROQ_API_KEY_4: "key_4",
    };

    expect(getGroqApiKeys(env)).toEqual(["key_1", "key_4"]);
    expect(getNextGroqApiKey(env)).toBe("key_1");
    expect(getNextGroqApiKey(env)).toBe("key_4");
    expect(getNextGroqApiKey(env)).toBe("key_1");
  });
});
