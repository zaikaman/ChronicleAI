import { describe, expect, it, beforeEach } from "vitest";
import {
  getNextGroqApiKey,
  resetGroqKeyIndex,
  LLM_FALLBACK_ORDER,
  setGroqKeyIndex,
  getGroqKeyIndex,
  registerGroqKeyIndexPersister,
  advanceAndGetGroqKeyIndex,
} from "@chronicleai/config";
import { createInMemorySupabaseClient, createSystemControlStateRepository } from "@chronicleai/db";
import { createProviderConfigs } from "../services/llm-provider-client.ts";
import { createChatModelsInOrder } from "../agents/langchain/models.ts";

describe("createProviderConfigs & createChatModelsInOrder Groq Rotation", () => {
  beforeEach(() => {
    resetGroqKeyIndex();
    registerGroqKeyIndexPersister(null);
    process.env.GROQ_API_KEY = "rot_key_1";
    process.env.GROQ_API_KEY_2 = "rot_key_2";
    process.env.GROQ_API_KEY_3 = "rot_key_3";
    process.env.OPENAI_API_KEY = "openai_key_test";
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

  it("creates models for each Groq key before OpenAI, starting in round-robin order", () => {
    resetGroqKeyIndex();
    const providerConfigs = {
      gemini: { apiKey: "gemini_key", model: "gemini-2.0-flash" },
      openai: { apiKey: "openai_key_test", model: "gpt-4o-mini" },
      groq: { apiKey: "rot_key_1", model: "llama-3.3-70b-versatile" },
    };

    // Request 1: should get [Groq(rot_key_1), Groq(rot_key_2), Groq(rot_key_3), OpenAI]
    const models1 = createChatModelsInOrder(providerConfigs, LLM_FALLBACK_ORDER);
    expect(models1.length).toBe(4);
    expect(models1[0]!.provider).toBe("groq");
    expect(models1[0]!.config.apiKey).toBe("rot_key_1");
    expect(models1[1]!.provider).toBe("groq");
    expect(models1[1]!.config.apiKey).toBe("rot_key_2");
    expect(models1[2]!.provider).toBe("groq");
    expect(models1[2]!.config.apiKey).toBe("rot_key_3");
    expect(models1[3]!.provider).toBe("openai");

    // Request 2: should start round-robin from rot_key_2
    const models2 = createChatModelsInOrder(providerConfigs, LLM_FALLBACK_ORDER);
    expect(models2[0]!.config.apiKey).toBe("rot_key_2");
    expect(models2[1]!.config.apiKey).toBe("rot_key_3");
    expect(models2[2]!.config.apiKey).toBe("rot_key_1");
    expect(models2[3]!.provider).toBe("openai");
  });

  it("persists key rotation index to database and restores index on boot", async () => {
    const client = createInMemorySupabaseClient();
    const repo = createSystemControlStateRepository(client as any);

    let pendingPersist: Promise<any> = Promise.resolve();
    registerGroqKeyIndexPersister((nextIndex) => {
      pendingPersist = repo.upsert({ groq_key_index: nextIndex });
    });

    advanceAndGetGroqKeyIndex(3); // advances index from 0 to 1
    expect(getGroqKeyIndex()).toBe(1);

    await pendingPersist;

    const saved = await repo.get();
    expect(saved.ok).toBe(true);
    if (saved.ok) {
      expect(saved.value.groq_key_index).toBe(1);
    }

    // Simulate server restart
    resetGroqKeyIndex();
    expect(getGroqKeyIndex()).toBe(0);

    const restored = await repo.get();
    if (restored.ok) {
      setGroqKeyIndex(restored.value.groq_key_index);
    }
    expect(getGroqKeyIndex()).toBe(1);
  });
});
