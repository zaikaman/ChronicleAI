import { describe, expect, it, beforeEach } from "vitest";
import { getNextGroqApiKey, resetGroqKeyIndex } from "@chronicleai/config";
import { createProviderConfigs } from "../services/llm-provider-client.ts";

describe("createProviderConfigs Groq Rotation", () => {
  beforeEach(() => {
    resetGroqKeyIndex();
    process.env.GROQ_API_KEY = "rot_key_1";
    process.env.GROQ_API_KEY_2 = "rot_key_2";
    process.env.GROQ_API_KEY_3 = "rot_key_3";
  });

  it("rotates groq apiKey dynamically on each property access via providerConfigs", () => {
    const mockEnv = {
      geminiApiKey: "gemini_key",
      geminiModel: "gemini-2.0-flash",
      geminiBaseUrl: undefined,
      openaiApiKey: "openai_key",
      openaiModel: "gpt-4o-mini",
      openaiBaseUrl: undefined,
      get groqApiKey() {
        return getNextGroqApiKey(process.env);
      },
      groqApiKeys: ["rot_key_1", "rot_key_2", "rot_key_3"],
      groqModel: "llama-3.3-70b-versatile",
      groqBaseUrl: undefined,
    } as any;

    const configs = createProviderConfigs(mockEnv);

    // Access 1: rot_key_1
    expect(configs.groq.apiKey).toBe("rot_key_1");
    // Access 2: rot_key_2
    expect(configs.groq.apiKey).toBe("rot_key_2");
    // Access 3: rot_key_3
    expect(configs.groq.apiKey).toBe("rot_key_3");
    // Access 4: rot_key_1
    expect(configs.groq.apiKey).toBe("rot_key_1");
  });
});
